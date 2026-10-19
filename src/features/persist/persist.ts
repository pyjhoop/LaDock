import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { create } from 'zustand';
import { useStore } from '../../store/store';
import type { AppState } from '../../store/types';
import { getPaneCwd } from '../terminal/registry';
import { agentPanes, applyResume, fixMissingCwds, parseStateFile, snapshotState } from './snapshot';

const DEBOUNCE_MS = 1000;
/** cwd는 store 밖(OSC 7)에서 바뀌므로 주기적으로도 확인한다 */
const POLL_MS = 15000;

export type RestorePhase =
  | { phase: 'loading' }
  /** 이어하기를 물을 AI pane이 있다 */
  | { phase: 'ask'; state: AppState; agents: number }
  | { phase: 'ready' };

interface RestoreUi {
  restore: RestorePhase;
  /** 복원하지 못했을 때 사용자에게 보여줄 안내 */
  notice: string | null;
  set: (p: Partial<RestoreUi>) => void;
  dismissNotice: () => void;
}

export const useRestore = create<RestoreUi>()((set) => ({
  restore: { phase: 'loading' },
  notice: null,
  set: (p) => set(p),
  dismissNotice: () => set({ notice: null }),
}));

async function checkCwds(state: AppState): Promise<AppState> {
  const cwds = [
    ...new Set(
      Object.values(state.panes)
        .map((p) => p.cwd)
        .filter(Boolean),
    ),
  ];
  if (cwds.length === 0) return state;
  const found = await invoke<boolean[]>('dirs_exist', { paths: cwds });
  const ok = new Set(cwds.filter((_, i) => found[i]));
  return fixMissingCwds(state, (c) => ok.has(c));
}

function commit(state: AppState) {
  useStore.setState(state);
  useRestore.getState().set({ restore: { phase: 'ready' } });
}

/** 시작할 때 한 번: 저장된 상태를 불러온다. 이어하기를 물을 AI pane이 있으면 물어본다. */
export async function loadSaved(): Promise<void> {
  const ui = useRestore.getState();
  try {
    const text = await invoke<string | null>('state_load');
    if (text === null) return ui.set({ restore: { phase: 'ready' } });
    const parsed = parseStateFile(text);
    if (!parsed.ok) {
      const backup = await invoke<string | null>('state_quarantine').catch(() => null);
      return ui.set({
        restore: { phase: 'ready' },
        notice: `저장된 레이아웃을 열 수 없어 새 세션으로 시작합니다 (${parsed.reason})${
          backup ? ` — 원본은 ${backup} 에 보관했습니다` : ''
        }`,
      });
    }
    const state = await checkCwds(parsed.state);
    const agents = agentPanes(state).length;
    if (agents === 0) return commit(state);
    ui.set({ restore: { phase: 'ask', state, agents } });
  } catch (e) {
    console.error('state_load 실패', e);
    ui.set({
      restore: { phase: 'ready' },
      notice: '저장된 레이아웃을 읽지 못해 새 세션으로 시작합니다',
    });
  }
}

/** 이어하기 선택 후 확정 */
export function chooseResume(resume: boolean) {
  const r = useRestore.getState().restore;
  if (r.phase === 'ask') commit(applyResume(r.state, resume));
}

let lastSaved = '';

async function save() {
  const json = JSON.stringify(snapshotState(useStore.getState(), getPaneCwd));
  if (json === lastSaved) return;
  try {
    await invoke('state_save', { json });
    lastSaved = json;
  } catch (e) {
    console.error('state_save 실패', e);
  }
}

/** 복원이 끝난 뒤에 켠다. 변경 1초 디바운스 + 주기 확인 + 종료 직전 저장. 해제 함수를 돌려준다. */
export function startAutoSave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = useStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void save(), DEBOUNCE_MS);
  });
  const poll = setInterval(() => void save(), POLL_MS);
  let unlisten: (() => void) | undefined;
  let disposed = false;
  const win = getCurrentWindow();
  void win
    .onCloseRequested(async (e) => {
      e.preventDefault();
      clearTimeout(timer);
      await save();
      await win.destroy();
    })
    .then((u) => (disposed ? u() : (unlisten = u)));
  return () => {
    disposed = true;
    unsub();
    clearTimeout(timer);
    clearInterval(poll);
    unlisten?.();
  };
}
