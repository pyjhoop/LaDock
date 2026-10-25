import * as tree from './tree';
import type { AppState, LayoutNode, PaneSpec, Session, SplitPath, Window } from './types';

export const SESSION_COLORS = ['#3ccfbd', '#e5a24a', '#7aa2f7', '#e06c9f', '#9ece6a', '#bb9af7'];

let seq = 0;
export const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** 새 세션 · 분할의 기본 셸. 설정(M3-02)이 바꾼다. */
export const defaults = { profile: 'pwsh' };

/** 셸이 알려 준 현재 폴더(OSC 7) 조회. terminal/registry가 채운다 (store가 terminal을 import하지 않도록). */
export const liveCwd: { of: (paneId: string) => string | undefined } = { of: () => undefined };

const cwdOf = (p: PaneSpec | undefined) => (p && liveCwd.of(p.id)) ?? p?.cwd ?? '';

function newShellPane(profileId: string, cwd: string): PaneSpec {
  return { id: uid('p'), kind: 'shell', profileId, cwd };
}

function newWindowOf(pane: PaneSpec): Window {
  return {
    id: uid('w'),
    name: null,
    root: { type: 'pane', paneId: pane.id },
    focusPaneId: pane.id,
    zoomed: false,
  };
}

export function createSession(
  name: string,
  color: string,
  profileId: string,
  cwd: string,
  /** 프로젝트 폴더로 고정할지 (새 프로젝트 추가) */
  projectCwd?: string,
): { session: Session; pane: PaneSpec } {
  const pane = newShellPane(profileId, cwd);
  const win = newWindowOf(pane);
  return {
    session: {
      id: uid('s'),
      name,
      color,
      ...(projectCwd ? { cwd: projectCwd } : null),
      windows: [win],
      activeWindowId: win.id,
    },
    pane,
  };
}

/** 순번이 없는 pane에 가장 작은 빈 번호를 붙인다. 바뀐 게 없으면 같은 객체를 돌려준다. */
export function assignPaneNumbers(s: AppState): AppState {
  const missing = Object.values(s.panes).filter((p) => p.no === undefined);
  if (missing.length === 0) return s;
  const used = new Set(Object.values(s.panes).flatMap((p) => (p.no === undefined ? [] : [p.no])));
  const panes = { ...s.panes };
  let n = 1;
  for (const p of missing) {
    while (used.has(n)) n++;
    used.add(n);
    panes[p.id] = { ...p, no: n };
  }
  return { ...s, panes };
}

/** 프로젝트가 하나도 없는 상태 (시작 화면) */
export function createEmptyState(): AppState {
  return { sessions: [], activeSessionId: '', panes: {} };
}

export function createInitialState(): AppState {
  const { session, pane } = createSession('main', SESSION_COLORS[0], defaults.profile, '');
  return assignPaneNumbers({
    sessions: [session],
    activeSessionId: session.id,
    panes: { [pane.id]: pane },
  });
}

// ── 조회 ─────────────────────────────────────────

/** 프로젝트가 없으면 undefined */
export const activeSession = (s: AppState): Session | undefined =>
  s.sessions.find((x) => x.id === s.activeSessionId) ?? s.sessions[0];

export const activeWindow = (sess: Session): Window =>
  sess.windows.find((w) => w.id === sess.activeWindowId) ?? sess.windows[0];

/** 프로젝트 폴더: 지정한 폴더, 없으면 포커스된 pane의 현재 폴더 */
export const projectCwd = (s: AppState, sess: Session): string => {
  if (sess.cwd) return sess.cwd;
  const win = activeWindow(sess);
  return cwdOf(s.panes[win.focusPaneId]);
};

export const focusedPane = (s: AppState): PaneSpec | undefined => {
  const sess = activeSession(s);
  return sess && s.panes[activeWindow(sess).focusPaneId];
};

