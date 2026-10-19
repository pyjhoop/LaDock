import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import type { ProviderId } from '../../store/types';
import { useProviders, type ProviderStatus } from '../ai/providers';

export interface LimitWindow {
  key: '5h' | '7d' | '1d';
  usedPct: number;
  resetsAt?: number;
  used?: number;
  limit?: number;
  /** 모델 묶음별 한도 (Antigravity) */
  group?: string;
}

export interface LimitStatus {
  provider: ProviderId;
  windows: LimitWindow[];
  source: 'official' | 'estimate' | 'none';
  sourceDetail: string;
  updatedAt?: number;
}

export interface BridgeStatus {
  state: 'connected' | 'disconnected' | 'stale' | 'unavailable';
  detail: string;
  original?: string;
}

export type Level = 'ok' | 'warn' | 'danger';

export const LEVEL_TEXT: Record<Level, string> = { ok: '여유', warn: '주의', danger: '임박' };

export const WINDOW_META: Record<LimitWindow['key'], { short: string; name: string }> = {
  '5h': { short: '5H', name: '5시간' },
  '7d': { short: '7D', name: '주간' },
  '1d': { short: '1D', name: '일일 요청' },
};

/** 여유 < 70% ≤ 주의 < 90% ≤ 임박 */
export function levelOf(pct: number): Level {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'ok';
}

/** provider에서 가장 많이 쓴 창의 상태. 창이 없으면 null. */
export function worstLevel(windows: LimitWindow[]): Level | null {
  if (!windows.length) return null;
  return levelOf(Math.max(...windows.map((w) => w.usedPct)));
}

/** 모델 묶음별로 나뉜 창을 상태바용으로 합친다: 같은 종류 창은 가장 많이 쓴 값만. */
export function mergeGroups(windows: LimitWindow[]): LimitWindow[] {
  const out: LimitWindow[] = [];
  for (const w of windows) {
    const i = out.findIndex((o) => o.key === w.key);
    if (i < 0) out.push({ ...w, group: undefined });
    else if (w.usedPct > out[i].usedPct) out[i] = { ...w, group: undefined };
  }
  return out;
}

export function roundPct(pct: number): number {
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** 리셋까지 남은 시간 문구. `nowSec`는 unix 초. */
export function formatReset(resetsAt: number | undefined, nowSec: number): string {
  if (resetsAt === undefined) return '리셋 시각 미확인';
  const left = resetsAt - nowSec;
  if (left <= 0) return '리셋 시각 지남 · 갱신 대기';
  const mins = Math.ceil(left / 60);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}일 ${h}시간 후 리셋`;
  if (h > 0) return `${h}시간 ${m}분 후 리셋`;
  return `${m}분 후 리셋`;
}

export function formatClock(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

interface LimitsState {
  items: LimitStatus[];
  bridge: BridgeStatus | null;
  load: () => Promise<void>;
  /** 캐시된 값을 받고, 낡았으면 Rust가 백그라운드로 갱신해서 `limits://changed`로 알려 준다. */
  poll: () => Promise<void>;
  refresh: () => Promise<void>;
  connectBridge: () => Promise<string | null>;
}

let listening = false;

export const useLimits = create<LimitsState>()((set, get) => ({
  items: [],
  bridge: null,
  load: async () => {
    try {
      if (!listening) {
        listening = true;
        await listen<LimitStatus[]>('limits://changed', (e) => set({ items: e.payload }));
      }
      set({ items: await invoke<LimitStatus[]>('limits_get', { force: false }) });
      set({ bridge: await invoke<BridgeStatus>('claude_bridge_status') });
    } catch (e) {
      console.error('limits_get 실패', e);
    }
  },
  poll: async () => {
    try {
      set({ items: await invoke<LimitStatus[]>('limits_get', { force: false }) });
    } catch (e) {
      console.error('limits_get 실패', e);
    }
  },
  refresh: async () => {
    try {
      const [items, statuses, bridge] = await Promise.all([
        invoke<LimitStatus[]>('limits_get', { force: true }),
        invoke<ProviderStatus[]>('providers_detect'),
        invoke<BridgeStatus>('claude_bridge_status'),
      ]);
      set({ items, bridge });
      useProviders.setState({ statuses });
    } catch (e) {
      console.error('다시 확인 실패', e);
    }
  },
  /** 사용자 확인을 받은 뒤에만 호출한다. 실패하면 안내 문장을 돌려준다. */
  connectBridge: async () => {
    try {
      set({ bridge: await invoke<BridgeStatus>('claude_bridge_connect', { confirm: true }) });
      await get().refresh();
      return null;
    } catch (e) {
      return String(e);
    }
  },
}));
