import { describe, expect, it } from 'vitest';
import { nextTheme, parseTheme } from './theme';

describe('theme', () => {
  it('알 수 없는 값은 다크로 돌린다', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('neon')).toBe('dark');
    expect(parseTheme(null)).toBe('dark');
  });

  it('dark → light → system → dark 순서로 순환한다', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('system');
    expect(nextTheme('system')).toBe('dark');
  });
});
