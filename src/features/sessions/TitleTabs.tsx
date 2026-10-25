import { IconChevD, IconClose, IconPlus } from '../../components/icons';
import { activeSession, windowLabel } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import type { PaneSpec } from '../../store/types';
import { useDetected } from '../terminal/detect';
import { useKeys } from '../keys/keys';
import { InlineRename } from './InlineRename';
import { ItemMenu, useItemMenu } from './ItemMenu';
import { PROVIDER_GLYPH, providersOf, useSessionsUi } from './ui';
import './sessions.css';

export function Glyphs({ panes }: { panes: (PaneSpec | undefined)[] }) {
  const detected = useDetected((s) => s.byPane);
  const ids = providersOf(panes, detected);
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

/** 타이틀바 안: 현재 프로젝트 버튼 */
export function ProjectButton() {
  const state = useStore();
  const sess = activeSession(state);
  const renaming = useSessionsUi((s) => s.renaming);
  const { startRename, stopRename } = useSessionsUi.getState();
  const { renameSession, closeSession } = state;
  const openOverlay = useKeys((s) => s.openOverlay);
  const itemMenu = useItemMenu();
  if (!sess) return null;
  const renamingSession =
    renaming?.target === 'session' && renaming.from === 'title' && renaming.id === sess.id;
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
          title="프로젝트 · 탭 트리 (Ctrl+B s) — 우클릭: 이름 변경 · 제거"
          onClick={() => openOverlay({ kind: 'tree' })}
          onContextMenu={(e) =>
            itemMenu.open(e, [
              {
                label: '이름 변경',
                run: () => {
                  useKeys.getState().closeOverlay();
                  startRename({ target: 'session', id: sess.id, from: 'title' });
                },
              },
              { label: '제거', danger: true, run: () => closeSession(sess.id) },
            ])
          }
          onDoubleClick={() => {
            useKeys.getState().closeOverlay();
            startRename({ target: 'session', id: sess.id, from: 'title' });
          }}
        >
          <span className="sdot" style={{ ['--sc' as string]: sess.color }} />
          <span className="sname">{sess.name}</span>
          <IconChevD />
        </button>
      )}
      <ItemMenu menu={itemMenu.menu} onClose={itemMenu.close} />
    </>
  );
}

/** 가운데 작업 영역 위: 현재 프로젝트의 탭들 → [+] */
export function TabStrip() {
  const state = useStore();
  const sess = activeSession(state);
  const renaming = useSessionsUi((s) => s.renaming);
  const { startRename, stopRename } = useSessionsUi.getState();
  const { renameWindow, selectWindow, closeWindow, newWindow } = state;
  const itemMenu = useItemMenu();
  if (!sess) return null;

  return (
    <div className="tabstrip">
      <div className="tabs" role="tablist">
        {sess.windows.map((w, i) => {
          const active = w.id === sess.activeWindowId;
          const isRenaming =
            renaming?.target === 'window' && renaming.from === 'title' && renaming.id === w.id;
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
              onDoubleClick={() => startRename({ target: 'window', id: w.id, from: 'title' })}
              onContextMenu={(e) =>
                itemMenu.open(e, [
                  {
                    label: '이름 변경',
                    run: () => startRename({ target: 'window', id: w.id, from: 'title' }),
                  },
                  { label: '제거', danger: true, run: () => closeWindow(sess.id, w.id) },
                ])
              }
              onAuxClick={(e) => e.button === 1 && closeWindow(sess.id, w.id)}
            >
              <span className="num">{i + 1}</span>
              <span className={`tname${w.name === null ? ' auto' : ''}`}>
                {windowLabel(state, w)}
              </span>
              <span className="tglyphs">
                <Glyphs panes={leaves(w.root).map((id) => state.panes[id])} />
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
                <IconClose />
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
          <IconPlus />
        </button>
      </div>
      <ItemMenu menu={itemMenu.menu} onClose={itemMenu.close} />
    </div>
  );
}
