import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../../store/store';
import type { AppState } from '../../store/types';
import { onPtyChange, ptyEntries } from '../terminal/registry';

const DEBOUNCE_MS = 200;

/** 폰에 보내는 내용: 앱 상태 + pane ↔ PTY 대응 */
export interface RemoteSnapshot {
  state: AppState;
  ptys: Record<string, number>;
}

/** store에서 데이터 필드만 (액션 함수 제외) */
export const pickState = (s: AppState): AppState => ({
  sessions: s.sessions,
  activeSessionId: s.activeSessionId,
  panes: s.panes,
});

export const isAppState = (v: unknown): v is AppState => {
  const o = v as AppState | null;
  return (
    typeof o === 'object' &&
    o !== null &&
    Array.isArray(o.sessions) &&
    typeof o.activeSessionId === 'string' &&
    typeof o.panes === 'object' &&
    o.panes !== null
  );
};

let last = '';

async function publish() {
  const snap: RemoteSnapshot = {
    state: pickState(useStore.getState()),
    ptys: Object.fromEntries(ptyEntries()),
  };
  const json = JSON.stringify(snap);
  if (json === last) return;
  try {
    await invoke('remote_set_layout', { json });
    last = json;
  } catch (e) {
    console.error('remote_set_layout 실패', e);
  }
}

interface RpcRequest {
  client: number;
  id: number;
  cmd: string;
  args?: Record<string, unknown>;
}

/**
 * PC 쪽 연결: 상태가 바뀌면 모바일 hub에 밀어 주고, 폰이 바꾼 상태와 폰의 조회 요청(rpc)을 받아 처리한다.
 * 해제 함수를 돌려준다.
 */
export function startRemotePublish(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void publish(), DEBOUNCE_MS);
  };
  const unsubStore = useStore.subscribe(schedule);
  const unsubPty = onPtyChange(schedule);

  const unlistenState = listen<unknown>('remote://state', (e) => {
    if (!isAppState(e.payload)) return;
    const next = pickState(e.payload);
    if (JSON.stringify(next) !== JSON.stringify(pickState(useStore.getState()))) {
      useStore.setState(next);
    }
  });
  const unlistenRpc = listen<RpcRequest>('remote://rpc', async (e) => {
    const { client, id, cmd, args } = e.payload;
    try {
      const value = await invoke(cmd, args);
      await invoke('remote_rpc_reply', {
        client,
        id,
        ok: true,
        result: JSON.stringify(value ?? null),
      });
    } catch (err) {
      await invoke('remote_rpc_reply', {
        client,
        id,
        ok: false,
        result: JSON.stringify(String(err)),
      }).catch(() => {});
    }
  });
  schedule();
  return () => {
    clearTimeout(timer);
    unsubStore();
    unsubPty();
    void unlistenState.then((un) => un());
    void unlistenRpc.then((un) => un());
  };
}
