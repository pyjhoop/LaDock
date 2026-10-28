import { describe, expect, it } from 'vitest';
import { canAddFolder, canMoveFolder, folderDepth, removeFolderFrom, type Folder } from './groups';

const f = (id: string, parent: string | null = null): Folder => ({ id, name: id, parent });

describe('프로젝트 묶음 폴더', () => {
  const chain = [f('a'), f('b', 'a'), f('c', 'b')];

  it('3단계까지만 만들 수 있다', () => {
    expect(folderDepth(chain, 'c')).toBe(3);
    expect(canAddFolder(chain, null)).toBe(true);
    expect(canAddFolder(chain, 'b')).toBe(true);
    expect(canAddFolder(chain, 'c')).toBe(false);
  });

  it('옮길 때도 한도와 순환을 막는다', () => {
    expect(canMoveFolder(chain, 'a', 'c')).toBe(false); // 자기 하위
    expect(canMoveFolder([...chain, f('x')], 'x', 'c')).toBe(false); // 4단계
    expect(canMoveFolder([...chain, f('x')], 'x', 'b')).toBe(true);
    expect(canMoveFolder(chain, 'c', null)).toBe(true);
  });

  it('폴더를 지우면 안의 폴더 · 프로젝트가 상위로 올라간다', () => {
    const r = removeFolderFrom(chain, { s1: 'b', s2: 'c' }, 'b');
    expect(r.folders.find((x) => x.id === 'c')?.parent).toBe('a');
    expect(r.assign).toEqual({ s1: 'a', s2: 'c' });
    const top = removeFolderFrom(chain, { s1: 'a' }, 'a');
    expect(top.assign).toEqual({});
    expect(top.folders.find((x) => x.id === 'b')?.parent).toBeNull();
  });
});
