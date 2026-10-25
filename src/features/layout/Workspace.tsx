import { EmptyState } from './EmptyState';
import { useRef, type PointerEvent } from 'react';
import { DiffPane } from '../diff/DiffPane';
import { REFIT_EVENT, TerminalPane } from '../terminal/TerminalPane';
import { useStore } from '../../store/store';
import { computeLayout, type Divider } from '../../store/tree';
import type { Window } from '../../store/types';
import { envRemoveFor } from '../ai/providers';
import { useSettings } from '../settings/settings';
import { PROVIDER_GLYPH, useSessionsUi } from '../sessions/ui';
import './layout.css';

const pct = (n: number) => `${n * 100}%`;

function DividerBar({ windowId, divider }: { windowId: string; divider: Divider }) {
  const setRatio = useStore((s) => s.setRatio);
  const drag = useRef(false);
  const { area, dir, ratio, path } = divider;
  const style =
    dir === 'row'
      ? {
          left: `calc(${pct(area.x + area.w * ratio)} - 3px)`,
          top: pct(area.y),
          height: pct(area.h),
        }
      : {
          top: `calc(${pct(area.y + area.h * ratio)} - 3px)`,
          left: pct(area.x),
          width: pct(area.w),
        };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const r =
      dir === 'row'
        ? ((e.clientX - box.left) / box.width - area.x) / area.w
        : ((e.clientY - box.top) / box.height - area.y) / area.h;
    setRatio(windowId, path, r);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    delete document.body.dataset.dragging;
    window.dispatchEvent(new Event(REFIT_EVENT));
  };

  return (
    <div
      className={`divider ${dir}`}
      style={style}
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.dataset.dragging = '1';
      }}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}

function WindowLayout({ win, visible }: { win: Window; visible: boolean }) {
  const panes = useStore((s) => s.panes);
  const { fontFamily, fontSize, copyOnSelect } = useSettings((s) => s.settings);
  const { focusPane, splitFocused, closePane, toggleZoom } = useStore.getState();
  const layout = computeLayout(win.root);
  // 스택 모드(<640px)는 줌처럼 포커스 pane 하나만 보인다
  const stack = useSessionsUi((s) => s.mode === 'narrow');
  const single = win.zoomed || stack;

  return (
    <div className="win-layout" style={{ display: visible ? undefined : 'none' }}>
      {Object.entries(layout.panes).map(([id, rect]) => {
        const spec = panes[id];
        if (!spec) return null;
        const focused = id === win.focusPaneId;
        const hidden = single && !focused;
        const r = single ? { x: 0, y: 0, w: 1, h: 1 } : rect;
        return (
          <div
            key={id}
            className="pane-slot"
            style={{
              left: pct(r.x),
              top: pct(r.y),
              width: pct(r.w),
              height: pct(r.h),
              display: hidden ? 'none' : undefined,
            }}
          >
            {spec.kind === 'diff' && spec.diff ? (
              <DiffPane
                paneKey={id}
                root={spec.diff.root}
                hash={spec.diff.hash}
                focused={focused && visible}
                zoomed={win.zoomed}
                onFocus={() => focusPane(id)}
                onSplit={(dir) => {
                  focusPane(id);
                  splitFocused(dir);
                }}
                onToggleZoom={() => {
                  focusPane(id);
                  toggleZoom();
                }}
                onClose={() => closePane(id)}
              />
            ) : (
              <TerminalPane
                paneKey={id}
                profileId={spec.profileId}
                title={spec.title ?? spec.command ?? spec.profileId}
                cwd={spec.cwd || undefined}
                command={spec.command}
                args={spec.args}
                envRemove={envRemoveFor(spec)}
                keepShell={spec.kind === 'agent'}
                fontFamily={fontFamily}
                fontSize={fontSize}
                copyOnSelect={copyOnSelect}
                icon={spec.provider ? PROVIDER_GLYPH[spec.provider] : undefined}
                focused={focused && visible}
                zoomed={win.zoomed}
                onFocus={() => focusPane(id)}
                onSplit={(dir) => {
                  focusPane(id);
                  splitFocused(dir);
                }}
                onToggleZoom={() => {
                  focusPane(id);
                  toggleZoom();
                }}
                onClose={() => closePane(id)}
              />
            )}
          </div>
        );
      })}
      {!single &&
        layout.dividers.map((d) => (
          <DividerBar key={d.path.join('') || 'root'} windowId={win.id} divider={d} />
        ))}
    </div>
  );
}

/** 모든 세션 · 탭을 마운트해 두고 활성 탭만 보인다 — 숨겨도 터미널과 PTY는 유지된다. */
export function Workspace() {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  return (
    <div className="workspace">
      {sessions.length === 0 && <EmptyState />}
      {sessions.flatMap((sess) =>
        sess.windows.map((win) => (
          <WindowLayout
            key={win.id}
            win={win}
            visible={sess.id === activeSessionId && win.id === sess.activeWindowId}
          />
        )),
      )}
    </div>
  );
}
