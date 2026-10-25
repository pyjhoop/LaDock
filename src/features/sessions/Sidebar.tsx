import { useState, type MouseEvent } from 'react';
import { IconChevR, IconFolder, IconFolderPlus } from '../../components/icons';
import { projectCwd, windowLabel } from '../../store/ops';
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
import { PROVIDER_GLYPH, addProject, addQuickProject, useSessionsUi } from './ui';

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

/** 프로젝트 목록. 프로젝트마다 탭 목록과, 그 아래 접을 수 있는 실행 중 에이전트가 붙는다. */
export function Sidebar() {
  const state = useStore();
  const mode = useSessionsUi((s) => s.mode);
  const drawer = mode !== 'wide';
  const open = useSessionsUi((s) => (s.mode === 'wide' ? s.sidebarOpen : s.drawerOpen));
  const renaming = useSessionsUi((s) => s.renaming);
  const detected = useDetected((s) => s.byPane);
  const activity = useActivity((s) => s.byPane);
  const liveCwds = usePaneCwds((s) => s.byPane);
  // 프로젝트 펼침(없으면 활성 프로젝트만) · 에이전트 접힘(없으면 펼침) · 프로젝트 영역 접힘
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [agentsFolded, setAgentsFolded] = useState<Record<string, boolean>>({});
  const [listFolded, setListFolded] = useState(false);
  const itemMenu = useItemMenu();
  if (!open) return null;
  const { renameSession, renameWindow } = state;
  const { startRename, stopRename, closeDrawer } = useSessionsUi.getState();
  // 드로어에서는 프로젝트 · 탭을 고르면 닫는다
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

  return (
    <>
      {drawer && <div className="scrim" onMouseDown={closeDrawer} />}
      <aside className={`sidebar${drawer ? ' drawer' : ''}`}>
        <section className="sb-sec">
          <div className="sec-head">
            <button
              className="sec-toggle"
              onClick={() => setListFolded((f) => !f)}
              aria-expanded={!listFolded}
            >
              <span className={`chev${listFolded ? '' : ' open'}`}>▸</span>
              <h3>프로젝트</h3>
              <span className="count">{state.sessions.length}</span>
            </button>
            <button
              className="icon-btn"
              onClick={(e) =>
                itemMenu.open(e, [
                  { label: '폴더 선택해서 추가', run: () => void addProject() },
                  { label: '기본 폴더에서 빠르게 시작', run: addQuickProject },
                ])
              }
              title="프로젝트 추가 (폴더 선택: Ctrl+B C)"
              aria-label="프로젝트 추가"
            >
              <IconFolderPlus />
            </button>
          </div>
          {!listFolded && (
            <div className="projects">
              {state.sessions.map((sess) => {
                const active = sess.id === state.activeSessionId;
                const isOpen = expanded[sess.id] ?? active;
                const cwd = projectCwd(state, sess);
                const agents = sess.windows.flatMap((w) =>
                  leaves(w.root).flatMap((paneId) => {
                    const pane = state.panes[paneId];
                    const provider =
                      pane && (pane.kind === 'agent' ? pane.provider : detected[pane.id]);
                    return provider
                      ? [{ paneId, provider, windowId: w.id, windowName: windowLabel(state, w) }]
                      : [];
                  }),
                );
                const agentsOpen = !agentsFolded[sess.id];
                return (
                  <div
                    key={sess.id}
                    className={`proj${active ? ' active' : ''}`}
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
                      <div className="proj-head">
                        <button
                          className="proj-fold"
                          aria-label={isOpen ? '접기' : '펼치기'}
                          onClick={() => setExpanded((e) => ({ ...e, [sess.id]: !isOpen }))}
                        >
                          <span className={`chev${isOpen ? ' open' : ''}`}>
                            <IconChevR />
                          </span>
                        </button>
                        <button
                          className="proj-main"
                          onClick={() => selectSession(sess.id)}
                          title={cwd || undefined}
                          {...renameProps('session', sess.id, () => state.closeSession(sess.id))}
                        >
                          <span className="proj-ico">
                            <IconFolder />
                          </span>
                          <span className="name">{sess.name}</span>
                          {agents.length > 0 && (
                            <span className="proj-agents" title="실행 중인 에이전트">
                              {agents.length}
                            </span>
                          )}
                        </button>
                      </div>
                    )}
                    {isOpen && (
                      <div className="proj-body">
                        {cwd && (
                          <div className="proj-path" title={cwd}>
                            {cwd}
                          </div>
                        )}
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
                        {agents.length > 0 && (
                          <div className="proj-agent-box">
                            <button
                              className="agents-toggle"
                              aria-expanded={agentsOpen}
                              onClick={() =>
                                setAgentsFolded((f) => ({ ...f, [sess.id]: agentsOpen }))
                              }
                            >
                              <span className={`chev${agentsOpen ? ' open' : ''}`}>
                                <IconChevR />
                              </span>
                              에이전트 {agents.length}
                            </button>
                            {agentsOpen &&
                              agents.map((a) => {
                                const st = activity[a.paneId] ?? 'idle';
                                return (
                                  <button
                                    key={a.paneId}
                                    className="agent-row"
                                    style={{ ['--pc' as string]: PROVIDER_GLYPH[a.provider].color }}
                                    title={`${PROVIDER_META[a.provider].name} · ${a.windowName} — 출력 흐름으로 추정한 상태`}
                                    onClick={() => {
                                      state.selectSession(sess.id);
                                      state.selectWindow(a.windowId);
                                      state.focusPane(a.paneId);
                                      if (drawer) closeDrawer();
                                    }}
                                  >
                                    <span className="ag">{PROVIDER_GLYPH[a.provider].glyph}</span>
                                    <span className="ag-name">
                                      {PROVIDER_META[a.provider].name}
                                    </span>
                                    <span className="ag-where">{a.windowName}</span>
                                    <span className={`ag-state ${st}`}>{STATE_LABEL[st]}</span>
                                  </button>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <TasksSection />
        <ItemMenu menu={itemMenu.menu} onClose={itemMenu.close} />
      </aside>
    </>
  );
}
