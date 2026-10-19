import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PROVIDER_META } from '../ai/providers';
import { windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { useActivity } from './activity';
import { useDetected } from './detect';

/** pane이 속한 세션 · 탭을 찾는다 */
function locate(paneId: string) {
  const s = useStore.getState();
  for (const sess of s.sessions)
    for (const w of sess.windows) if (leaves(w.root).includes(paneId)) return { s, sess, w };
  return null;
}

/** 지금 사용자가 보고 있는 탭에 있는 pane인가 (앱이 숨겨졌거나 가려졌으면 아님) */
function isWatching(paneId: string) {
  if (document.hidden || !document.hasFocus()) return false;
  const at = locate(paneId);
  return !!at && at.sess.id === at.s.activeSessionId && at.w.id === at.sess.activeWindowId;
}

function onDone(paneId: string) {
  const at = locate(paneId);
  if (!at || isWatching(paneId)) return;
  const pane = at.s.panes[paneId];
  const provider = pane.kind === 'agent' ? pane.provider : useDetected.getState().byPane[paneId];
  if (!provider) return;
  void invoke('notify_agent_done', {
    paneId,
    title: `${PROVIDER_META[provider].name} 답변 완료`,
    body: `${at.sess.name} › ${windowLabel(at.s, at.w)}`,
  }).catch(() => {});
}

/** 안 보는 탭의 에이전트가 '완료'가 되면 윈도우 알림을 띄우고, 알림을 누르면 그 pane으로 이동한다. */
export function startNotify(): () => void {
  const unsub = useActivity.subscribe((cur, prev) => {
    for (const [id, st] of Object.entries(cur.byPane))
      if (st === 'done' && prev.byPane[id] !== 'done') onDone(id);
  });
  const unlisten = listen<string>('notify://activate', (e) => {
    const at = locate(e.payload);
    if (!at) return;
    at.s.selectSession(at.sess.id);
    at.s.selectWindow(at.w.id);
    at.s.focusPane(e.payload);
  });
  return () => {
    unsub();
    void unlisten.then((un) => un());
  };
}
