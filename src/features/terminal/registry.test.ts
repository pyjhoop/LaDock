import { describe, expect, it, vi } from 'vitest';

vi.mock('./pty', () => ({ ptyKill: vi.fn(), ptyWrite: vi.fn() }));

import { parseOsc7 } from './registry';

describe('parseOsc7', () => {
  it('file URL을 Windows 경로로 바꾼다', () => {
    expect(parseOsc7('file://localhost/C:/Users/YeonJun/my%20dir')).toBe(
      'C:\\Users\\YeonJun\\my dir',
    );
  });

  it('드라이브 경로가 아니면 null', () => {
    expect(parseOsc7('file://host/home/user')).toBeNull();
    expect(parseOsc7('garbage')).toBeNull();
  });
});
