import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, prefixWarning, splitArgs } from './settings';

describe('parseSettings', () => {
  it('파일이 없거나 깨지면 기본값', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{깨짐')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
  });

  it('없는 키는 기본값, 알 수 없는 키는 무시', () => {
    const s = parseSettings('{"fontSize":15,"앞으로생길키":true}');
    expect(s).toEqual({ ...DEFAULT_SETTINGS, fontSize: 15 });
  });

  it('잘못된 값은 항목별로 기본값으로 되돌리고 범위를 맞춘다', () => {
    const s = parseSettings(
      JSON.stringify({ fontSize: 999, theme: 'neon', copyOnSelect: 'yes', defaultShell: '' }),
    );
    expect(s.fontSize).toBe(32);
    expect(s.theme).toBe('dark');
    expect(s.copyOnSelect).toBe(false);
    expect(s.defaultShell).toBe('pwsh');
  });

  it('저장한 값은 그대로 돌아온다', () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      defaultShell: 'wsl:Ubuntu',
      theme: 'light' as const,
      prefix: { code: 'KeyA', ctrl: true, alt: false, shift: false },
      providerArgs: { claude: '--model opus', codex: '', antigravity: '' },
    };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('수식키 없는 prefix는 받지 않는다', () => {
    const s = parseSettings('{"prefix":{"code":"KeyA","ctrl":false,"alt":false,"shift":false}}');
    expect(s.prefix).toEqual(DEFAULT_SETTINGS.prefix);
  });
});

describe('splitArgs', () => {
  it('공백으로 나누고 따옴표로 묶는다', () => {
    expect(splitArgs('--model opus  -c')).toEqual(['--model', 'opus', '-c']);
    expect(splitArgs('--append "a b" x')).toEqual(['--append', 'a b', 'x']);
    expect(splitArgs('  ')).toEqual([]);
  });
});

describe('prefixWarning', () => {
  it('기본 Ctrl+B는 경고 없음, 셸 단축키는 경고', () => {
    expect(prefixWarning(DEFAULT_SETTINGS.prefix)).toBeNull();
    expect(prefixWarning({ code: 'KeyC', ctrl: true, alt: false, shift: false })).toMatch(/중단/);
    expect(prefixWarning({ code: 'KeyB', ctrl: false, alt: false, shift: false })).toMatch(
      /수식키/,
    );
  });
});
