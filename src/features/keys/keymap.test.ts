import { describe, expect, it } from 'vitest';
import * as tree from '../../store/tree';
import { DEFAULT_PREFIX, prefixControlChar, resolveKey, type KeyLike } from './keymap';

const k = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: code,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

describe('resolveKey', () => {
  it('대소문자: c = 새 탭, Shift+c = 새 세션', () => {
    expect(resolveKey(k('KeyC'))).toEqual({ id: 'newWindow' });
    expect(resolveKey(k('KeyC', { shiftKey: true }))).toEqual({ id: 'newSession' });
    expect(resolveKey(k('KeyX'))).toEqual({ id: 'closePane' });
    expect(resolveKey(k('KeyX', { shiftKey: true }))).toEqual({ id: 'closeSession' });
  });

  it('한글 입력 상태(e.key가 한글)에서도 e.code로 동작한다', () => {
    expect(resolveKey(k('KeyC', { key: 'ㅊ' }))).toEqual({ id: 'newWindow' });
    expect(resolveKey(k('Digit5', { key: '%', shiftKey: true }))).toEqual({
      id: 'split',
      dir: 'row',
    });
    expect(resolveKey(k('Digit5', { key: '5', shiftKey: true }))).toEqual({
      id: 'split',
      dir: 'row',
    });
  });

  it('기호 키', () => {
    const shifted = (code: string, key: string) => resolveKey(k(code, { key, shiftKey: true }));
    expect(shifted('Quote', '"')).toEqual({ id: 'split', dir: 'col' });
    expect(shifted('Digit4', '$')).toEqual({ id: 'renameSession' });
    expect(shifted('Digit9', '(')).toEqual({ id: 'stepSession', delta: -1 });
    expect(shifted('Digit0', ')')).toEqual({ id: 'stepSession', delta: 1 });
    expect(shifted('Digit7', '&')).toEqual({ id: 'closeWindow' });
    expect(shifted('Slash', '?')).toEqual({ id: 'help' });
    expect(resolveKey(k('Comma'))).toEqual({ id: 'renameWindow' });
  });

  it('숫자 키: 1–9, 0은 10번 탭', () => {
    expect(resolveKey(k('Digit3'))).toEqual({ id: 'selectWindow', n: 3 });
    expect(resolveKey(k('Digit0'))).toEqual({ id: 'selectWindow', n: 10 });
  });

  it('화살표: 포커스 이동, Ctrl+화살표: 크기 조절', () => {
    expect(resolveKey(k('ArrowLeft'))).toEqual({ id: 'moveFocus', dir: 'left' });
    expect(resolveKey(k('ArrowDown', { ctrlKey: true }))).toEqual({ id: 'resize', dir: 'down' });
  });

  it('prefix를 한 번 더 누르면 sendPrefix, 모르는 키는 null', () => {
    expect(resolveKey(k('KeyB', { ctrlKey: true }))).toEqual({ id: 'sendPrefix' });
    expect(resolveKey(k('KeyQ'))).toBeNull();
    expect(resolveKey(k('KeyC', { metaKey: true }))).toBeNull();
  });

  it('prefixControlChar: Ctrl+B = \\x02', () => {
    expect(prefixControlChar(DEFAULT_PREFIX)).toBe('\x02');
    expect(prefixControlChar({ ...DEFAULT_PREFIX, ctrl: false })).toBeNull();
  });
});

describe('포커스 이동 · 크기 조절', () => {
  const p = (paneId: string) => ({ type: 'pane' as const, paneId });

  // ┌───┬─────┐
  // │ a │  b  │
  // │   ├──┬──┤
  // │   │ c│ d│
  // └───┴──┴──┘
  const build = () => {
    let root = tree.split(p('a'), 'a', 'row', 'b');
    root = tree.split(root, 'b', 'col', 'c');
    root = tree.split(root, 'c', 'row', 'd');
    return root;
  };

  it('화면상 가장 가까운 pane으로 이동한다 (트리 순서 아님)', () => {
    const l = tree.computeLayout(build());
    expect(tree.neighborPane(l, 'a', 'right')).toBe('c'); // 중심 거리: c가 b보다 가깝다
    expect(tree.neighborPane(l, 'c', 'up')).toBe('b');
    expect(tree.neighborPane(l, 'd', 'up')).toBe('b');
    expect(tree.neighborPane(l, 'd', 'left')).toBe('c');
    expect(tree.neighborPane(l, 'c', 'left')).toBe('a');
    expect(tree.neighborPane(l, 'b', 'down')).toBe('c');
    expect(tree.neighborPane(l, 'a', 'left')).toBeNull();
    expect(tree.neighborPane(l, 'a', 'up')).toBeNull();
  });

  it('같은 방향의 가장 가까운 조상 split 비율을 ±0.05', () => {
    const root = build();
    const ratioOf = (r: ReturnType<typeof build>, path: tree.Direction[] | ('a' | 'b')[]) => {
      let n: tree.Divider | unknown = r;
      for (const s of path) n = (n as { a: unknown; b: unknown })[s as 'a' | 'b'];
      return (n as { ratio: number }).ratio;
    };
    // c의 가장 가까운 row 조상은 c-d split ([b,b])
    const right = tree.resizeFocused(root, 'c', 'right');
    expect(ratioOf(right, ['b', 'b'])).toBeCloseTo(0.55);
    expect(ratioOf(right, [])).toBe(0.5);
    // c의 col 조상은 b-(c,d) split ([b])
    const up = tree.resizeFocused(root, 'c', 'up');
    expect(ratioOf(up, ['b'])).toBeCloseTo(0.45);
    // a는 row 조상이 루트뿐
    expect(ratioOf(tree.resizeFocused(root, 'a', 'left'), [])).toBeCloseTo(0.45);
    // 해당 축 조상이 없으면 그대로
    expect(tree.resizeFocused(root, 'a', 'down')).toBe(root);
  });
});
