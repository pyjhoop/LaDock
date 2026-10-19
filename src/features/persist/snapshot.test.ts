import { describe, expect, it } from 'vitest';
import * as ops from '../../store/ops';
import type { AppState, PaneSpec } from '../../store/types';
import {
  applyResume,
  fixMissingCwds,
  isValidState,
  parseStateFile,
  snapshotState,
  STATE_VERSION,
} from './snapshot';

function sample(): AppState {
  let s = ops.createInitialState();
  s = ops.splitFocused(s, 'row');
  s = ops.newWindow(s);
  s = ops.newSession(s, 'work');
  return s;
}

const agent: PaneSpec = {
  id: 'pa',
  kind: 'agent',
  provider: 'claude',
  profileId: 'pwsh',
  command: 'claude',
  args: ['--dangerously-skip-permissions'],
  cwd: 'C:\\x',
};

describe('저장 파일 검증', () => {
  it('여러 세션 · 탭 · 분할 상태가 왕복해도 같다', () => {
    const s = sample();
    const text = JSON.stringify(snapshotState(s, () => undefined));
    const r = parseStateFile(text);
    expect(r.ok && r.state).toEqual(s);
  });

  it('깨진 JSON · 버전 없음 · 미래 버전은 거부한다', () => {
    expect(parseStateFile('{깨짐').ok).toBe(false);
    expect(parseStateFile('{"state":{}}').ok).toBe(false);
    const future = { version: STATE_VERSION + 1, state: sample() };
    expect(parseStateFile(JSON.stringify(future)).ok).toBe(false);
  });

  it('레이아웃이 없는 pane을 가리키거나 고아 pane이 있으면 거부한다', () => {
    const s = sample();
    const missing = structuredClone(s);
    delete missing.panes[Object.keys(missing.panes)[0]];
    expect(isValidState(missing)).toBe(false);
    const orphan = structuredClone(s);
    orphan.panes.zzz = { id: 'zzz', kind: 'shell', profileId: 'pwsh', cwd: '' };
    expect(isValidState(orphan)).toBe(false);
  });

  it('활성 세션 id가 없으면 거부한다', () => {
    expect(isValidState({ ...sample(), activeSessionId: 'nope' })).toBe(false);
  });
});

describe('복원 가공', () => {
  it('저장할 때 살아 있는 cwd를 반영한다', () => {
    const s = sample();
    const id = Object.keys(s.panes)[0];
    const f = snapshotState(s, (p) => (p === id ? 'D:\\live' : undefined));
    expect(f.state.panes[id].cwd).toBe('D:\\live');
  });

  it('셸 pane에서 직접 띄운 AI는 agent pane으로 저장한다', () => {
    const s = sample();
    const id = Object.keys(s.panes)[0];
    const f = snapshotState(
      s,
      () => undefined,
      (p) =>
        p === id ? { kind: 'agent', provider: 'claude', command: 'claude', args: [] } : undefined,
    );
    expect(f.state.panes[id]).toMatchObject({
      kind: 'agent',
      provider: 'claude',
      command: 'claude',
    });
    expect(parseStateFile(JSON.stringify(f)).ok).toBe(true);
  });

  it('이어하기는 claude · agy에 -c를 붙이고, 새로 시작은 뗀다', () => {
    const s: AppState = { ...sample(), panes: { ...sample().panes, pa: agent } };
    const on = applyResume(s, true).panes.pa.args;
    expect(on).toEqual(['--dangerously-skip-permissions', '-c']);
    expect(
      applyResume({ ...s, panes: { pa: { ...agent, args: on } } }, false).panes.pa.args,
    ).toEqual(['--dangerously-skip-permissions']);
    const codex = { ...agent, provider: 'codex' as const };
    expect(applyResume({ ...s, panes: { pa: codex } }, true).panes.pa.args).toEqual(agent.args);
  });

  it('사라진 cwd는 빈 값으로', () => {
    const s: AppState = { ...sample(), panes: { pa: agent } };
    expect(fixMissingCwds(s, () => false).panes.pa.cwd).toBe('');
    expect(fixMissingCwds(s, () => true).panes.pa.cwd).toBe('C:\\x');
  });
});
