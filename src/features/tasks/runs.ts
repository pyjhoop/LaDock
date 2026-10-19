import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { TaskKind } from './tasks';

export type RunStatus = 'running' | 'ok' | 'failed' | 'stopped' | 'error';

export interface RunRecord {
  /** 로그 파일 이름 (task-logs/<id>.log) */
  id: string;
  taskId: string;
  /** 작업을 지워도 기록은 남도록 이름을 복사해 둔다 */
  taskName: string;
  kind: TaskKind['type'];
  trigger: 'manual' | 'schedule';
  /** 실행한 내용 (표시용) */
  summary: string;
  /** unix 초 */
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  exitCode?: number;
  error?: string;
}

export const HISTORY_VERSION = 1;
export const MAX_RUNS = 200;

const STATUSES: RunStatus[] = ['running', 'ok', 'failed', 'stopped', 'error'];
const KINDS: TaskKind['type'][] = ['command', 'script', 'ai'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const text = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

/**
 * 저장 파일 원문 → 기록 목록(최신순). 깨진 항목은 버린다.
 * 저장 당시 'running'이던 기록은 앱이 꺼지면서 끊긴 것이므로 'error'로 바꾼다.
 */
export function parseRuns(raw: string | null): RunRecord[] {
  let data: unknown;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObj(data) || !Array.isArray(data.runs)) return [];
  const seen = new Set<string>();
  const out: RunRecord[] = [];
  for (const r of data.runs) {
    if (!isObj(r) || typeof r.id !== 'string' || seen.has(r.id)) continue;
    const startedAt = num(r.startedAt);
    if (startedAt === undefined || !STATUSES.includes(r.status as RunStatus)) continue;
    seen.add(r.id);
    const interrupted = r.status === 'running';
    out.push({
      id: r.id,
      taskId: text(r.taskId),
      taskName: text(r.taskName, '이름 없는 작업'),
      kind: KINDS.includes(r.kind as TaskKind['type']) ? (r.kind as TaskKind['type']) : 'command',
      trigger: r.trigger === 'schedule' ? 'schedule' : 'manual',
      summary: text(r.summary),
      startedAt,
      endedAt: num(r.endedAt),
      status: interrupted ? 'error' : (r.status as RunStatus),
      exitCode: num(r.exitCode),
      error: interrupted ? '앱이 종료되어 실행이 중단되었습니다' : text(r.error) || undefined,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** 종료 이벤트 → 최종 상태 */
export function statusOnExit(code: number | undefined, killed: boolean): RunStatus {
  if (killed) return 'stopped';
  return code === 0 ? 'ok' : 'failed';
}

/** 최신순 목록에서 상한을 넘는 오래된 기록(실행 중이 아닌 것)을 골라낸다. */
export function overflow(runs: RunRecord[], max = MAX_RUNS): RunRecord[] {
  const extra = runs.length - max;
  if (extra <= 0) return [];
  return runs
    .slice()
    .reverse()
    .filter((r) => r.status !== 'running')
    .slice(0, extra);
}

interface RunsState {
  runs: RunRecord[];
  loaded: boolean;
  add: (run: RunRecord) => void;
  finish: (id: string, patch: Partial<RunRecord>) => void;
  remove: (ids: string[]) => void;
}

export const useRuns = create<RunsState>()((set, get) => {
  const commit = (runs: RunRecord[]) => {
    set({ runs });
    scheduleSave();
  };
  return {
    runs: [],
    loaded: false,
    add: (run) => {
      const runs = [run, ...get().runs];
      const drop = overflow(runs);
      if (drop.length > 0) {
        const ids = new Set(drop.map((r) => r.id));
        void invoke('task_log_delete', { runIds: [...ids] }).catch(() => {});
        commit(runs.filter((r) => !ids.has(r.id)));
      } else commit(runs);
    },
    finish: (id, patch) => commit(get().runs.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    remove: (ids) => {
      const gone = new Set(ids);
      void invoke('task_log_delete', { runIds: ids }).catch(() => {});
      commit(get().runs.filter((r) => !gone.has(r.id)));
    },
  };
});

/** 작업별 가장 최근 기록 (사이드바 상태 표시용) */
export const latestRunOf = (runs: RunRecord[], taskId: string): RunRecord | undefined =>
  runs.find((r) => r.taskId === taskId);

let timer: ReturnType<typeof setTimeout> | undefined;

async function save() {
  try {
    const { runs } = useRuns.getState();
    await invoke('task_history_save', {
      json: JSON.stringify({ version: HISTORY_VERSION, runs }),
    });
  } catch (e) {
    console.error('task_history_save 실패', e);
  }
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => void save(), 400);
}

/** 시작할 때 한 번. 읽기에 실패해도 빈 기록으로 계속한다. */
export async function loadRuns(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await invoke<string | null>('task_history_load');
  } catch (e) {
    console.error('task_history_load 실패', e);
  }
  useRuns.setState({ runs: parseRuns(raw), loaded: true });
  // 'running'에서 'error'로 바뀐 기록을 파일에도 반영
  scheduleSave();
}

interface ExitPayload {
  runId: string;
  code?: number | null;
  killed: boolean;
}

/** 프로세스 종료 이벤트를 기록에 반영한다. 해제 함수를 돌려준다. */
export function listenRunExit(): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void listen<ExitPayload>('task://exit', (e) => {
    const { runId, code, killed } = e.payload;
    const exitCode = code ?? undefined;
    useRuns.getState().finish(runId, {
      status: statusOnExit(exitCode, killed),
      exitCode,
      endedAt: Math.floor(Date.now() / 1000),
    });
  }).then((u) => (disposed ? u() : (unlisten = u)));
  return () => {
    disposed = true;
    unlisten?.();
  };
}
