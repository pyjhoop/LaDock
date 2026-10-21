import { describe, expect, it } from 'vitest';
import { nextTheme, parseTheme, THEMES } from './theme';

describe('theme', () => {
  it('알 수 없는 값은 다크로 돌린다', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('neon')).toBe('dark');
    expect(parseTheme(null)).toBe('dark');
  });

  it('새 테마 이름을 인식한다', () => {
    for (const t of THEMES) expect(parseTheme(t.id)).toBe(t.id);
  });

  it('목록 끝까지 가면 처음으로 돌아온다', () => {
    let m = THEMES[0].id;
    for (let i = 0; i < THEMES.length; i++) m = nextTheme(m);
    expect(m).toBe(THEMES[0].id);
  });
});
