import type { LayoutNode, SplitPath } from './types';

export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

export const clampRatio = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

/** 왼쪽/위부터 순서대로 pane id */
export function leaves(root: LayoutNode): string[] {
  return root.type === 'pane' ? [root.paneId] : [...leaves(root.a), ...leaves(root.b)];
}

export function findPath(root: LayoutNode, paneId: string): SplitPath | null {
  if (root.type === 'pane') return root.paneId === paneId ? [] : null;
  const a = findPath(root.a, paneId);
  if (a) return ['a', ...a];
  const b = findPath(root.b, paneId);
  return b ? ['b', ...b] : null;
}

/** paneId를 [기존 pane, 새 pane] 분할로 바꾼다. 새 pane은 b 쪽. */
export function split(
  root: LayoutNode,
  paneId: string,
  dir: 'row' | 'col',
  newPaneId: string,
): LayoutNode {
  if (root.type === 'pane') {
    if (root.paneId !== paneId) return root;
    return {
      type: 'split',
      dir,
      ratio: 0.5,
      a: root,
      b: { type: 'pane', paneId: newPaneId },
    };
  }
  const a = split(root.a, paneId, dir, newPaneId);
  if (a !== root.a) return { ...root, a };
  const b = split(root.b, paneId, dir, newPaneId);
  return b === root.b ? root : { ...root, b };
}

export interface CloseResult {
  /** 마지막 pane을 닫으면 null */
  root: LayoutNode | null;
  /** 형제가 부모 자리로 올라온 서브트리 (포커스 후보). 없으면 null */
  promoted: LayoutNode | null;
}

/** pane을 닫고 형제 서브트리를 부모 자리로 올린다. */
export function close(root: LayoutNode, paneId: string): CloseResult {
  if (root.type === 'pane') {
    return root.paneId === paneId ? { root: null, promoted: null } : { root, promoted: null };
  }
  if (root.a.type === 'pane' && root.a.paneId === paneId) return { root: root.b, promoted: root.b };
  if (root.b.type === 'pane' && root.b.paneId === paneId) return { root: root.a, promoted: root.a };
  const a = close(root.a, paneId);
  if (a.root !== root.a)
    return { root: { ...root, a: a.root as LayoutNode }, promoted: a.promoted };
  const b = close(root.b, paneId);
  if (b.root !== root.b)
    return { root: { ...root, b: b.root as LayoutNode }, promoted: b.promoted };
  return { root, promoted: null };
}

/** path가 가리키는 split의 비율을 바꾼다 (0.15–0.85로 제한). */
export function setRatio(root: LayoutNode, path: SplitPath, ratio: number): LayoutNode {
  if (root.type === 'pane') return root;
  if (path.length === 0) return { ...root, ratio: clampRatio(ratio) };
  const [head, ...rest] = path;
  return head === 'a'
    ? { ...root, a: setRatio(root.a, rest, ratio) }
    : { ...root, b: setRatio(root.b, rest, ratio) };
}

/** 0–1 비율 좌표계의 사각형 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Divider {
  /** 이 분할선이 속한 split의 경로 */
  path: SplitPath;
  dir: 'row' | 'col';
  /** split 전체 영역 (드래그 비율 계산용) */
  area: Rect;
  ratio: number;
}

export interface Layout {
  panes: Record<string, Rect>;
  dividers: Divider[];
}

/**
 * 트리를 사각형으로 펼친다. pane을 트리 모양대로 중첩 렌더링하면 분할할 때 React가
 * 터미널을 다시 마운트(= PTY 종료)하므로, pane은 평탄하게 그리고 위치만 계산한다.
 */
export function computeLayout(root: LayoutNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): Layout {
  const out: Layout = { panes: {}, dividers: [] };
  const walk = (node: LayoutNode, rect: Rect, path: SplitPath) => {
    if (node.type === 'pane') {
      out.panes[node.paneId] = rect;
      return;
    }
    out.dividers.push({ path, dir: node.dir, area: rect, ratio: node.ratio });
    if (node.dir === 'row') {
      const aw = rect.w * node.ratio;
      walk(node.a, { ...rect, w: aw }, [...path, 'a']);
      walk(node.b, { ...rect, x: rect.x + aw, w: rect.w - aw }, [...path, 'b']);
    } else {
      const ah = rect.h * node.ratio;
      walk(node.a, { ...rect, h: ah }, [...path, 'a']);
      walk(node.b, { ...rect, y: rect.y + ah, h: rect.h - ah }, [...path, 'b']);
    }
  };
  walk(root, area, []);
  return out;
}
