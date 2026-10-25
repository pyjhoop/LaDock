import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { activeSession, defaults, projectCwd, uid } from '../../store/ops';
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

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  /** 푸시할 커밋 수 */
  ahead: number;
  /** 풀할 커밋 수 (마지막 fetch 기준) */
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}
export interface Commit {
  hash: string;
  short: string;
  author: string;
  when: string;
  refs: string[];
  subject: string;
}

const LOG_PAGE = 50;

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
  tab: 'files' | 'log';
  setTab: (tab: 'files' | 'log') => void;
  status: GitStatus | null;
  statusError: string | null;
  commits: Commit[];
  /** 더 불러올 커밋이 없는지 */
  logEnd: boolean;
  logLoading: boolean;
  logError: string | null;
  fetching: boolean;
  fetchError: string | null;
  loadStatus: () => void;
  loadLog: (more: boolean) => void;
  fetchRemote: () => void;
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
    tab: 'files',
    setTab: (tab) => {
      set({ tab });
      if (tab === 'log' && get().commits.length === 0 && !get().logEnd) get().loadLog(false);
    },
    status: null,
    statusError: null,
    commits: [],
    logEnd: false,
    logLoading: false,
    logError: null,
    fetching: false,
    fetchError: null,
    loadStatus: () => {
      const root = get().git?.isGit ? get().git?.root : undefined;
      if (!root) return;
      invoke<GitStatus>('git_status', { root })
        .then((status) => get().git?.root === root && set({ status, statusError: null }))
        .catch((e) => get().git?.root === root && set({ statusError: String(e) }));
    },
    loadLog: (more) => {
      const root = get().git?.isGit ? get().git?.root : undefined;
      if (!root || get().logLoading) return;
      const skip = more ? get().commits.length : 0;
      set({ logLoading: true, logError: null });
      invoke<Commit[]>('git_log', { root, limit: LOG_PAGE, skip })
        .then((list) => {
          if (get().git?.root !== root) return;
          set((s) => ({
            commits: more ? [...s.commits, ...list] : list,
            logEnd: list.length < LOG_PAGE,
            logLoading: false,
          }));
        })
        .catch((e) => {
          if (get().git?.root === root) set({ logLoading: false, logError: String(e) });
        });
    },
    fetchRemote: () => {
      const root = get().git?.isGit ? get().git?.root : undefined;
      if (!root || get().fetching) return;
      set({ fetching: true, fetchError: null });
      invoke('git_fetch', { root })
        .then(() => {
          if (get().git?.root !== root) return;
          set({ fetching: false });
          get().loadStatus();
          if (get().tab === 'log') get().loadLog(false);
        })
        .catch((e) => {
          if (get().git?.root === root) set({ fetching: false, fetchError: String(e) });
        });
    },
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
      set({
        git,
        dirs: {},
        expanded: {},
        file: null,
        tab: 'files',
        status: null,
        statusError: null,
        commits: [],
        logEnd: false,
        logError: null,
        fetchError: null,
      });
      loadDir('');
      get().loadStatus();
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
      get().loadStatus();
      if (get().tab === 'log') get().loadLog(false);
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

/** 커밋이 바꾼 내용을 새 탭(변경 내용 보기 pane)으로 연다. */
export function openCommit(c: Commit): void {
  const root = useFiles.getState().git?.root;
  if (!root) return;
  const store = useStore.getState();
  store.openPane('tab', {
    id: uid('p'),
    kind: 'diff',
    profileId: defaults.profile,
    cwd: root,
    diff: { root, hash: c.hash },
  });
  const { activeWindowId } = activeSession(useStore.getState()) ?? {};
  if (activeWindowId) store.renameWindow(activeWindowId, `${c.short} ${c.subject}`.slice(0, 32));
}

/** 활성 프로젝트의 폴더(git이면 저장소 루트)를 패널 루트로 store에 반영한다. */
export function startGitDetect(): () => void {
  if (remoteClient) return () => {};
  // NONE: 프로젝트가 없는 상태
  const NONE = '<none>';
  let last = '';
  let seq = 0;
  const run = () => {
    const state = useStore.getState();
    const sess = activeSession(state);
    const cwd = sess ? projectCwd(state, sess) : null;
    if (cwd === null) {
      if (last !== NONE) useFiles.getState().setGit(null);
      last = NONE;
      return;
    }
    if (cwd === last) return;
    last = cwd;
    const mine = ++seq;
    invoke<RepoInfo | null>('fs_root', { cwd })
      .then((g) => mine === seq && useFiles.getState().setGit(g))
      .catch(() => mine === seq && useFiles.getState().setGit(null));
  };
  run();
  // 푸시/풀 상태는 터미널에서 바뀌므로 가끔 다시 읽는다 (패널이 열려 있을 때만)
  const timer = window.setInterval(() => {
    const s = useFiles.getState();
    if (s.panelOpen && !document.hidden) s.loadStatus();
  }, 10_000);
  const unsubA = useStore.subscribe(run);
  const unsubB = usePaneCwds.subscribe(run);
  return () => {
    window.clearInterval(timer);
    unsubA();
    unsubB();
  };
}
