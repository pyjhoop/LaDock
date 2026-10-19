import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  /** 폰에서 열 주소 (토큰 포함) */
  url: string | null;
  /** tailscale serve로 연 HTTPS 주소 (토큰 포함) */
  httpsUrl: string | null;
  https: boolean;
  error: string | null;
  clients: number;
}

interface RemoteState {
  status: RemoteStatus | null;
  busy: boolean;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setHttps: (enabled: boolean) => Promise<void>;
  regenerate: () => Promise<void>;
}

export const useRemote = create<RemoteState>()((set) => {
  const run = async (cmd: string, args?: Record<string, unknown>) => {
    set({ busy: true });
    try {
      set({ status: await invoke<RemoteStatus>(cmd, args) });
    } catch (e) {
      console.error(`${cmd} 실패`, e);
    } finally {
      set({ busy: false });
    }
  };
  return {
    status: null,
    busy: false,
    refresh: () => run('remote_status'),
    setEnabled: (enabled) => run('remote_set_enabled', { enabled }),
    setHttps: (enabled) => run('remote_set_https', { enabled }),
    regenerate: () => run('remote_regenerate_token'),
  };
});
