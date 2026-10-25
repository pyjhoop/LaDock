import { beforeEach, describe, expect, it, vi } from 'vitest';

const killed: string[] = [];
vi.mock('../features/terminal/registry', () => ({
  killPanePty: (id: string) => killed.push(id),
}));

import * as ops from './ops';
import * as tree from './tree';
import { useStore } from './store';
import type { AppState } from './types';

const sess = (s: AppState) => ops.activeSession(s)!;
const win = (s: AppState) => ops.activeWindow(sess(s));

describe('tree', () => {
  const p = (paneId: string) => ({ type: 'pane' as const, paneId });

  it('computeLayout: 비율대로 사각형을 나누고 분할선을 만든다', () => {
    let root = tree.split(p('a'), 'a', 'row', 'b');
    root = tree.split(root, 'b', 'col', 'c');
    root = tree.setRatio(root, [], 0.25);
    const l = tree.computeLayout(root);
    expect(l.panes.a).toEqual({ x: 0, y: 0, w: 0.25, h: 1 });
    expect(l.panes.b).toEqual({ x: 0.25, y: 0, w: 0.75, h: 0.5 });
    expect(l.panes.c).toEqual({ x: 0.25, y: 0.5, w: 0.75, h: 0.5 });
    expect(l.dividers.map((d) => d.path)).toEqual([[], ['b']]);
  });

  it('분할 → 닫기 시 형제가 부모 자리로 승격된다', () => {
    let root = tree.split(p('a'), 'a', 'row', 'b');
    root = tree.split(root, 'b', 'col', 'c');
    expect(tree.leaves(root)).toEqual(['a', 'b', 'c']);
    expect(tree.findPath(root, 'c')).toEqual(['b', 'b']);

    const r = tree.close(root, 'b');
    expect(tree.leaves(r.root!)).toEqual(['a', 'c']);
    expect(r.promoted).toEqual(p('c'));
    expect(tree.close(p('a'), 'a').root).toBeNull();
  });

  it('비율은 0.15–0.85로 제한된다', () => {
    const root = tree.split(p('a'), 'a', 'row', 'b');
    expect((tree.setRatio(root, [], 0.01) as { ratio: number }).ratio).toBe(0.15);
    expect((tree.setRatio(root, [], 0.99) as { ratio: number }).ratio).toBe(0.85);
    expect((tree.setRatio(root, [], 0.4) as { ratio: number }).ratio).toBe(0.4);
  });
});

describe('ops', () => {
  it('새 pane · 탭 · 세션은 포커스된 pane의 cwd와 프로필을 물려받는다', () => {
    let s = ops.createInitialState();
    const first = ops.focusedPane(s)!;
    s = { ...s, panes: { [first.id]: { ...first, profileId: 'cmd', cwd: 'C:\\work' } } };

    s = ops.splitFocused(s, 'row');
    expect(ops.focusedPane(s)).toMatchObject({ profileId: 'cmd', cwd: 'C:\\work', kind: 'shell' });
    s = ops.newWindow(s);
    expect(ops.focusedPane(s)).toMatchObject({ profileId: 'cmd', cwd: 'C:\\work' });
    s = ops.newSession(s);
    expect(ops.focusedPane(s)).toMatchObject({ profileId: 'cmd', cwd: 'C:\\work' });
  });

  it('닫은 뒤 포커스는 올라온 형제 서브트리의 첫 pane', () => {
    let s = ops.createInitialState();
    const a = win(s).focusPaneId;
    s = ops.splitFocused(s, 'row'); // a | b
    const b = win(s).focusPaneId;
    s = ops.splitFocused(s, 'col'); // a | (b / c)
    s = ops.focusPane(s, a);
    s = ops.closePane(s, a);
    expect(tree.leaves(win(s).root)).toHaveLength(2);
    expect(win(s).focusPaneId).toBe(b);
    expect(s.panes[a]).toBeUndefined();
  });

  it('닫기 연쇄: pane → 탭 → 세션 → 기본 세션', () => {
    let s = ops.createInitialState();
    s = ops.newWindow(s);
    s = ops.newSession(s);
    expect(s.sessions).toHaveLength(2);

    // 두 번째 세션의 유일한 pane → 세션이 닫힘
    s = ops.closePane(s, win(s).focusPaneId);
    expect(s.sessions).toHaveLength(1);
    expect(sess(s).windows).toHaveLength(2);

    // 탭 하나씩 닫다가 마지막 pane → 기본 세션
    s = ops.closePane(s, win(s).focusPaneId);
    expect(sess(s).windows).toHaveLength(1);
    s = ops.closePane(s, win(s).focusPaneId);
    expect(s.sessions).toHaveLength(0);
    expect(s.activeSessionId).toBe('');
    expect(Object.keys(s.panes)).toHaveLength(0);
    expect(ops.focusedPane(s)).toBeUndefined();
  });

  it('프로젝트가 없을 때: 탭 · 분할은 무시하고, pane을 열면 빠른 시작 프로젝트가 생긴다', () => {
    const e = ops.createEmptyState();
    expect(ops.newWindow(e)).toBe(e);
    expect(ops.stepSession(e, 1)).toBe(e);
    const s = ops.splitWithPane(e, 'row', {
      id: 'a1',
      kind: 'shell',
      profileId: 'pwsh',
      cwd: '',
    });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0].name).toBe('빠른 시작');
  });

  it('탭 이동: 번호 · 다음/이전(순환)', () => {
    let s = ops.createInitialState();
    s = ops.newWindow(s);
    s = ops.newWindow(s);
    const ids = sess(s).windows.map((w) => w.id);
    s = ops.selectWindowByNumber(s, 1);
    expect(win(s).id).toBe(ids[0]);
    s = ops.stepWindow(s, -1);
    expect(win(s).id).toBe(ids[2]);
    s = ops.stepWindow(s, 1);
    expect(win(s).id).toBe(ids[0]);
    expect(win(ops.selectWindowByNumber(s, 9)).id).toBe(ids[0]);
  });

  it('세션 색은 순서대로 배정되고 이름 변경 · 이동이 된다', () => {
    let s = ops.createInitialState();
    s = ops.newSession(s, 'api');
    s = ops.newSession(s);
    expect(new Set(s.sessions.map((x) => x.color)).size).toBe(3);
    expect(s.sessions[1].name).toBe('api');
    s = ops.renameSession(s, s.sessions[1].id, '  web ');
    expect(s.sessions[1].name).toBe('web');
    s = ops.selectSessionByNumber(s, 1);
    expect(s.activeSessionId).toBe(s.sessions[0].id);
    s = ops.stepSession(s, -1);
    expect(s.activeSessionId).toBe(s.sessions[2].id);
  });

  it('프로젝트 폴더를 주면 세션에 저장되고 첫 pane이 그 폴더에서 시작한다', () => {
    let s = ops.createInitialState();
    s = ops.newSession(s, 'api', 'C:/work/api');
    const cur = sess(s);
    expect(cur.cwd).toBe('C:/work/api');
    expect(ops.focusedPane(s)?.cwd).toBe('C:/work/api');
    expect(ops.projectCwd(s, cur)).toBe('C:/work/api');
    // 새 탭은 프로젝트 폴더에서 시작한다
    s = ops.newWindow(s);
    expect(ops.focusedPane(s)?.cwd).toBe('C:/work/api');
  });

  it('auto-rename: name이 null이면 포커스된 pane의 프로그램 이름', () => {
    let s = ops.createInitialState();
    const w = win(s);
    expect(ops.windowLabel(s, w)).toBe('pwsh');

    const pane = ops.focusedPane(s)!;
    s = { ...s, panes: { [pane.id]: { ...pane, command: 'C:\\bin\\claude.exe' } } };
    expect(ops.windowLabel(s, win(s))).toBe('claude');

    s = ops.renameWindow(s, w.id, 'build');
    expect(ops.windowLabel(s, win(s))).toBe('build');
    s = ops.renameWindow(s, w.id, '  ');
    expect(ops.windowLabel(s, win(s))).toBe('claude');
  });
});

