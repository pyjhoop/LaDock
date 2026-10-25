import { useEffect, useMemo, useState } from 'react';
import { windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { useKeys } from '../keys/keys';
import { Glyphs } from './TitleTabs';
import { addProject } from './ui';

type Item = { sessionId: string; windowId: string | null };

/** 세션과 탭을 한 목록으로 (tmux choose-tree) */
export function TreeOverlay() {
  const state = useStore();
  const close = useKeys((s) => s.closeOverlay);

  const items = useMemo<Item[]>(
    () =>
      state.sessions.flatMap((s) => [
        { sessionId: s.id, windowId: null },
        ...s.windows.map((w) => ({ sessionId: s.id, windowId: w.id })),
      ]),
    [state.sessions],
  );
  const current = useMemo(() => {
    const sess = state.sessions.find((s) => s.id === state.activeSessionId);
    return items.findIndex(
      (it) => it.sessionId === sess?.id && it.windowId === sess?.activeWindowId,
    );
  }, [items, state.sessions, state.activeSessionId]);
  const [sel, setSel] = useState(Math.max(0, current));

  const pick = (it: Item) => {
    const { selectSession, selectWindow } = useStore.getState();
    selectSession(it.sessionId);
    if (it.windowId) selectWindow(it.windowId);
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.stopPropagation();
      if (e.key === 'Escape') return close();
      if (e.key === 'ArrowDown' || e.key === 'j') setSel((i) => Math.min(items.length - 1, i + 1));
      else if (e.key === 'ArrowUp' || e.key === 'k') setSel((i) => Math.max(0, i - 1));
      else if (e.key === 'Enter') pick(items[sel]);
      else if (e.code === 'KeyC') {
        close();
        if (e.shiftKey) void addProject();
        else useStore.getState().newWindow();
      } else return;
      e.preventDefault();
    };
    (document.activeElement as HTMLElement | null)?.blur();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sel, close]);

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="overlay-box tree-box" onMouseDown={(e) => e.stopPropagation()}>
        <h2>프로젝트 · 탭</h2>
        <div className="ch-list">
          {items.map((it, i) => {
            const sess = state.sessions.find((s) => s.id === it.sessionId)!;
            const cls = `${i === sel ? ' sel' : ''}${i === current || (it.windowId === null && it.sessionId === state.activeSessionId) ? ' cur' : ''}`;
            if (!it.windowId) {
              const ids = sess.windows.flatMap((w) => leaves(w.root));
              return (
                <button
                  key={`s${it.sessionId}`}
                  className={`ch-row s${cls}`}
                  onClick={() => pick(it)}
                >
                  <span className="sdot" style={{ ['--sc' as string]: sess.color }} />
                  <span className="name">{sess.name}</span>
                  <span className="meta">
                    <Glyphs panes={ids.map((id) => state.panes[id])} />
                    {sess.windows.length}탭
                  </span>
                </button>
              );
            }
            const wi = sess.windows.findIndex((w) => w.id === it.windowId);
            const w = sess.windows[wi];
            return (
              <button key={w.id} className={`ch-row w${cls}`} onClick={() => pick(it)}>
                <span className="name">
                  {wi + 1}: {windowLabel(state, w)}
                </span>
                <span className="meta">
                  <Glyphs panes={leaves(w.root).map((id) => state.panes[id])} />
                  {leaves(w.root).length}p
                </span>
              </button>
            );
          })}
        </div>
        <div className="ch-foot">
          <kbd>↑↓</kbd> 이동 <kbd>Enter</kbd> 전환 <kbd>C</kbd> 새 프로젝트 <kbd>c</kbd> 새 탭{' '}
          <kbd>Esc</kbd> 닫기
        </div>
      </div>
    </div>
  );
}
