import { beforeEach, describe, expect, it, vi } from 'vitest';

const killed: string[] = [];
vi.mock('../features/terminal/registry', () => ({
  killPanePty: (id: string) => killed.push(id),
}));

import * as ops from './ops';
import * as tree from './tree';
import { useStore } from './store';
import type { AppState } from './types';

const win = (s: AppState) => ops.activeWindow(ops.activeSession(s));

describe('tree', () => {
  const p = (paneId: string) => ({ type: 'pane' as const, paneId });

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
    expect(ops.activeSession(s).windows).toHaveLength(2);

    // 탭 하나씩 닫다가 마지막 pane → 기본 세션
    s = ops.closePane(s, win(s).focusPaneId);
    expect(ops.activeSession(s).windows).toHaveLength(1);
    s = ops.closePane(s, win(s).focusPaneId);
    expect(s.sessions).toHaveLength(1);
    expect(ops.activeSession(s).name).toBe('main');
    expect(Object.keys(s.panes)).toHaveLength(1);
    expect(ops.focusedPane(s)?.profileId).toBe('pwsh');
  });

  it('탭 이동: 번호 · 다음/이전(순환)', () => {
    let s = ops.createInitialState();
    s = ops.newWindow(s);
    s = ops.newWindow(s);
    const ids = ops.activeSession(s).windows.map((w) => w.id);
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
    expect(Object.keys(useStore.getState().panes)).toHaveLength(1);
  });
});
