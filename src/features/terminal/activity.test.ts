import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stubWindow = () => {
  vi.stubGlobal('window', {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    addEventListener: () => {},
  });
  vi.stubGlobal('document', { hidden: false, hasFocus: () => false });
};

describe('activity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    stubWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const load = () => import('./activity');

  it('Enter를 보내기 전의 출력은 작업이 아니다', async () => {
    const a = await load();
    a.noteOutput('p');
    expect(a.useActivity.getState().byPane.p).toBeUndefined();
  });

  it('Enter 뒤 출력은 작업 중 → 조용해지면 완료', async () => {
    const a = await load();
    a.noteInput('p', '\r');
    vi.advanceTimersByTime(500);
    a.noteOutput('p');
    expect(a.useActivity.getState().byPane.p).toBe('working');
    vi.advanceTimersByTime(2600);
    expect(a.useActivity.getState().byPane.p).toBe('done');
    a.noteOutput('p');
    expect(a.useActivity.getState().byPane.p).toBe('done');
  });

  it('터미널 자동 응답(ESC)은 에코 무시 시간을 갱신하지 않는다', async () => {
    const a = await load();
    a.noteInput('p', '\r');
    vi.advanceTimersByTime(500);
    a.noteInput('p', '\x1b[I');
    a.noteOutput('p');
    expect(a.useActivity.getState().byPane.p).toBe('working');
  });
});
