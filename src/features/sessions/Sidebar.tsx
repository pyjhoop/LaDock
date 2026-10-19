import { windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { Glyphs } from './TitleTabs';
import { createSessionAndRename, providersOf, useSessionsUi } from './ui';

/** 활성 세션만 펼쳐서 탭 목록을 보여주는 세션 트리 */
export function Sidebar() {
  const state = useStore();
  const open = useSessionsUi((s) => s.sidebarOpen);
  if (!open) return null;
  const { selectSession, selectWindow } = state;

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
              <button
                className={`t-sess${active ? ' active' : ''}`}
                onClick={() => selectSession(sess.id)}
              >
                <span className="chev">▸</span>
                <span className="sdot" style={{ ['--sc' as string]: sess.color }} />
                <span className="name">{sess.name}</span>
                <span className="meta">
                  <Glyphs ids={providersOf(paneIds.map((id) => state.panes[id]))} />
                  <span>{sess.windows.length}탭</span>
                </span>
              </button>
              {active && (
                <div className="t-wins">
                  {sess.windows.map((w, i) => (
                    <button
                      key={w.id}
                      className={`t-win${w.id === sess.activeWindowId ? ' active' : ''}`}
                      onClick={() => selectWindow(w.id)}
                    >
                      <span className="num">{i + 1}</span>
                      <span className="name">{windowLabel(state, w)}</span>
                      <span className="meta">
                        <Glyphs ids={providersOf(leaves(w.root).map((id) => state.panes[id]))} />
                        <span>{leaves(w.root).length}p</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
