import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { create } from 'zustand';
import { assignPaneNumbers, createEmptyState } from '../../store/ops';
import { useStore } from '../../store/store';
import type { AppState } from '../../store/types';
import { baseArgs, PROVIDER_META, useProviders } from '../ai/providers';
import { loadSettings } from '../settings/settings';
import { useDetected } from '../terminal/detect';
import { getPaneCwd } from '../terminal/registry';
import { applyResume, fixMissingCwds, parseStateFile, snapshotState } from './snapshot';

const DEBOUNCE_MS = 1000;
/** cwd는 store 밖(OSC 7)에서 바뀌므로 주기적으로도 확인한다 */
const POLL_MS = 15000;

export type RestorePhase = { phase: 'loading' } | { phase: 'ready' };

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
  useStore.setState(assignPaneNumbers(state));
  useRestore.getState().set({ restore: { phase: 'ready' } });
}

/** 시작할 때 한 번: 저장된 상태를 불러온다. 이어하기를 물을 AI pane이 있으면 물어본다. */
export async function loadSaved(): Promise<void> {
  const ui = useRestore.getState();
  // 기본 셸 설정이 첫 프로젝트에 반영되도록 설정부터 읽는다
  await loadSettings();
  try {
    const text = await invoke<string | null>('state_load');
    if (text === null) return commit(createEmptyState());
    const parsed = parseStateFile(text);
    if (!parsed.ok) {
      const backup = await invoke<string | null>('state_quarantine').catch(() => null);
      return ui.set({
        restore: { phase: 'ready' },
        notice: `저장된 레이아웃을 열 수 없어 새 프로젝트로 시작합니다 (${parsed.reason})${
          backup ? ` — 원본은 ${backup} 에 보관했습니다` : ''
        }`,
      });
    }
    // 묻지 않고 항상 이전 상태 그대로 이어서 연다
    commit(applyResume(await checkCwds(parsed.state), true));
  } catch (e) {
    console.error('state_load 실패', e);
    ui.set({
      restore: { phase: 'ready' },
      notice: '저장된 레이아웃을 읽지 못해 새 프로젝트로 시작합니다',
    });
  }
}

let lastSaved = '';

async function save() {
  const detected = useDetected.getState().byPane;
  const json = JSON.stringify(
    snapshotState(useStore.getState(), getPaneCwd, (id) => {
      const provider = detected[id];
      if (!provider) return undefined;
      const meta = PROVIDER_META[provider];
      const bin = useProviders.getState().statuses.find((s) => s.id === provider)?.binPath;
      return {
        kind: 'agent',
        provider,
        command: bin ?? meta.bin,
        args: baseArgs(provider),
        title: meta.name,
      };
    }),
  );
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
  // 닫기는 종료가 아니라 트레이로 숨김. preventDefault를 안 하면 JS 쪽이 창을 destroy한다.
  const win = getCurrentWindow();
  void win
    .onCloseRequested(async (e) => {
      e.preventDefault();
      clearTimeout(timer);
      await save();
      await win.hide();
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
