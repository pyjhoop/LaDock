import { create } from 'zustand';
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

/** 새 세션을 만들고 바로 이름 입력 상태로 들어간다 */
export function createSessionAndRename() {
  useStore.getState().newSession();
  const { activeSessionId } = useStore.getState();
  useSessionsUi.getState().startRename({ target: 'session', id: activeSessionId, from: 'title' });
}

export const PROVIDER_GLYPH: Record<ProviderId, { glyph: string; color: string }> = {
  claude: { glyph: '✻', color: '#d97757' },
  gemini: { glyph: '✦', color: '#5b8def' },
  antigravity: { glyph: '▲', color: '#a67cf0' },
  codex: { glyph: '◎', color: '#8fa1b3' },
};

/** pane들에서 실행 중인 AI provider를 중복 없이 모은다 */
export function providersOf(panes: (PaneSpec | undefined)[]): ProviderId[] {
  const set = new Set<ProviderId>();
  for (const p of panes) if (p?.kind === 'agent' && p.provider) set.add(p.provider);
  return [...set];
}
