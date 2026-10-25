import { open } from '@tauri-apps/plugin-dialog';
import { create } from 'zustand';
import { remoteClient } from '../remote/client';
import { useStore } from '../../store/store';
import type { PaneSpec, ProviderId } from '../../store/types';

/** 이름을 인라인으로 바꾸는 중인 대상 */
/** from: 입력창을 띄울 위치 (같은 대상을 두 곳에 동시에 띄우지 않는다) */
export type Renaming = {
  target: 'session' | 'window';
  id: string;
  from: 'title' | 'side';
} | null;

/** 창 폭 구간: wide ≥1024 · mid 640–1023(사이드바=드로어) · narrow <640(스택 모드) */
export type LayoutMode = 'wide' | 'mid' | 'narrow';

export const layoutModeOf = (width: number): LayoutMode =>
  width >= 1024 ? 'wide' : width >= 640 ? 'mid' : 'narrow';

interface SessionsUi {
  renaming: Renaming;
  sidebarOpen: boolean;
  mode: LayoutMode;
  drawerOpen: boolean;
  setMode: (m: LayoutMode) => void;
  closeDrawer: () => void;
  startRename: (r: NonNullable<Renaming>) => void;
  stopRename: () => void;
  toggleSidebar: () => void;
}

export const useSessionsUi = create<SessionsUi>()((set) => ({
  renaming: null,
  sidebarOpen: true,
  mode: layoutModeOf(window.innerWidth),
  drawerOpen: false,
  setMode: (mode) => set({ mode, drawerOpen: false }),
  closeDrawer: () => set({ drawerOpen: false }),
  startRename: (renaming) => set({ renaming }),
  stopRename: () => set({ renaming: null }),
  toggleSidebar: () =>
    set((s) =>
      s.mode === 'wide' ? { sidebarOpen: !s.sidebarOpen } : { drawerOpen: !s.drawerOpen },
    ),
}));

/** 폴더 이름(경로의 마지막 조각) */
export const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path;

/** 폴더 없이 셸 기본 위치(홈)에서 바로 시작하는 프로젝트 — AI를 빠르게 쓸 때 */
export function addQuickProject() {
  const { sessions, newSession } = useStore.getState();
  const base = '빠른 시작';
  let name = base;
  for (let n = 2; sessions.some((s) => s.name === name); n++) name = `${base} ${n}`;
  newSession(name, '');
}

/** 폴더를 골라 새 프로젝트로 추가한다. 취소하면 아무것도 하지 않는다. */
export async function addProject() {
  if (remoteClient) return useStore.getState().newSession();
  const dir = await open({ directory: true, multiple: false, title: '프로젝트 폴더 선택' });
  if (typeof dir !== 'string') return;
  useStore.getState().newSession(folderName(dir), dir);
}

export const PROVIDER_GLYPH: Record<ProviderId, { glyph: string; color: string }> = {
  claude: { glyph: '✻', color: '#d97757' },
  antigravity: { glyph: '▲', color: '#a67cf0' },
  codex: { glyph: '◎', color: '#8fa1b3' },
};

/** pane들에서 실행 중인 AI provider를 중복 없이 모은다. detected: 일반 셸에서 직접 띄운 것 */
export function providersOf(
  panes: (PaneSpec | undefined)[],
  detected: Record<string, ProviderId> = {},
): ProviderId[] {
  const set = new Set<ProviderId>();
  for (const p of panes) {
    if (!p) continue;
    const id = p.kind === 'agent' ? p.provider : detected[p.id];
    if (id) set.add(id);
  }
  return [...set];
}
