import { describe, expect, it } from 'vitest';
import { formatReset, mergeGroups, levelOf, roundPct, worstLevel } from './limits';

describe('levelOf', () => {
  it('경계값: 70 주의, 90 임박', () => {
    expect(levelOf(69.9)).toBe('ok');
    expect(levelOf(70)).toBe('warn');
    expect(levelOf(89.9)).toBe('warn');
    expect(levelOf(90)).toBe('danger');
  });
});

describe('worstLevel', () => {
  it('가장 많이 쓴 창 기준, 창이 없으면 null', () => {
    expect(worstLevel([])).toBeNull();
    expect(
      worstLevel([
        { key: '5h', usedPct: 24 },
        { key: '7d', usedPct: 91 },
      ]),
    ).toBe('danger');
  });
});

describe('formatReset', () => {
  it('남은 시간을 단위별로', () => {
    expect(formatReset(undefined, 0)).toBe('리셋 시각 미확인');
    expect(formatReset(100, 200)).toBe('리셋 시각 지남 · 갱신 대기');
    expect(formatReset(30 * 60, 0)).toBe('30분 후 리셋');
    expect(formatReset(2 * 3600 + 5 * 60, 0)).toBe('2시간 5분 후 리셋');
    expect(formatReset(26 * 3600, 0)).toBe('1일 2시간 후 리셋');
  });
});

describe('mergeGroups', () => {
  it('같은 종류 창은 가장 많이 쓴 값으로 합친다', () => {
    const merged = mergeGroups([
      { key: '5h', usedPct: 10, group: 'A' },
      { key: '7d', usedPct: 5, group: 'A' },
      { key: '5h', usedPct: 40, group: 'B' },
      { key: '7d', usedPct: 1, group: 'B' },
    ]);
    expect(merged.map((w) => [w.key, w.usedPct])).toEqual([
      ['5h', 40],
      ['7d', 5],
    ]);
  });
});

describe('roundPct', () => {
  it('0–100으로 자른다', () => {
    expect(roundPct(24.4)).toBe(24);
    expect(roundPct(130)).toBe(100);
    expect(roundPct(-1)).toBe(0);
  });
});
