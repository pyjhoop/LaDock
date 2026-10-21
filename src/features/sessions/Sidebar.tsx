import { useState, type MouseEvent } from 'react';
import { windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { PROVIDER_META } from '../ai/providers';
import { useActivity } from '../terminal/activity';
import { useDetected } from '../terminal/detect';
import { usePaneCwds } from '../terminal/registry';
import { TasksSection } from '../tasks/TasksSection';
import { InlineRename } from './InlineRename';
import { ItemMenu, useItemMenu } from './ItemMenu';
import { Glyphs } from './TitleTabs';
import { PROVIDER_GLYPH, createSessionAndRename, useSessionsUi } from './ui';

/** 탭의 기본 경로: 맨 처음 pane의 현재 폴더 */
function baseCwd(
  state: ReturnType<typeof useStore.getState>,
  w: Parameters<typeof windowLabel>[1],
  live: Record<string, string>,
): string {
  const first = leaves(w.root)[0];
  return (first && live[first]) || state.panes[first]?.cwd || '';
}

const STATE_LABEL = { working: '작업 중', done: '완료', idle: '대기' } as const;

/** 세션 카드 목록(접고 펼침)과 실행 중인 에이전트 카드 목록 */
export function Sidebar() {
  const state = useStore();
  const mode = useSessionsUi((s) => s.mode);
  const drawer = mode !== 'wide';
  const open = useSessionsUi((s) => (s.mode === 'wide' ? s.sidebarOpen : s.drawerOpen));
  const renaming = useSessionsUi((s) => s.renaming);
  const detected = useDetected((s) => s.byPane);
  const activity = useActivity((s) => s.byPane);
  const liveCwds = usePaneCwds((s) => s.byPane);
  // 세션 카드 펼침 여부(없으면 활성 세션만 펼침) · 섹션 접힘 여부
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folded, setFolded] = useState({ sessions: false, agents: false });
  const itemMenu = useItemMenu();
  if (!open) return null;
  const agents = state.sessions.flatMap((sess) =>
    sess.windows.flatMap((w) =>
      leaves(w.root).flatMap((paneId) => {
        const pane = state.panes[paneId];
        const provider = pane && (pane.kind === 'agent' ? pane.provider : detected[pane.id]);
        return provider
          ? [
              {
                paneId,
                provider,
                cwd: pane.cwd,
                sessionId: sess.id,
                sessionName: sess.name,
                windowId: w.id,
                windowName: windowLabel(state, w),
              },
            ]
          : [];
      }),
    ),
  );
  const { renameSession, renameWindow } = state;
  const { startRename, stopRename, closeDrawer } = useSessionsUi.getState();
  // 드로어에서는 세션 · 탭을 고르면 닫는다
  const selectSession = (id: string) => {
    state.selectSession(id);
    if (drawer) closeDrawer();
  };
  const selectWindow = (id: string) => {
    state.selectWindow(id);
    if (drawer) closeDrawer();
  };
  const renameProps = (target: 'session' | 'window', id: string, remove: () => void) => ({
    onDoubleClick: () => startRename({ target, id, from: 'side' }),
    onContextMenu: (e: MouseEvent) =>
      itemMenu.open(e, [
        { label: '이름 변경', run: () => startRename({ target, id, from: 'side' }) },
        { label: '제거', danger: true, run: remove },
      ]),
  });
  const isRenaming = (target: 'session' | 'window', id: string) =>
    renaming?.from === 'side' && renaming.target === target && renaming.id === id;
  const fold = (k: 'sessions' | 'agents') => setFolded((f) => ({ ...f, [k]: !f[k] }));

  return (
    <>
      {drawer && <div className="scrim" onMouseDown={closeDrawer} />}
      <aside className={`sidebar${drawer ? ' drawer' : ''}`}>
        <section className="sb-sec">
          <div className="sec-head">
            <button
              className="sec-toggle"
              onClick={() => fold('sessions')}
              aria-expanded={!folded.sessions}
            >
              <span className={`chev${folded.sessions ? '' : ' open'}`}>▸</span>
              <h3>세션</h3>
              <span className="count">{state.sessions.length}</span>
            </button>
            <button
              className="icon-btn"
              onClick={createSessionAndRename}
              title="새 세션 (Ctrl+B C)"
              aria-label="새 세션"
            >
              +
            </button>
          </div>
          {!folded.sessions && (
            <div className="cards">
              {state.sessions.map((sess) => {
                const active = sess.id === state.activeSessionId;
                const isOpen = expanded[sess.id] ?? active;
                const paneIds = sess.windows.flatMap((w) => leaves(w.root));
                return (
                  <div
                    key={sess.id}
                    className={`card${active ? ' active' : ''}`}
                    style={{ ['--sc' as string]: sess.color }}
                  >
                    {isRenaming('session', sess.id) ? (
                      <InlineRename
                        value={sess.name}
                        onDone={(text) => {
                          if (text !== null) renameSession(sess.id, text);
                          stopRename();
                        }}
                      />
                    ) : (
                      <div className="card-head">
                        <button
                          className="card-main"
                          onClick={() => selectSession(sess.id)}
                          {...renameProps('session', sess.id, () => state.closeSession(sess.id))}
                        >
                          <span className="sdot" />
                          <span className="name">{sess.name}</span>
                          <span className="meta">
                            <Glyphs panes={paneIds.map((id) => state.panes[id])} />
                            <span>{sess.windows.length}탭</span>
                          </span>
                        </button>
                        <button
                          className="card-fold"
                          aria-label={isOpen ? '접기' : '펼치기'}
                          onClick={() => setExpanded((e) => ({ ...e, [sess.id]: !isOpen }))}
                        >
                          <span className={`chev${isOpen ? ' open' : ''}`}>▸</span>
                        </button>
                      </div>
                    )}
                    {isOpen && (
                      <div className="card-body">
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
                              className={`t-win${active && w.id === sess.activeWindowId ? ' active' : ''}`}
                              onClick={() => {
                                state.selectSession(sess.id);
                                selectWindow(w.id);
                              }}
                              {...renameProps('window', w.id, () =>
                                state.closeWindow(sess.id, w.id),
                              )}
                            >
                              <span className="num">{i + 1}</span>
                              <span className="name">{windowLabel(state, w)}</span>
                              <span className="meta">
                                <Glyphs panes={leaves(w.root).map((id) => state.panes[id])} />
                                <span>{leaves(w.root).length}p</span>
                              </span>
                              {baseCwd(state, w, liveCwds) && (
                                <span className="wcwd" title={baseCwd(state, w, liveCwds)}>
                                  {baseCwd(state, w, liveCwds)}
                                </span>
                              )}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="sb-sec">
          <div className="sec-head">
            <button
              className="sec-toggle"
              onClick={() => fold('agents')}
              aria-expanded={!folded.agents}
            >
              <span className={`chev${folded.agents ? '' : ' open'}`}>▸</span>
              <h3>실행 중 에이전트</h3>
              <span className="count">{agents.length}</span>
            </button>
          </div>
          {!folded.agents && (
            <div className="cards">
              {agents.length === 0 && <p className="agent-empty">실행 중인 에이전트가 없습니다</p>}
              {agents.map((a) => (
                <button
                  key={a.paneId}
                  className="card agent-card"
                  style={{ ['--pc' as string]: PROVIDER_GLYPH[a.provider].color }}
                  title={a.cwd || undefined}
                  onClick={() => {
                    state.selectSession(a.sessionId);
                    state.selectWindow(a.windowId);
                    state.focusPane(a.paneId);
                    if (drawer) closeDrawer();
                  }}
                >
                  <span className="ag">{PROVIDER_GLYPH[a.provider].glyph}</span>
                  <span className="ag-text">
                    <span className="ag-name">{PROVIDER_META[a.provider].name}</span>
                    <span className="ag-where">
                      {a.sessionName} › {a.windowName}
                    </span>
                  </span>
                  <span
                    className={`ag-state ${activity[a.paneId] ?? 'idle'}`}
                    title="출력 흐름으로 추정한 상태"
                  >
                    {STATE_LABEL[activity[a.paneId] ?? 'idle']}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <TasksSection />
        <ItemMenu menu={itemMenu.menu} onClose={itemMenu.close} />
      </aside>
    </>
  );
}
