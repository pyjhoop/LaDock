import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { ProviderId } from '../../store/types';
import { ptyEntries } from './registry';

const POLL_MS = 2000;

/** 일반 셸 pane 안에서 사용자가 직접 띄운 AI CLI. store 밖에 둔다 (저장 · pane 재생성과 무관). */
export const useDetected = create<{ byPane: Record<string, ProviderId> }>()(() => ({ byPane: {} }));

async function poll() {
  const entries = ptyEntries();
  let byPane: Record<string, ProviderId> = {};
  if (entries.length > 0) {
    const found = await invoke<Record<string, ProviderId>>('pty_detect_agents', {
      paneIds: entries.map(([, id]) => id),
    });
    for (const [key, id] of entries) if (found[id]) byPane[key] = found[id];
  } else byPane = {};
  const prev = useDetected.getState().byPane;
  const same =
    Object.keys(byPane).length === Object.keys(prev).length &&
    Object.entries(byPane).every(([k, v]) => prev[k] === v);
  if (!same) useDetected.setState({ byPane });
}

/** 셸 pane의 자식 프로세스를 주기적으로 확인해 AI 표시를 갱신한다. 해제 함수를 돌려준다. */
export function startAgentDetect(): () => void {
  const timer = setInterval(() => {
    if (!document.hidden) void poll().catch(() => {});
  }, POLL_MS);
  return () => clearInterval(timer);
}
