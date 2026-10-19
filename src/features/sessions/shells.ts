import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';

export interface ShellProfile {
  id: string;
  name: string;
  path: string;
  args: string[];
  isDefault: boolean;
}

interface ShellsState {
  profiles: ShellProfile[];
  load: () => Promise<void>;
}

export const useShells = create<ShellsState>()((set) => ({
  profiles: [],
  load: async () => {
    try {
      set({ profiles: await invoke<ShellProfile[]>('shells_detect') });
    } catch (e) {
      console.error('shells_detect 실패', e);
    }
  },
}));

/** 사이드바 · 목록용 아이콘 글리프 (design-mvp.html의 SHELLS와 같다) */
export function shellGlyph(id: string): string {
  if (id.startsWith('wsl:')) return '🐧';
  if (id === 'cmd') return 'C:';
  if (id === 'bash') return '$';
  return '>_';
}
