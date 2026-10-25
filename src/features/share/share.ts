import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';
import { windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import type { AppState } from '../../store/types';
import { useSettings } from '../settings/settings';
import { getPaneCwd } from '../terminal/registry';

/**
 * pane 화면 공유: 다른 에이전트가 pane 순번으로 화면을 읽을 수 있게 파일로 내놓는다 (Rust `panes.rs`).
 * 읽는 쪽은 `tail`만 하면 되도록, 내용이 바뀐 pane만 1초에 한 번 이하로 다시 쓴다.
 */

/** 파일에 남기는 마지막 줄 수 (화면 + 스크롤백) */
export const SHARE_LINES = 2000;
const DUMP_MS = 1000;
const INDEX_MS = 500;

export const shareEnabled = () => useSettings.getState().settings.sharePanes;

/** 화면 + 스크롤백 끝부분을 일반 텍스트로. 줄바꿈으로 이어진 줄은 한 줄로 합치고 끝의 빈 줄은 뗀다. */
export function readScreenText(term: Terminal, maxLines = SHARE_LINES): string {
  const buf = term.buffer.active;
  const out: string[] = [];
  // 줄 이음(isWrapped)이 시작 지점에서 끊기지 않도록 시작 줄에서 위로 거슬러 올라간다
  let start = Math.max(0, buf.length - maxLines);
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  for (let y = start; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && out.length > 0) out[out.length - 1] += text;
    else out.push(text);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.length > 0 ? `${out.join('\n')}\n` : '';
}

export interface Dumper {
  /** 출력이 있었다고 알린다 (쓰기는 모아서 한 번) */
  schedule: () => void;
  dispose: () => void;
}

export function createDumper(term: Terminal, paneKey: string): Dumper {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  let lastNo: number | undefined;
  const run = () => {
    timer = undefined;
    if (!shareEnabled()) return;
    const no = useStore.getState().panes[paneKey]?.no;
    if (no === undefined) return;
    const text = readScreenText(term);
    if (text === last && no === lastNo) return;
    last = text;
    lastNo = no;
    void invoke('pane_dump', { no, text }).catch((e) => console.error('pane_dump 실패', e));
    scheduleIndex();
  };
  return {
    schedule: () => {
      if (timer === undefined) timer = setTimeout(run, DUMP_MS);
    },
    dispose: () => clearTimeout(timer),
  };
}

// ── 목록(index.json) ───────────────────────────────

export interface PaneIndexEntry {
  no: number;
  session: string;
  tab: string;
  kind: 'shell' | 'agent';
  provider?: string;
  program: string;
  cwd: string;
  focused: boolean;
}

export function buildIndex(
  s: AppState,
  cwdOf: (paneId: string) => string | undefined = getPaneCwd,
): PaneIndexEntry[] {
  const entries: PaneIndexEntry[] = [];
  for (const sess of s.sessions) {
    for (const win of sess.windows) {
      const shown = sess.id === s.activeSessionId && win.id === sess.activeWindowId;
      for (const id of leaves(win.root)) {
        const p = s.panes[id];
        // 터미널이 아닌 pane(변경 내용 보기)은 화면 공유 대상이 아니다
        if (!p || p.no === undefined || p.kind === 'diff') continue;
        entries.push({
          no: p.no,
          session: sess.name,
          tab: windowLabel(s, win),
          kind: p.kind,
          provider: p.provider,
          program: p.title ?? p.command ?? p.profileId,
          cwd: cwdOf(id) ?? p.cwd,
          focused: shown && win.focusPaneId === id,
        });
      }
    }
  }
  return entries.sort((a, b) => a.no - b.no);
}

let indexTimer: ReturnType<typeof setTimeout> | undefined;
let lastIndex = '';

function publishIndex() {
  indexTimer = undefined;
  const panes = shareEnabled() ? buildIndex(useStore.getState()) : [];
  const body = { panes, ...(shareEnabled() ? {} : { disabled: true }) };
  const key = JSON.stringify(body);
  if (key === lastIndex) return;
  lastIndex = key;
  const json = JSON.stringify({ updatedAt: Math.floor(Date.now() / 1000), ...body });
  void invoke('panes_index', { json, nos: panes.map((p) => p.no) }).catch((e) =>
    console.error('panes_index 실패', e),
  );
}

export function scheduleIndex() {
  if (indexTimer === undefined) indexTimer = setTimeout(publishIndex, INDEX_MS);
}

/** 앱이 도는 동안 목록을 최신으로 유지한다. 해제 함수를 돌려준다. */
export function startShare(): () => void {
  const unStore = useStore.subscribe(scheduleIndex);
  const unSettings = useSettings.subscribe((cur, prev) => {
    if (cur.settings.sharePanes !== prev.settings.sharePanes) scheduleIndex();
  });
  scheduleIndex();
  return () => {
    unStore();
    unSettings();
    clearTimeout(indexTimer);
    indexTimer = undefined;
  };
}
