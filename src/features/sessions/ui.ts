import { create } from 'zustand';
import { useStore } from '../../store/store';
import type { PaneSpec, ProviderId } from '../../store/types';

/** 이름을 인라인으로 바꾸는 중인 대상 */
export type Renaming = { target: 'session' | 'window'; id: string } | null;

interface SessionsUi {
  renaming: Renaming;
  sidebarOpen: boolean;
  startRename: (r: NonNullable<Renaming>) => void;
  stopRename: () => void;
  toggleSidebar: () => void;
}

export const useSessionsUi = create<SessionsUi>()((set) => ({
  renaming: null,
  sidebarOpen: true,
  startRename: (renaming) => set({ renaming }),
  stopRename: () => set({ renaming: null }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

/** 새 세션을 만들고 바로 이름 입력 상태로 들어간다 */
export function createSessionAndRename() {
  useStore.getState().newSession();
  const { activeSessionId } = useStore.getState();
  useSessionsUi.getState().startRename({ target: 'session', id: activeSessionId });
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
