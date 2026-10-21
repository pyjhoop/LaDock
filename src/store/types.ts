export type ProviderId = 'claude' | 'codex' | 'antigravity';

export type LayoutNode =
  | { type: 'pane'; paneId: string }
  | { type: 'split'; dir: 'row' | 'col'; ratio: number; a: LayoutNode; b: LayoutNode };

export interface PaneSpec {
  id: string;
  kind: 'shell' | 'agent';
  provider?: ProviderId;
  profileId: string;
  command?: string;
  args?: string[];
  /** 빈 문자열이면 셸 기본 위치 */
  cwd: string;
  title?: string;
  /** 화면에 보이는 pane 순번. 앱 전체에서 유일하고, 닫으면 가장 작은 빈 번호부터 다시 쓴다. */
  no?: number;
}

/** UI에서는 "탭" */
export interface Window {
  id: string;
  /** null이면 포커스된 pane의 프로그램 이름을 따라간다 (auto-rename) */
  name: string | null;
  root: LayoutNode;
  focusPaneId: string;
  zoomed: boolean;
}

export interface Session {
  id: string;
  name: string;
  color: string;
  windows: Window[];
  activeWindowId: string;
}

export interface AppState {
  sessions: Session[];
  activeSessionId: string;
  panes: Record<string, PaneSpec>;
}

/** 분할 경로: 루트에서 a/b를 따라 내려간다 */
export type SplitPath = ('a' | 'b')[];