describe('store → PTY 종료', () => {
  beforeEach(() => {
    killed.length = 0;
    useStore.setState(ops.createInitialState());
  });

  it('store에서 사라진 pane만 kill된다', () => {
    const st = useStore.getState();
    st.splitFocused('row');
    const ids = Object.keys(useStore.getState().panes);
    expect(killed).toEqual([]);

    useStore.getState().closePane(ids[0]);
    expect(killed).toEqual([ids[0]]);

    killed.length = 0;
    useStore.getState().newWindow();
    const all = Object.keys(useStore.getState().panes);
    const sid = useStore.getState().sessions[0].id;
    useStore.getState().closeSession(sid);
    expect(killed.sort()).toEqual(all.sort());
    expect(Object.keys(useStore.getState().panes)).toHaveLength(0);
  });
});

describe('openPane (AI 실행)', () => {
  const agent = (id: string) => ({
    id,
    kind: 'agent' as const,
    provider: 'claude' as const,
    profileId: 'pwsh',
    command: 'claude',
    cwd: 'C:\\work',
  });

  it('분할로 열면 새 pane이 포커스를 받는다', () => {
    const s = ops.splitWithPane(ops.createInitialState(), 'row', agent('a1'));
    expect(win(s).focusPaneId).toBe('a1');
    expect(s.panes.a1.kind).toBe('agent');
    expect(tree.leaves(win(s).root)).toHaveLength(2);
  });

  it('새 탭으로 열면 현재 세션에 탭이 늘어난다', () => {
    const s = ops.newWindowWithPane(ops.createInitialState(), agent('a2'));
    expect(sess(s).windows).toHaveLength(2);
    expect(win(s).focusPaneId).toBe('a2');
  });
});

describe('pane 순번', () => {
  it('새 pane마다 가장 작은 빈 번호를 받고, 닫으면 그 번호를 다시 쓴다', () => {
    useStore.setState(ops.createInitialState());
    const nos = () =>
      Object.values(useStore.getState().panes)
        .map((p) => p.no)
        .sort();
    expect(nos()).toEqual([1]);
    useStore.getState().splitFocused('row');
    useStore.getState().splitFocused('col');
    expect(nos()).toEqual([1, 2, 3]);
    const second = Object.values(useStore.getState().panes).find((p) => p.no === 2)!;
    useStore.getState().closePane(second.id);
    expect(nos()).toEqual([1, 3]);
    useStore.getState().splitFocused('row');
    expect(nos()).toEqual([1, 2, 3]);
  });

  it('저장돼 있던 순번은 유지하고 없는 pane에만 붙인다', () => {
    const s = ops.createInitialState();
    const [only] = Object.values(s.panes);
    const restored = { ...s, panes: { [only.id]: { ...only, no: 7 } } };
    expect(ops.assignPaneNumbers(restored)).toBe(restored);
  });
});