function locate(s: AppState, paneId: string) {
  for (const session of s.sessions) {
    const win = session.windows.find((w) => tree.findPath(w.root, paneId));
    if (win) return { session, win };
  }
  return null;
}

/** 프로그램 이름: command의 파일명(확장자 제외), 없으면 프로필 id */
export function programName(pane: PaneSpec): string {
  if (pane.command) {
    const base = pane.command.split(/[\\/]/).pop() ?? pane.command;
    return base.replace(/\.(exe|cmd|bat)$/i, '');
  }
  return pane.profileId;
}

/** 탭 표시 이름: 직접 지은 이름 > 포커스된 pane의 프로그램 이름 (auto-rename) */
export function windowLabel(s: AppState, win: Window): string {
  if (win.name !== null) return win.name;
  const pane = s.panes[win.focusPaneId];
  return pane ? programName(pane) : '';
}

// ── 갱신 헬퍼 ─────────────────────────────────────

const mapSession = (s: AppState, id: string, f: (x: Session) => Session): AppState => ({
  ...s,
  sessions: s.sessions.map((x) => (x.id === id ? f(x) : x)),
});

const mapWindow = (sess: Session, id: string, f: (w: Window) => Window): Session => ({
  ...sess,
  windows: sess.windows.map((w) => (w.id === id ? f(w) : w)),
});

const without = (panes: Record<string, PaneSpec>, ids: string[]) => {
  const next = { ...panes };
  for (const id of ids) delete next[id];
  return next;
};

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** 포커스된 pane에서 현재 폴더 · 프로필을 물려받은 새 셸 pane */
function inheritedPane(s: AppState, profileId?: string): PaneSpec {
  const f = focusedPane(s);
  return newShellPane(profileId ?? f?.profileId ?? defaults.profile, cwdOf(f));
}

// ── pane ─────────────────────────────────────────

export function focusPane(s: AppState, paneId: string): AppState {
  const loc = locate(s, paneId);
  if (!loc) return s;
  return mapSession({ ...s, activeSessionId: loc.session.id }, loc.session.id, (sess) => ({
    ...mapWindow(sess, loc.win.id, (w) => ({ ...w, focusPaneId: paneId })),
    activeWindowId: loc.win.id,
  }));
}

/** 포커스된 pane을 나눈다. 새 pane이 포커스를 받는다. profileId를 주면 그 셸로 띄운다. */
export function splitFocused(s: AppState, dir: 'row' | 'col', profileId?: string): AppState {
  return splitWithPane(s, dir, inheritedPane(s, profileId));
}

/** 포커스된 pane 옆에 주어진 pane을 붙인다 (AI 실행 등). */
export function splitWithPane(s: AppState, dir: 'row' | 'col', pane: PaneSpec): AppState {
  const sess = activeSession(s);
  if (!sess) return sessionWithPane(s, pane);
  const win = activeWindow(sess);
  return {
    ...mapSession(s, sess.id, (x) =>
      mapWindow(x, win.id, (w) => ({
        ...w,
        root: tree.split(w.root, w.focusPaneId, dir, pane.id),
        focusPaneId: pane.id,
        zoomed: false,
      })),
    ),
    panes: { ...s.panes, [pane.id]: pane },
  };
}

/** 닫기 연쇄: pane → 탭 → 프로젝트 → (마지막이면) 시작 화면 */
export function closePane(s: AppState, paneId: string): AppState {
  const loc = locate(s, paneId);
  if (!loc) return s;
  const result = tree.close(loc.win.root, paneId);
  if (result.root === null) return closeWindow(s, loc.session.id, loc.win.id);
  const root: LayoutNode = result.root;
  const focus = result.promoted ? tree.leaves(result.promoted)[0] : loc.win.focusPaneId;
  const wasFocused = loc.win.focusPaneId === paneId;
  return {
    ...mapSession(s, loc.session.id, (sess) =>
      mapWindow(sess, loc.win.id, (w) => ({
        ...w,
        root,
        focusPaneId: wasFocused ? focus : w.focusPaneId,
        zoomed: false,
      })),
    ),
    panes: without(s.panes, [paneId]),
  };
}

