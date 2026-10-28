import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconChevR, IconFolder, IconFolderPlus } from '../../components/icons';
import { projectCwd, windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { PROVIDER_META } from '../ai/providers';
import { useActivity } from '../terminal/activity';
import { useDetected } from '../terminal/detect';
import { TasksSection } from '../tasks/TasksSection';
import { InlineRename } from './InlineRename';
import { ItemMenu, useItemMenu } from './ItemMenu';
import { canAddFolder, folderPath, useGroups, type Folder } from './groups';
import type { Session } from '../../store/types';
import { PROVIDER_GLYPH, SIDEBAR_DEFAULT, addProject, addQuickProject, useSessionsUi } from './ui';

const STATE_LABEL = { working: '작업 중', done: '완료', idle: '대기' } as const;

/** 프로젝트 목록. 프로젝트마다 그 아래 접을 수 있는 실행 중 에이전트가 붙는다 (탭은 상단 탭 줄에만 둔다). */
export function Sidebar() {
  const state = useStore();
  const mode = useSessionsUi((s) => s.mode);
  const drawer = mode !== 'wide';
  const open = useSessionsUi((s) => (s.mode === 'wide' ? s.sidebarOpen : s.drawerOpen));
  const renaming = useSessionsUi((s) => s.renaming);
  const detected = useDetected((s) => s.byPane);
  const activity = useActivity((s) => s.byPane);
  // 프로젝트 펼침(없으면 활성 프로젝트만) · 에이전트 접힘(없으면 펼침) · 프로젝트 영역 접힘
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [agentsFolded, setAgentsFolded] = useState<Record<string, boolean>>({});
  const [listFolded, setListFolded] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const itemMenu = useItemMenu();
  const width = useSessionsUi((s) => s.sidebarWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const { folders, assign, collapsed } = useGroups();
  if (!open) return null;
  const { renameSession } = state;
  const { startRename, stopRename, closeDrawer } = useSessionsUi.getState();
  // 드로어에서는 프로젝트를 고르면 닫는다
  const selectSession = (id: string) => {
    state.selectSession(id);
    if (drawer) closeDrawer();
  };
  const renameProps = (
    target: 'session' | 'window',
    id: string,
    remove: () => void,
    extra: { label: string; run: () => void }[] = [],
  ) => ({
    onDoubleClick: () => startRename({ target, id, from: 'side' }),
    onContextMenu: (e: MouseEvent) =>
      itemMenu.open(e, [
        { label: '이름 변경', run: () => startRename({ target, id, from: 'side' }) },
        ...extra,
        { label: '제거', danger: true, run: remove },
      ]),
  });
  const groups = useGroups.getState();
  const folderIds = new Set(folders.map((f) => f.id));
  const folderOf = (id: string) => (assign[id] && folderIds.has(assign[id]) ? assign[id] : null);
  const moveActions = (sessId: string) => [
    ...(folderOf(sessId)
      ? [{ label: '폴더에서 꺼내기', run: () => groups.moveProject(sessId, null) }]
      : []),
    ...folders
      .filter((f) => f.id !== folderOf(sessId))
      .map((f) => ({
        label: `폴더로 이동: ${folderPath(folders, f.id)}`,
        run: () => groups.moveProject(sessId, f.id),
      })),
  ];
  const addFolder = (parent: string | null) => {
    const id = groups.addFolder(parent);
    if (id) setRenamingFolder(id);
  };
  const isRenaming = (target: 'session' | 'window', id: string) =>
    renaming?.from === 'side' && renaming.target === target && renaming.id === id;

  const renderProject = (sess: Session) => {
    const active = sess.id === state.activeSessionId;
    const isOpen = expanded[sess.id] ?? active;
    const cwd = projectCwd(state, sess);
    const agents = sess.windows.flatMap((w) =>
      leaves(w.root).flatMap((paneId) => {
        const pane = state.panes[paneId];
        const provider = pane && (pane.kind === 'agent' ? pane.provider : detected[pane.id]);
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
              {...renameProps(
                'session',
                sess.id,
                () => state.closeSession(sess.id),
                moveActions(sess.id),
              )}
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
            {agents.length > 0 && (
              <div className="proj-agent-box">
                <button
                  className="agents-toggle"
                  aria-expanded={agentsOpen}
                  onClick={() => setAgentsFolded((f) => ({ ...f, [sess.id]: agentsOpen }))}
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
                        <span className="ag-name">{PROVIDER_META[a.provider].name}</span>
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
  };

  const renderFolder = (f: Folder): ReactNode => {
    const isOpen = !collapsed[f.id];
    const kids = folders.filter((x) => x.parent === f.id);
    const projs = state.sessions.filter((x) => folderOf(x.id) === f.id);
    return (
      <div key={f.id} className="fold">
        {renamingFolder === f.id ? (
          <InlineRename
            value={f.name}
            onDone={(text) => {
              if (text !== null) groups.renameFolder(f.id, text);
              setRenamingFolder(null);
            }}
          />
        ) : (
          <button
            className="fold-head"
            aria-expanded={isOpen}
            onClick={() => groups.toggleFolder(f.id)}
            onDoubleClick={() => setRenamingFolder(f.id)}
            onContextMenu={(e) =>
              itemMenu.open(e, [
                { label: '이름 변경', run: () => setRenamingFolder(f.id) },
                ...(canAddFolder(folders, f.id)
                  ? [{ label: '하위 폴더 추가', run: () => addFolder(f.id) }]
                  : []),
                {
                  label: '폴더 제거 (안의 항목은 위로)',
                  danger: true,
                  run: () => groups.removeFolder(f.id),
                },
              ])
            }
            title={folderPath(folders, f.id)}
          >
            <span className={`chev${isOpen ? ' open' : ''}`}>
              <IconChevR />
            </span>
            <span className="proj-ico">
              <IconFolder />
            </span>
            <span className="name">{f.name}</span>
            <span className="count">{projs.length}</span>
          </button>
        )}
        {isOpen && (kids.length > 0 || projs.length > 0) && (
          <div className="fold-body">
            {kids.map((k) => renderFolder(k))}
            {projs.map(renderProject)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {drawer && <div className="scrim" onMouseDown={closeDrawer} />}
      <aside className={`sidebar${drawer ? ' drawer' : ''}`} style={drawer ? undefined : { width }}>
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
                  { label: '묶음 폴더 만들기', run: () => addFolder(null) },
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
              {folders.filter((f) => f.parent === null).map((f) => renderFolder(f))}
              {state.sessions.filter((x) => !folderOf(x.id)).map(renderProject)}
            </div>
          )}
        </section>
        <TasksSection />
        <ItemMenu menu={itemMenu.menu} onClose={itemMenu.close} />
      </aside>
      {!drawer && (
        <div
          className="sbresize"
          role="separator"
          aria-orientation="vertical"
          title="드래그해서 폭 조절 (더블클릭: 기본 폭)"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, w: width };
          }}
          onPointerMove={(e) => {
            if (drag.current)
              useSessionsUi.getState().setSidebarWidth(drag.current.w + e.clientX - drag.current.x);
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={() => useSessionsUi.getState().setSidebarWidth(SIDEBAR_DEFAULT)}
        />
      )}
    </>
  );
}
