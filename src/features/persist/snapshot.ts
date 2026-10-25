import type { AppState, PaneSpec } from '../../store/types';

export const STATE_VERSION = 1;

/** 파일 모양: 버전 + 앱 상태 */
export interface StateFile {
  version: number;
  state: AppState;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function layoutPaneIds(n: unknown, out: string[]): boolean {
  if (!isObj(n)) return false;
  if (n.type === 'pane') {
    if (typeof n.paneId !== 'string') return false;
    out.push(n.paneId);
    return true;
  }
  return (
    n.type === 'split' &&
    (n.dir === 'row' || n.dir === 'col') &&
    typeof n.ratio === 'number' &&
    layoutPaneIds(n.a, out) &&
    layoutPaneIds(n.b, out)
  );
}

function validPane(id: string, p: unknown): p is PaneSpec {
  return (
    isObj(p) &&
    p.id === id &&
    (p.kind === 'shell' || p.kind === 'agent') &&
    typeof p.profileId === 'string' &&
    typeof p.cwd === 'string' &&
    (p.args === undefined || (Array.isArray(p.args) && p.args.every((a) => typeof a === 'string')))
  );
}

/** 구조가 맞는 AppState인지. 레이아웃이 가리키는 pane이 모두 있어야 한다. */
export function isValidState(s: unknown): s is AppState {
  if (!isObj(s) || !isObj(s.panes) || !Array.isArray(s.sessions)) return false;
  if (s.sessions.length === 0 || typeof s.activeSessionId !== 'string') return false;
  const panes = s.panes;
  if (!Object.entries(panes).every(([id, p]) => validPane(id, p))) return false;
  const seen = new Set<string>();
  const sessionIds = new Set<string>();
  for (const sess of s.sessions) {
    if (!isObj(sess) || typeof sess.id !== 'string' || typeof sess.name !== 'string') return false;
    if (sess.cwd !== undefined && typeof sess.cwd !== 'string') return false;
    if (typeof sess.color !== 'string' || !Array.isArray(sess.windows)) return false;
    if (sess.windows.length === 0 || typeof sess.activeWindowId !== 'string') return false;
    sessionIds.add(sess.id);
    const winIds = new Set<string>();
    for (const w of sess.windows) {
      if (!isObj(w) || typeof w.id !== 'string' || typeof w.zoomed !== 'boolean') return false;
      if (w.name !== null && typeof w.name !== 'string') return false;
      const ids: string[] = [];
      if (!layoutPaneIds(w.root, ids) || ids.length === 0) return false;
      if (typeof w.focusPaneId !== 'string' || !ids.includes(w.focusPaneId)) return false;
      for (const id of ids) {
        if (!(id in panes) || seen.has(id)) return false;
        seen.add(id);
      }
      winIds.add(w.id);
    }
    if (!winIds.has(sess.activeWindowId)) return false;
  }
  // 어떤 탭에도 없는 pane은 고아 — 파일이 어긋났다는 뜻
  return sessionIds.has(s.activeSessionId) && seen.size === Object.keys(panes).length;
}

export type ParseResult = { ok: true; state: AppState } | { ok: false; reason: string };

/** 저장 파일 원문 → 앱 상태. 버전별 마이그레이션은 여기에 단계로 추가한다. */
export function parseStateFile(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSON을 읽을 수 없음' };
  }
  if (!isObj(data) || typeof data.version !== 'number') {
    return { ok: false, reason: '버전 정보가 없음' };
  }
  if (data.version > STATE_VERSION) {
    return { ok: false, reason: `더 새로운 버전(${data.version})의 파일` };
  }
  // v1이 현재 버전이라 아직 마이그레이션 단계가 없다.
  if (!isValidState(data.state)) return { ok: false, reason: '저장된 구조가 올바르지 않음' };
  return { ok: true, state: data.state };
}

/** 저장할 모습으로: 살아 있는 cwd(OSC 7)를 pane 스펙에 반영한다. */
export function snapshotState(
  s: AppState,
  liveCwd: (paneId: string) => string | undefined,
  /** 셸 pane 안에서 직접 띄운 AI라면 복원 때 다시 띄울 agent 스펙 (없으면 undefined) */
  asAgent?: (paneId: string) => Partial<PaneSpec> | undefined,
): StateFile {
  const panes: Record<string, PaneSpec> = {};
  for (const [id, p] of Object.entries(s.panes)) {
    const agent = p.kind === 'shell' ? asAgent?.(id) : undefined;
    panes[id] = { ...p, ...agent, cwd: liveCwd(id) ?? p.cwd };
  }
  return {
    version: STATE_VERSION,
    state: { sessions: s.sessions, activeSessionId: s.activeSessionId, panes },
  };
}

export const agentPanes = (s: AppState): PaneSpec[] =>
  Object.values(s.panes).filter((p) => p.kind === 'agent' && p.provider);

/** 이어하기 인자: Claude Code · agy는 `-c`. Codex는 새로 시작한다. */
const RESUME_ARG = '-c';
const RESUMABLE = new Set(['claude', 'antigravity']);

export function applyResume(s: AppState, resume: boolean): AppState {
  const panes: Record<string, PaneSpec> = {};
  for (const [id, p] of Object.entries(s.panes)) {
    if (p.kind === 'agent' && p.provider && RESUMABLE.has(p.provider)) {
      const rest = (p.args ?? []).filter((a) => a !== RESUME_ARG);
      panes[id] = { ...p, args: resume ? [...rest, RESUME_ARG] : rest };
    } else {
      panes[id] = p;
    }
  }
  return { ...s, panes };
}

/** 사라진 폴더를 가리키는 cwd는 빈 값(셸 기본 위치 = 홈)으로. */
export function fixMissingCwds(s: AppState, exists: (cwd: string) => boolean): AppState {
  const panes: Record<string, PaneSpec> = {};
  for (const [id, p] of Object.entries(s.panes)) {
    panes[id] = p.cwd && !exists(p.cwd) ? { ...p, cwd: '' } : p;
  }
  return { ...s, panes };
}