export function setRatio(s: AppState, windowId: string, path: SplitPath, ratio: number): AppState {
  return {
    ...s,
    sessions: s.sessions.map((sess) =>
      sess.windows.some((w) => w.id === windowId)
        ? mapWindow(sess, windowId, (w) => ({ ...w, root: tree.setRatio(w.root, path, ratio) }))
        : sess,
    ),
  };
}

/** 화면상 dir 쪽에서 가장 가까운 pane으로 포커스를 옮긴다. 줌 상태에서는 무시. */
export function moveFocus(s: AppState, dir: tree.Direction): AppState {
  const sess = activeSession(s);
  if (!sess) return s;
  const win = activeWindow(sess);
  if (win.zoomed) return s;
  const target = tree.neighborPane(tree.computeLayout(win.root), win.focusPaneId, dir);
  return target ? focusPane(s, target) : s;
}

export function resizeFocused(s: AppState, dir: tree.Direction): AppState {
  const sess = activeSession(s);
  if (!sess) return s;
  return mapSession(s, sess.id, (x) =>
    mapWindow(x, x.activeWindowId, (w) => ({
      ...w,
      root: tree.resizeFocused(w.root, w.focusPaneId, dir),
    })),
  );
}

export function toggleZoom(s: AppState): AppState {
  const sess = activeSession(s);
  if (!sess) return s;
  return mapSession(s, sess.id, (x) =>
    mapWindow(x, x.activeWindowId, (w) => ({ ...w, zoomed: !w.zoomed })),
  );
}

// ── 탭(window) ───────────────────────────────────

export function newWindow(s: AppState): AppState {
  const sess = activeSession(s);
  if (!sess) return s;
  // 폴더를 지정한 프로젝트면 새 탭은 그 폴더에서 시작한다 (분할은 현재 폴더를 이어받는다)
  const pane = inheritedPane(s);
  return newWindowWithPane(s, sess.cwd ? { ...pane, cwd: sess.cwd } : pane);
}

/** 현재 세션에 주어진 pane 하나짜리 새 탭을 만든다. */
export function newWindowWithPane(s: AppState, pane: PaneSpec): AppState {
  const sess = activeSession(s);
  if (!sess) return sessionWithPane(s, pane);
  const win = newWindowOf(pane);
  return {
    ...mapSession(s, sess.id, (x) => ({
      ...x,
      windows: [...x.windows, win],
      activeWindowId: win.id,
    })),
    panes: { ...s.panes, [pane.id]: pane },
  };
}

export function renameWindow(s: AppState, windowId: string, name: string | null): AppState {
  const trimmed = name?.trim();
  return {
    ...s,
    sessions: s.sessions.map((sess) =>
      mapWindow(sess, windowId, (w) => ({ ...w, name: trimmed ? trimmed : null })),
    ),
  };
}

export function closeWindow(s: AppState, sessionId: string, windowId: string): AppState {
  const sess = s.sessions.find((x) => x.id === sessionId);
  const idx = sess?.windows.findIndex((w) => w.id === windowId) ?? -1;
  if (!sess || idx < 0) return s;
  if (sess.windows.length === 1) return closeSession(s, sessionId);
  const removed = tree.leaves(sess.windows[idx].root);
  const windows = sess.windows.filter((w) => w.id !== windowId);
  const activeWindowId =
    sess.activeWindowId === windowId
      ? windows[Math.min(idx, windows.length - 1)].id
      : sess.activeWindowId;
  return {
    ...mapSession(s, sessionId, (x) => ({ ...x, windows, activeWindowId })),
    panes: without(s.panes, removed),
  };
}

export function selectWindow(s: AppState, windowId: string): AppState {
  const sess = activeSession(s);
  if (!sess || !sess.windows.some((w) => w.id === windowId)) return s;
  return mapSession(s, sess.id, (x) => ({ ...x, activeWindowId: windowId }));
}

