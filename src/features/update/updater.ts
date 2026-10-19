import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';

export type UpdatePhase = 'idle' | 'checking' | 'uptodate' | 'available' | 'installing' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  notes: string | null;
  /** 0~100. 크기를 모르면 null */
  progress: number | null;
  error: string | null;
  /** 배너를 닫았는지 (설정 화면에서는 계속 보인다) */
  dismissed: boolean;
  check: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

let pending: Update | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useUpdate = create<UpdateState>((set, get) => ({
  phase: 'idle',
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: false,

  /** silent: 시작 시 자동 확인 — 실패해도 조용히 넘어간다 */
  check: async ({ silent = false } = {}) => {
    const { phase } = get();
    if (phase === 'checking' || phase === 'installing') return;
    set({ phase: 'checking', error: null });
    try {
      const update = await check();
      pending = update;
      if (update) {
        set({
          phase: 'available',
          version: update.version,
          notes: update.body?.trim() || null,
          dismissed: false,
        });
      } else {
        set({ phase: 'uptodate', version: null, notes: null });
      }
    } catch (e) {
      set(silent ? { phase: 'idle' } : { phase: 'error', error: message(e) });
    }
  },

  install: async () => {
    if (!pending || get().phase === 'installing') return;
    set({ phase: 'installing', progress: null, error: null });
    let total = 0;
    let done = 0;
    try {
      await pending.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          if (total) set({ progress: Math.min(100, Math.round((done / total) * 100)) });
        }
      });
      await relaunch();
    } catch (e) {
      set({ phase: 'error', error: message(e) });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
