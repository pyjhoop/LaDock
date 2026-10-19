import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { uid } from '../../store/ops';
import type { ProviderId } from '../../store/types';

export type TaskKind =
  | { type: 'command'; line: string }
  | { type: 'script'; path: string; args: string }
  | { type: 'ai'; provider: ProviderId; prompt: string };

export type Schedule =
  | { type: 'none' }
  /** time은 "HH:MM", days는 0(일)–6(토). 빈 배열이면 매일 */
  | { type: 'daily'; time: string; days: number[] }
  | { type: 'interval'; minutes: number };

export interface Task {
  id: string;
  name: string;
  kind: TaskKind;
  /** command · script를 돌릴 셸 */
  profileId: string;
  /** 빈 값이면 포커스 pane의 현재 폴더 */
  cwd: string;
  schedule: Schedule;
  /** 예약을 켰는지. 수동 실행은 항상 가능 */
  enabled: boolean;
  /** unix 초 */
  lastRunAt?: number;
}

export const TASKS_VERSION = 1;
export const MIN_INTERVAL_MINUTES = 1;
export const PROVIDERS: ProviderId[] = ['claude', 'codex', 'antigravity'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export const isTime = (v: unknown): v is string =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function parseKind(v: unknown): TaskKind | null {
  if (!isObj(v)) return null;
  if (v.type === 'command') return { type: 'command', line: text(v.line) };
  if (v.type === 'script') return { type: 'script', path: text(v.path), args: text(v.args) };
  if (v.type === 'ai' && PROVIDERS.includes(v.provider as ProviderId)) {
    return { type: 'ai', provider: v.provider as ProviderId, prompt: text(v.prompt) };
  }
  return null;
}

function parseSchedule(v: unknown): Schedule {
  if (!isObj(v)) return { type: 'none' };
  if (v.type === 'daily' && isTime(v.time)) {
    const days = Array.isArray(v.days)
      ? [...new Set(v.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
      : [];
    return { type: 'daily', time: v.time, days: days.sort() };
  }
  if (v.type === 'interval' && typeof v.minutes === 'number' && Number.isFinite(v.minutes)) {
    return { type: 'interval', minutes: Math.max(MIN_INTERVAL_MINUTES, Math.round(v.minutes)) };
  }
  return { type: 'none' };
}

/** 저장 파일 원문 → 작업 목록. 깨진 항목은 버리고, 파일이 깨졌으면 빈 목록. */
export function parseTasks(raw: string | null): Task[] {
  let data: unknown;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObj(data) || !Array.isArray(data.tasks)) return [];
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of data.tasks) {
    if (!isObj(t) || typeof t.id !== 'string' || seen.has(t.id)) continue;
    const kind = parseKind(t.kind);
    if (!kind) continue;
    seen.add(t.id);
    out.push({
      id: t.id,
      name: text(t.name).trim() || '이름 없는 작업',
      kind,
      profileId: text(t.profileId, 'pwsh') || 'pwsh',
      cwd: text(t.cwd),
      schedule: parseSchedule(t.schedule),
      enabled: t.enabled === true,
      lastRunAt:
        typeof t.lastRunAt === 'number' && Number.isFinite(t.lastRunAt) ? t.lastRunAt : undefined,
    });
  }
  return out;
}

export function newTask(profileId: string): Task {
  return {
    id: uid('t'),
    name: '새 작업',
    kind: { type: 'command', line: '' },
    profileId,
    cwd: '',
    schedule: { type: 'none' },
    enabled: false,
  };
}

/** 실행할 내용이 비어 있는지 (비어 있으면 실행 · 저장 불가) */
export function isTaskEmpty(t: Task): boolean {
  switch (t.kind.type) {
    case 'command':
      return !t.kind.line.trim();
    case 'script':
      return !t.kind.path.trim();
    case 'ai':
      return !t.kind.prompt.trim();
  }
}

interface TasksState {
  tasks: Task[];
  loaded: boolean;
  upsert: (task: Task) => void;
  remove: (id: string) => void;
  markRun: (id: string, at: number) => void;
}

export const useTasks = create<TasksState>()((set, get) => {
  const commit = (tasks: Task[]) => {
    set({ tasks });
    scheduleSave();
  };
  return {
    tasks: [],
    loaded: false,
    upsert: (task) => {
      const cur = get().tasks;
      commit(
        cur.some((t) => t.id === task.id)
          ? cur.map((t) => (t.id === task.id ? task : t))
          : [...cur, task],
      );
    },
    remove: (id) => commit(get().tasks.filter((t) => t.id !== id)),
    markRun: (id, at) =>
      commit(get().tasks.map((t) => (t.id === id ? { ...t, lastRunAt: at } : t))),
  };
});

let timer: ReturnType<typeof setTimeout> | undefined;

async function save() {
  try {
    const { tasks } = useTasks.getState();
    await invoke('tasks_save', {
      json: JSON.stringify({ version: TASKS_VERSION, tasks }, null, 2),
    });
  } catch (e) {
    console.error('tasks_save 실패', e);
  }
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => void save(), 400);
}

/** 시작할 때 한 번. 읽기에 실패해도 빈 목록으로 계속한다. */
export async function loadTasks(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await invoke<string | null>('tasks_load');
  } catch (e) {
    console.error('tasks_load 실패', e);
  }
  useTasks.setState({ tasks: parseTasks(raw), loaded: true });
}
