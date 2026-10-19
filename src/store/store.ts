import { create } from 'zustand';
import { killPanePty } from '../features/terminal/registry';
import * as ops from './ops';
import type { AppState, SplitPath } from './types';

interface Actions {
  focusPane: (paneId: string) => void;
  splitFocused: (dir: 'row' | 'col') => void;
  closePane: (paneId: string) => void;
  setRatio: (windowId: string, path: SplitPath, ratio: number) => void;
  toggleZoom: () => void;
  newWindow: () => void;
  renameWindow: (windowId: string, name: string | null) => void;
  closeWindow: (sessionId: string, windowId: string) => void;
  selectWindow: (windowId: string) => void;
  selectWindowByNumber: (n: number) => void;
  stepWindow: (delta: 1 | -1) => void;
  newSession: (name?: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  closeSession: (sessionId: string) => void;
  selectSession: (sessionId: string) => void;
  selectSessionByNumber: (n: number) => void;
  stepSession: (delta: 1 | -1) => void;
}

export const useStore = create<AppState & Actions>()((set) => {
  // 모든 상태 변경이 여기를 지난다: store에서 사라진 pane의 PTY는 한 곳에서 종료한다.
  const apply = (f: (s: AppState) => AppState) =>
    set((cur) => {
      const next = f(cur);
      for (const id of Object.keys(cur.panes)) if (!(id in next.panes)) killPanePty(id);
      return next;
    });

  return {
    ...ops.createInitialState(),
    focusPane: (id) => apply((s) => ops.focusPane(s, id)),
    splitFocused: (dir) => apply((s) => ops.splitFocused(s, dir)),
    closePane: (id) => apply((s) => ops.closePane(s, id)),
    setRatio: (w, p, r) => apply((s) => ops.setRatio(s, w, p, r)),
    toggleZoom: () => apply(ops.toggleZoom),
    newWindow: () => apply(ops.newWindow),
    renameWindow: (id, name) => apply((s) => ops.renameWindow(s, id, name)),
    closeWindow: (sid, wid) => apply((s) => ops.closeWindow(s, sid, wid)),
    selectWindow: (id) => apply((s) => ops.selectWindow(s, id)),
    selectWindowByNumber: (n) => apply((s) => ops.selectWindowByNumber(s, n)),
    stepWindow: (d) => apply((s) => ops.stepWindow(s, d)),
    newSession: (name) => apply((s) => ops.newSession(s, name)),
    renameSession: (id, name) => apply((s) => ops.renameSession(s, id, name)),
    closeSession: (id) => apply((s) => ops.closeSession(s, id)),
    selectSession: (id) => apply((s) => ops.selectSession(s, id)),
    selectSessionByNumber: (n) => apply((s) => ops.selectSessionByNumber(s, n)),
    stepSession: (d) => apply((s) => ops.stepSession(s, d)),
  };
});
