import { activeSession, windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { useKeys } from '../keys/keys';
import { InlineRename } from './InlineRename';
import { PROVIDER_GLYPH, providersOf, useSessionsUi } from './ui';
import './sessions.css';

export function Glyphs({ ids }: { ids: ReturnType<typeof providersOf> }) {
  return (
    <>
      {ids.map((id) => (
        <span key={id} style={{ color: PROVIDER_GLYPH[id].color }}>
          {PROVIDER_GLYPH[id].glyph}
        </span>
      ))}
    </>
  );
}

/** 타이틀바 안: 세션 버튼 → 현재 세션의 탭들 → [+] */
export function TitleTabs() {
  const state = useStore();
  const sess = activeSession(state);
  const renaming = useSessionsUi((s) => s.renaming);
  const { startRename, stopRename } = useSessionsUi.getState();
  const { renameSession, renameWindow, selectWindow, closeWindow, newWindow } = state;
  const openOverlay = useKeys((s) => s.openOverlay);

  const renamingSession = renaming?.target === 'session' && renaming.id === sess.id;

  return (
    <>
      {renamingSession ? (
        <InlineRename
          value={sess.name}
          onDone={(text) => {
            if (text !== null) renameSession(sess.id, text);
            stopRename();
          }}
        />
      ) : (
        <button
          className="sess-btn"
          title="세션 · 탭 트리 (Ctrl+B s) — 우클릭: 이름 변경"
          onClick={() => openOverlay({ kind: 'tree' })}
          onContextMenu={(e) => {
            e.preventDefault();
            useKeys.getState().closeOverlay();
            startRename({ target: 'session', id: sess.id });
          }}
          onDoubleClick={() => {
            useKeys.getState().closeOverlay();
            startRename({ target: 'session', id: sess.id });
          }}
        >
          <span className="sdot" style={{ ['--sc' as string]: sess.color }} />
          <span className="sname">{sess.name}</span>
          <span className="chev">▾</span>
        </button>
      )}
      <div className="tbar-sep" />
      <div className="tabs" role="tablist">
        {sess.windows.map((w, i) => {
          const active = w.id === sess.activeWindowId;
          const isRenaming = renaming?.target === 'window' && renaming.id === w.id;
          if (isRenaming) {
            return (
              <InlineRename
                key={w.id}
                value={windowLabel(state, w)}
                placeholder="비우면 자동 이름"
                onDone={(text) => {
                  if (text !== null) renameWindow(w.id, text);
                  stopRename();
                }}
              />
            );
          }
          return (
            <button
              key={w.id}
              className={`tab${active ? ' active' : ''}`}
              role="tab"
              aria-selected={active}
              onClick={() => selectWindow(w.id)}
              onDoubleClick={() => startRename({ target: 'window', id: w.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                startRename({ target: 'window', id: w.id });
              }}
              onAuxClick={(e) => e.button === 1 && closeWindow(sess.id, w.id)}
            >
              <span className="num">{i + 1}</span>
              <span className={`tname${w.name === null ? ' auto' : ''}`}>
                {windowLabel(state, w)}
              </span>
              <span className="tglyphs">
                <Glyphs ids={providersOf(leaves(w.root).map((id) => state.panes[id]))} />
              </span>
              <span
                className="x"
                role="button"
                title="탭 닫기"
                aria-label="탭 닫기"
                onClick={(e) => {
                  e.stopPropagation();
                  closeWindow(sess.id, w.id);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
        <button
          className="icon-btn tab-add"
          onClick={newWindow}
          title="새 탭 (Ctrl+B c)"
          aria-label="새 탭"
        >
          +
        </button>
      </div>
    </>
  );
}
