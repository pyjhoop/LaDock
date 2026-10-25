import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { activeSession, projectCwd } from '../../store/ops';
import { useStore } from '../../store/store';
import { remoteClient } from '../remote/client';
import { usePaneCwds } from '../terminal/registry';

export interface RepoInfo {
  root: string;
  branch: string | null;
  isGit: boolean;
}
export interface DirEntry {
  name: string;
  isDir: boolean;
}
export interface FileContent {
  text: string;
  truncated: boolean;
  binary: boolean;
  size: number;
}

export interface OpenFile {
  rel: string;
  content: FileContent | null;
  error: string | null;
}

interface FilesState {
  /** 패널 표시 여부(사용자 설정) */
  panelOpen: boolean;
  /** 패널 폭(px) */
  width: number;
  setWidth: (w: number) => void;
  /** 패널이 보여줄 폴더: git 저장소면 저장소 루트, 아니면 프로젝트 폴더 */
  git: RepoInfo | null;
  /** 폴더별 항목 캐시. 키는 root 기준 상대 경로('' = 루트) */
  dirs: Record<string, DirEntry[]>;
  expanded: Record<string, boolean>;
  file: OpenFile | null;
  setPanelOpen: (open: boolean) => void;
  setGit: (git: RepoInfo | null) => void;
  toggleDir: (rel: string) => void;
  refresh: () => void;
  openFile: (rel: string) => void;
  closeFile: () => void;
}

/** 상대 경로 이어 붙이기 (항상 `/` 구분) */
export const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export const MIN_W = 200;
export const MAX_W = 640;
const W_KEY = 'ladock.filesWidth';
function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(W_KEY));
    if (n >= MIN_W && n <= MAX_W) return n;
  } catch {
    // 기본값 사용
  }
  return 260;
}

export const useFiles = create<FilesState>()((set, get) => {
  const loadDir = (rel: string) => {
    const root = get().git?.root;
    if (!root) return;
    invoke<DirEntry[]>('fs_list', { root, rel })
      .then((list) => {
        if (get().git?.root === root) set((s) => ({ dirs: { ...s.dirs, [rel]: list } }));
      })
      .catch(() => {
        if (get().git?.root === root) set((s) => ({ dirs: { ...s.dirs, [rel]: [] } }));
      });
  };

  return {
    panelOpen: true,
    width: loadWidth(),
    setWidth: (w) => {
      const width = Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
      set({ width });
      try {
        localStorage.setItem(W_KEY, String(width));
      } catch {
        // 저장 못 해도 동작에는 지장 없다
      }
    },
    git: null,
    dirs: {},
    expanded: {},
    file: null,
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setGit: (git) => {
      const cur = get().git;
      if (cur?.root === git?.root) {
        // 같은 저장소: 브랜치만 갱신
        if (cur?.branch !== git?.branch) set({ git });
        return;
      }
      set({ git, dirs: {}, expanded: {}, file: null });
      loadDir('');
    },
    toggleDir: (rel) => {
      const open = !get().expanded[rel];
      set((s) => ({ expanded: { ...s.expanded, [rel]: open } }));
      if (open && !get().dirs[rel]) loadDir(rel);
    },
    refresh: () => {
      const root = get().git?.root;
      if (root) {
        // 브랜치가 바뀌었을 수 있다 (git이 아니면 그대로)
        invoke<RepoInfo | null>('fs_root', { cwd: root })
          .then((g) => g?.isGit && get().git?.root === g.root && get().setGit(g))
          .catch(() => {});
      }
      const open = Object.keys(get().expanded).filter((k) => get().expanded[k]);
      loadDir('');
      for (const rel of open) loadDir(rel);
    },
    openFile: (rel) => {
      const root = get().git?.root;
      if (!root) return;
      set({ file: { rel, content: null, error: null } });
      invoke<FileContent>('fs_read', { root, rel })
        .then((content) => {
          if (get().file?.rel === rel) set({ file: { rel, content, error: null } });
        })
        .catch((e) => {
          if (get().file?.rel === rel) set({ file: { rel, content: null, error: String(e) } });
        });
    },
    closeFile: () => set({ file: null }),
  };
});

/** 활성 프로젝트의 폴더(git이면 저장소 루트)를 패널 루트로 store에 반영한다. */
export function startGitDetect(): () => void {
  if (remoteClient) return () => {};
  let last = '';
  let seq = 0;
  const run = () => {
    const state = useStore.getState();
    const cwd = projectCwd(state, activeSession(state));
    if (cwd === last) return;
    last = cwd;
    const mine = ++seq;
    invoke<RepoInfo | null>('fs_root', { cwd })
      .then((g) => mine === seq && useFiles.getState().setGit(g))
      .catch(() => mine === seq && useFiles.getState().setGit(null));
  };
  run();
  const unsubA = useStore.subscribe(run);
  const unsubB = usePaneCwds.subscribe(run);
  return () => {
    unsubA();
    unsubB();
  };
}
