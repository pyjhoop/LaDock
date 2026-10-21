import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../terminal/registry', () => ({ getPaneCwd: () => undefined, killPanePty: vi.fn() }));

import type { Terminal } from '@xterm/xterm';
import { createInitialState } from '../../store/ops';
import { buildIndex, readScreenText } from './share';

const fakeTerm = (rows: { t: string; wrapped?: boolean }[]) =>
  ({
    buffer: {
      active: {
        length: rows.length,
        getLine: (y: number) =>
          rows[y] && {
            isWrapped: !!rows[y].wrapped,
            translateToString: () => rows[y].t,
          },
      },
    },
  }) as unknown as Terminal;

describe('readScreenText', () => {
  it('줄바꿈으로 이어진 줄을 합치고 끝의 빈 줄을 뗀다', () => {
    const t = fakeTerm([{ t: 'a' }, { t: 'b' }, { t: 'c', wrapped: true }, { t: '' }, { t: '' }]);
    expect(readScreenText(t)).toBe('a\nbc\n');
  });

  it('최근 maxLines줄만 남기되 이어진 줄이 잘리지 않게 위로 거슬러 간다', () => {
    const t = fakeTerm([{ t: 'old' }, { t: 'x' }, { t: 'y', wrapped: true }, { t: 'z' }]);
    expect(readScreenText(t, 2)).toBe('xy\nz\n');
  });

  it('내용이 없으면 빈 문자열', () => {
    expect(readScreenText(fakeTerm([{ t: '' }]))).toBe('');
  });
});

describe('buildIndex', () => {
  it('순번 순으로 pane 목록을 만든다', () => {
    const s = createInitialState();
    const [p] = Object.values(s.panes);
    const idx = buildIndex(s, () => 'C:/work');
    expect(idx).toEqual([
      {
        no: 1,
        session: 'main',
        tab: p.profileId,
        kind: 'shell',
        provider: undefined,
        program: p.profileId,
        cwd: 'C:/work',
        focused: true,
      },
    ]);
  });
});
