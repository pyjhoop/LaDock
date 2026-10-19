import type { MouseEvent } from 'react';
import { windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { InlineRename } from './InlineRename';
import { Glyphs } from './TitleTabs';
import { createSessionAndRename, providersOf, useSessionsUi } from './ui';

/** 활성 세션만 펼쳐서 탭 목록을 보여주는 세션 트리 */
export function Sidebar() {
  const state = useStore();
  const open = useSessionsUi((s) => s.sidebarOpen);
  const renaming = useSessionsUi((s) => s.renaming);
  if (!open) return null;
  const { selectSession, selectWindow, renameSession, renameWindow } = state;
  const { startRename, stopRename } = useSessionsUi.getState();
  const renameProps = (target: 'session' | 'window', id: string) => ({
    onDoubleClick: () => startRename({ target, id, from: 'side' }),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      startRename({ target, id, from: 'side' });
    },
  });
  const isRenaming = (target: 'session' | 'window', id: string) =>
    renaming?.from === 'side' && renaming.target === target && renaming.id === id;

  return (
    <aside className="sidebar">
      <div className="sec-head">
        <h3>세션 · {state.sessions.length}</h3>
        <button
          className="icon-btn"
          onClick={createSessionAndRename}
          title="새 세션 (Ctrl+B C)"
          aria-label="새 세션"
        >
          +
        </button>
      </div>
      <div className="tree">
        {state.sessions.map((sess) => {
          const active = sess.id === state.activeSessionId;
          const paneIds = sess.windows.flatMap((w) => leaves(w.root));
          return (
            <div key={sess.id}>
              {isRenaming('session', sess.id) ? (
                <InlineRename
                  value={sess.name}
                  onDone={(text) => {
                    if (text !== null) renameSession(sess.id, text);
                    stopRename();
                  }}
                />
              ) : (
                <button
                  className={`t-sess${active ? ' active' : ''}`}
                  onClick={() => selectSession(sess.id)}
                  {...renameProps('session', sess.id)}
                >
                  <span className="chev">▸</span>
                  <span className="sdot" style={{ ['--sc' as string]: sess.color }} />
                  <span className="name">{sess.name}</span>
                  <span className="meta">
                    <Glyphs ids={providersOf(paneIds.map((id) => state.panes[id]))} />
                    <span>{sess.windows.length}탭</span>
                  </span>
                </button>
              )}
              {active && (
                <div className="t-wins">
                  {sess.windows.map((w, i) =>
                    isRenaming('window', w.id) ? (
                      <InlineRename
                        key={w.id}
                        value={windowLabel(state, w)}
                        placeholder="비우면 자동 이름"
                        onDone={(text) => {
                          if (text !== null) renameWindow(w.id, text);
                          stopRename();
                        }}
                      />
                    ) : (
                      <button
                        key={w.id}
                        className={`t-win${w.id === sess.activeWindowId ? ' active' : ''}`}
                        onClick={() => selectWindow(w.id)}
                        {...renameProps('window', w.id)}
                      >
                        <span className="num">{i + 1}</span>
                        <span className="name">{windowLabel(state, w)}</span>
                        <span className="meta">
                          <Glyphs ids={providersOf(leaves(w.root).map((id) => state.panes[id]))} />
                          <span>{leaves(w.root).length}p</span>
                        </span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
