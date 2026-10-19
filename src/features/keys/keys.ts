import { create } from 'zustand';
import { activeSession, activeWindow } from '../../store/ops';
import { useStore } from '../../store/store';
import { createSessionAndRename, useSessionsUi } from '../sessions/ui';
import { writePanePty } from '../terminal/registry';
import {
  DEFAULT_PREFIX,
  PREFIX_TIMEOUT_MS,
  isModifierOnly,
  matchesPrefix,
  prefixControlChar,
  resolveKey,
  type Command,
  type PrefixSpec,
} from './keymap';

export type Overlay =
  | { kind: 'help' }
  | { kind: 'tree' }
  | { kind: 'rename'; target: 'session' | 'window'; id: string; value: string };
// 실행 팔레트(M2-02)는 화면을 만들 때 여기에 추가한다.

interface KeysState {
  prefix: PrefixSpec;
  prefixActive: boolean;
  overlay: Overlay | null;
  setPrefix: (p: PrefixSpec) => void;
  openOverlay: (o: Overlay) => void;
  closeOverlay: () => void;
}

export const useKeys = create<KeysState>()((set) => ({
  prefix: DEFAULT_PREFIX,
  prefixActive: false,
  overlay: null,
  setPrefix: (prefix) => set({ prefix }),
  openOverlay: (overlay) => set({ overlay }),
  closeOverlay: () => {
    set({ overlay: null });
    // 오버레이가 가져간 키 입력 포커스를 터미널에 돌려준다
    requestAnimationFrame(() => {
      // 인라인 이름 입력 중이면 포커스를 뺏지 않는다 (blur가 곧 저장이라 입력이 바로 닫힌다)
      if (useSessionsUi.getState().renaming) return;
      document.querySelector<HTMLElement>('.pane.focused .xterm-helper-textarea')?.focus();
    });
  },
}));

export function runCommand(cmd: Command) {
  const store = useStore.getState();
  const keys = useKeys.getState();
  const sess = activeSession(store);
  const win = activeWindow(sess);
  switch (cmd.id) {
    case 'palette':
      // 화면이 생기기 전(M2-02)에 상태만 열면 닫을 수 없어 이후 키가 먹통이 된다.
      return;
    case 'tree':
      return keys.openOverlay({ kind: 'tree' });
    case 'help':
      return keys.openOverlay({ kind: 'help' });
    case 'newSession':
      return createSessionAndRename();
    case 'renameSession':
      return keys.openOverlay({ kind: 'rename', target: 'session', id: sess.id, value: sess.name });
    case 'stepSession':
      return store.stepSession(cmd.delta);
    case 'closeSession':
      return store.closeSession(sess.id);
    case 'newWindow':
      return store.newWindow();
    case 'renameWindow':
      return keys.openOverlay({
        kind: 'rename',
        target: 'window',
        id: win.id,
        value: win.name ?? '',
      });
    case 'stepWindow':
      return store.stepWindow(cmd.delta);
    case 'selectWindow':
      return store.selectWindowByNumber(cmd.n);
    case 'closeWindow':
      return store.closeWindow(sess.id, win.id);
    case 'split':
      return store.splitFocused(cmd.dir);
    case 'moveFocus':
      return store.moveFocus(cmd.dir);
    case 'resize':
      return store.resizeFocused(cmd.dir);
    case 'zoom':
      return store.toggleZoom();
    case 'closePane':
      return store.closePane(win.focusPaneId);
    case 'sendPrefix': {
      const ch = prefixControlChar(keys.prefix);
      if (ch) writePanePty(win.focusPaneId, ch);
      return;
    }
  }
}

let timer: number | undefined;

function setActive(active: boolean) {
  clearTimeout(timer);
  useKeys.setState({ prefixActive: active });
  if (active) timer = window.setTimeout(() => setActive(false), PREFIX_TIMEOUT_MS);
}

/**
 * prefix 상태 머신. true를 돌려주면 이 키는 처리됐으니 터미널로 보내지 않는다.
 * window 캡처 단계에서 호출해 xterm보다 먼저 가로챈다.
 */
export function handleKeyDown(e: KeyboardEvent): boolean {
  const { prefix, prefixActive, overlay } = useKeys.getState();
  if (overlay) return false; // 오버레이는 자기 입력을 직접 받는다
  if (!prefixActive) {
    if (!matchesPrefix(e, prefix)) return false;
    setActive(true);
    return true;
  }
  if (isModifierOnly(e)) return false; // 조합 키 대기
  setActive(false);
  const cmd = resolveKey(e, prefix);
  if (cmd) runCommand(cmd);
  return true; // 알 수 없는 키도 삼키고 prefix만 해제 (tmux와 동일)
}

export function installKeyHandler(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (handleKeyDown(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
