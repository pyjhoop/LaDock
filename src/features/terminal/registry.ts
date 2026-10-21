import { create } from 'zustand';
import { liveCwd } from '../../store/ops';
import { ptyKill, ptyWrite } from './pty';

// store pane id → PTY id. TerminalPane이 spawn 직후 등록하고, store가 pane을 지울 때 kill한다.
const ptys = new Map<string, number>();

const listeners = new Set<() => void>();

/** PTY 등록이 바뀔 때 알린다 (모바일 원격 레이아웃 발행용). 해제 함수를 돌려준다. */
export const onPtyChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const changed = () => listeners.forEach((fn) => fn());

export const registerPty = (paneKey: string, ptyId: number) => {
  ptys.set(paneKey, ptyId);
  changed();
};

export const unregisterPty = (paneKey: string, ptyId: number) => {
  if (ptys.get(paneKey) === ptyId) {
    ptys.delete(paneKey);
    changed();
  }
};

/** (store pane id, PTY id) 목록 */
export const ptyEntries = () => [...ptys.entries()];

export function killPanePty(paneKey: string) {
  const id = ptys.get(paneKey);
  if (id === undefined) return;
  ptys.delete(paneKey);
  changed();
  void ptyKill(id).catch(() => {});
}

export function writePanePty(paneKey: string, data: string) {
  const id = ptys.get(paneKey);
  if (id !== undefined) void ptyWrite(id, new TextEncoder().encode(data)).catch(() => {});
}

// store pane id → 셸이 OSC 7로 알려 준 현재 폴더. store에 넣으면 cwd가 바뀔 때 pane이 다시 만들어지므로 따로 둔다.
const cwds = new Map<string, string>();

/** 같은 값을 화면(사이드바)에서 구독하기 위한 사본 */
export const usePaneCwds = create<{ byPane: Record<string, string> }>()(() => ({ byPane: {} }));

export const setPaneCwd = (paneKey: string, cwd: string) => {
  cwds.set(paneKey, cwd);
  usePaneCwds.setState((s) => ({ byPane: { ...s.byPane, [paneKey]: cwd } }));
};
export const getPaneCwd = (paneKey: string) => cwds.get(paneKey);
export const clearPaneCwd = (paneKey: string) => {
  cwds.delete(paneKey);
  usePaneCwds.setState((s) => {
    const byPane = { ...s.byPane };
    delete byPane[paneKey];
    return { byPane };
  });
};
liveCwd.of = getPaneCwd;

/** OSC 7 페이로드(`file://host/C:/dir`) → Windows 경로. 해석할 수 없으면 null. */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/i.exec(data);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, '\\') : null;
}