/** 1부터 시작하는 번호로 이동 (범위 밖이면 무시) */
export function selectWindowByNumber(s: AppState, n: number): AppState {
  const win = activeSession(s)?.windows[n - 1];
  return win ? selectWindow(s, win.id) : s;
}

export function stepWindow(s: AppState, delta: 1 | -1): AppState {
  const sess = activeSession(s);
  if (!sess) return s;
  const idx = sess.windows.findIndex((w) => w.id === sess.activeWindowId);
  return selectWindow(s, sess.windows[wrap(idx + delta, sess.windows.length)].id);
}

// ── 세션 ─────────────────────────────────────────

function nextColor(sessions: Session[]): string {
  const used = new Set(sessions.map((x) => x.color));
  return (
    SESSION_COLORS.find((c) => !used.has(c)) ??
    SESSION_COLORS[sessions.length % SESSION_COLORS.length]
  );
}

/** projectCwd를 주면 그 폴더를 프로젝트 폴더로 삼아 첫 pane도 거기서 시작한다. */
export function newSession(
  s: AppState,
  name = `session-${s.sessions.length + 1}`,
  projectCwd?: string,
): AppState {
  const f = focusedPane(s);
  const { session, pane } = createSession(
    name,
    nextColor(s.sessions),
    f?.profileId ?? defaults.profile,
    projectCwd ?? cwdOf(f),
    projectCwd,
  );
  return {
    sessions: [...s.sessions, session],
    activeSessionId: session.id,
    panes: { ...s.panes, [pane.id]: pane },
  };
}

/** 프로젝트가 없을 때 AI 실행 같은 곳에서 온 pane으로 "빠른 시작" 프로젝트를 만든다. */
function sessionWithPane(s: AppState, pane: PaneSpec): AppState {
  const win = newWindowOf(pane);
  const session: Session = {
    id: uid('s'),
    name: '빠른 시작',
    color: nextColor(s.sessions),
    windows: [win],
    activeWindowId: win.id,
  };
  return {
    sessions: [...s.sessions, session],
    activeSessionId: session.id,
    panes: { ...s.panes, [pane.id]: pane },
  };
}

export function renameSession(s: AppState, sessionId: string, name: string): AppState {
  const trimmed = name.trim();
  return trimmed ? mapSession(s, sessionId, (x) => ({ ...x, name: trimmed })) : s;
}

export function closeSession(s: AppState, sessionId: string): AppState {
  const idx = s.sessions.findIndex((x) => x.id === sessionId);
  if (idx < 0) return s;
  const removed = s.sessions[idx].windows.flatMap((w) => tree.leaves(w.root));
  const panes = without(s.panes, removed);
  const sessions = s.sessions.filter((x) => x.id !== sessionId);
  // 마지막 프로젝트를 지우면 빈 시작 화면으로 돌아간다
  if (sessions.length === 0) return { sessions, activeSessionId: '', panes };
  const activeSessionId =
    s.activeSessionId === sessionId
      ? sessions[Math.min(idx, sessions.length - 1)].id
      : s.activeSessionId;
  return { sessions, activeSessionId, panes };
}

export function selectSession(s: AppState, sessionId: string): AppState {
  return s.sessions.some((x) => x.id === sessionId) ? { ...s, activeSessionId: sessionId } : s;
}

/** 1부터 시작하는 번호로 이동 (범위 밖이면 무시) */
export function selectSessionByNumber(s: AppState, n: number): AppState {
  const sess = s.sessions[n - 1];
  return sess ? selectSession(s, sess.id) : s;
}

export function stepSession(s: AppState, delta: 1 | -1): AppState {
  if (s.sessions.length === 0) return s;
  const idx = s.sessions.findIndex((x) => x.id === s.activeSessionId);
  return selectSession(s, s.sessions[wrap(idx + delta, s.sessions.length)].id);
}
