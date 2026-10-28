import { create } from 'zustand';

/** 사이드바에서 프로젝트를 묶는 폴더. 순수 UI 분류라 세션 저장 파일과는 따로 localStorage에 둔다. */
export interface Folder {
  id: string;
  name: string;
  /** 상위 폴더 id. 최상위면 null */
  parent: string | null;
}

/** 폴더 중첩 한도 (최상위 폴더 = 1단계) */
export const MAX_FOLDER_DEPTH = 3;

/** 폴더의 단계 (최상위 = 1). 없는 폴더나 순환이면 0 */
export function folderDepth(folders: Folder[], id: string | null): number {
  let depth = 0;
  let cur = id;
  while (cur !== null) {
    const f = folders.find((x) => x.id === cur);
    if (!f || ++depth > MAX_FOLDER_DEPTH + 1) return 0;
    cur = f.parent;
  }
  return depth;
}

/** parent 아래에 폴더를 더 만들 수 있는가 (parent null = 최상위) */
export const canAddFolder = (folders: Folder[], parent: string | null) =>
  parent === null ||
  (folderDepth(folders, parent) > 0 && folderDepth(folders, parent) < MAX_FOLDER_DEPTH);

/** 폴더 경로 이름 ("앞/뒤") */
export function folderPath(folders: Folder[], id: string): string {
  const names: string[] = [];
  for (let cur: string | null = id, n = 0; cur !== null && n < 8; n++) {
    const f = folders.find((x) => x.id === cur);
    if (!f) break;
    names.unshift(f.name);
    cur = f.parent;
  }
  return names.join(' / ');
}

/** id와 그 아래 모든 하위 폴더 id */
function subtree(folders: Folder[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of folders)
      if (f.parent !== null && out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
  }
  return out;
}

/** 폴더 하나의 높이(자기 포함 가장 깊은 하위까지 몇 단계) */
function height(folders: Folder[], id: string): number {
  let h = 1;
  for (const f of folders) if (f.parent === id) h = Math.max(h, 1 + height(folders, f.id));
  return h;
}

/** 폴더 id를 newParent 아래로 옮길 수 있는가 (자기 하위 금지 · 3단계 한도) */
export function canMoveFolder(folders: Folder[], id: string, newParent: string | null): boolean {
  if (newParent === null) return true;
  if (subtree(folders, id).has(newParent)) return false;
  return folderDepth(folders, newParent) + height(folders, id) <= MAX_FOLDER_DEPTH;
}

/** 폴더를 지운다. 안에 있던 폴더 · 프로젝트는 상위 폴더(없으면 최상위)로 올린다. */
export function removeFolderFrom(
  folders: Folder[],
  assign: Record<string, string>,
  id: string,
): { folders: Folder[]; assign: Record<string, string> } {
  const target = folders.find((f) => f.id === id);
  if (!target) return { folders, assign };
  const next: Record<string, string> = {};
  for (const [sid, fid] of Object.entries(assign)) {
    if (fid !== id) next[sid] = fid;
    else if (target.parent !== null) next[sid] = target.parent;
  }
  return {
    folders: folders
      .filter((f) => f.id !== id)
      .map((f) => (f.parent === id ? { ...f, parent: target.parent } : f)),
    assign: next,
  };
}

const KEY = 'ladock.projectFolders';
type Saved = {
  folders: Folder[];
  assign: Record<string, string>;
  collapsed: Record<string, boolean>;
};

/** 저장값이 깨졌거나 한도를 넘으면 걸러낸다 */
function load(): Saved {
  const empty: Saved = { folders: [], assign: {}, collapsed: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!raw || !Array.isArray(raw.folders)) return empty;
    const folders = raw.folders.filter(
      (f): f is Folder =>
        !!f &&
        typeof f.id === 'string' &&
        typeof f.name === 'string' &&
        (f.parent === null || typeof f.parent === 'string'),
    );
    const ok = folders.filter(
      (f) => folderDepth(folders, f.id) > 0 && folderDepth(folders, f.id) <= MAX_FOLDER_DEPTH,
    );
    const ids = new Set(ok.map((f) => f.id));
    const valid = ok.filter((f) => f.parent === null || ids.has(f.parent));
    const assign: Record<string, string> = {};
    for (const [sid, fid] of Object.entries(raw.assign ?? {}))
      if (typeof fid === 'string' && valid.some((f) => f.id === fid)) assign[sid] = fid;
    return { folders: valid, assign, collapsed: raw.collapsed ?? {} };
  } catch {
    return empty;
  }
}

interface GroupsState extends Saved {
  addFolder: (parent: string | null, name?: string) => string | null;
  renameFolder: (id: string, name: string) => void;
  removeFolder: (id: string) => void;
  moveFolder: (id: string, parent: string | null) => void;
  moveProject: (sessionId: string, folderId: string | null) => void;
  toggleFolder: (id: string) => void;
}

export const useGroups = create<GroupsState>()((set, get) => {
  const commit = (patch: Partial<Saved>) => {
    set(patch);
    const { folders, assign, collapsed } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ folders, assign, collapsed }));
    } catch {
      // 저장 못 해도 이번 실행에서는 동작한다
    }
  };
  return {
    ...load(),
    addFolder: (parent, name = '새 폴더') => {
      const { folders, collapsed } = get();
      if (!canAddFolder(folders, parent)) return null;
      const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      commit({
        folders: [...folders, { id, name, parent }],
        collapsed: parent ? { ...collapsed, [parent]: false } : collapsed,
      });
      return id;
    },
    renameFolder: (id, name) => {
      const text = name.trim();
      if (text)
        commit({ folders: get().folders.map((f) => (f.id === id ? { ...f, name: text } : f)) });
    },
    removeFolder: (id) => commit(removeFolderFrom(get().folders, get().assign, id)),
    moveFolder: (id, parent) => {
      const { folders } = get();
      if (!canMoveFolder(folders, id, parent)) return;
      commit({ folders: folders.map((f) => (f.id === id ? { ...f, parent } : f)) });
    },
    moveProject: (sessionId, folderId) => {
      const assign = { ...get().assign };
      if (folderId === null) delete assign[sessionId];
      else assign[sessionId] = folderId;
      commit({ assign });
    },
    toggleFolder: (id) => {
      const { collapsed } = get();
      commit({ collapsed: { ...collapsed, [id]: !collapsed[id] } });
    },
  };
});
