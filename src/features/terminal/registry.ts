import { ptyKill, ptyWrite } from './pty';

// store pane id → PTY id. TerminalPane이 spawn 직후 등록하고, store가 pane을 지울 때 kill한다.
const ptys = new Map<string, number>();

export const registerPty = (paneKey: string, ptyId: number) => void ptys.set(paneKey, ptyId);

export const unregisterPty = (paneKey: string, ptyId: number) => {
  if (ptys.get(paneKey) === ptyId) ptys.delete(paneKey);
};

export function killPanePty(paneKey: string) {
  const id = ptys.get(paneKey);
  if (id === undefined) return;
  ptys.delete(paneKey);
  void ptyKill(id).catch(() => {});
}

export function writePanePty(paneKey: string, data: string) {
  const id = ptys.get(paneKey);
  if (id !== undefined) void ptyWrite(id, new TextEncoder().encode(data)).catch(() => {});
}
