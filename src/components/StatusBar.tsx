import { IconGear } from './icons';
import { activeSession, activeWindow, windowLabel } from '../store/ops';
import { useStore } from '../store/store';
import { leaves } from '../store/tree';
import { prefixLabel } from '../features/keys/keymap';
import { useKeys } from '../features/keys/keys';
import { LimitBar } from '../features/limits/LimitBar';

export function StatusBar() {
  const state = useStore();
  const prefixActive = useKeys((s) => s.prefixActive);
  const prefix = useKeys((s) => s.prefix);
  const openOverlay = useKeys((s) => s.openOverlay);
  const sess = activeSession(state);
  const win = activeWindow(sess);
  const ids = leaves(win.root);
  const idx = ids.indexOf(win.focusPaneId) + 1;
  const cwd = state.panes[win.focusPaneId]?.cwd;
  const p = prefixLabel(prefix).replace('Ctrl+', '^');

  return (
    <footer className="statusbar">
      <span className={`prefix-chip${prefixActive ? ' on' : ''}`}>PREFIX</span>
      <span className="sess">
        <span className="sdot" style={{ ['--sc' as string]: sess.color }} />
        {sess.name}
      </span>
      <span className="wins">
        {sess.windows.map((w, i) => {
          const on = w.id === sess.activeWindowId;
          return (
            <span key={w.id} className={on ? 'on' : undefined}>
              {i + 1}:{windowLabel(state, w)}
              {on && '*'}
            </span>
          );
        })}
      </span>
      <span>
        pane {idx}/{ids.length}
        {win.zoomed && ' · ZOOM'}
      </span>
      <span className="cwd" title={cwd || undefined}>
        {cwd}
      </span>
      <span className="grow" />
      <span className="hints">
        <span>
          <kbd>{p}</kbd>
          <kbd>s</kbd> 프로젝트
        </span>
        <span>
          <kbd>{p}</kbd>
          <kbd>c</kbd> 탭
        </span>
        <span className="opt">
          <kbd>{p}</kbd>
          <kbd>%</kbd> 분할
        </span>
        <span className="opt">
          <kbd>{p}</kbd>
          <kbd>a</kbd> AI
        </span>
      </span>
      <LimitBar />
      <button
        className="sb-btn"
        title="설정"
        aria-label="설정"
        onClick={() => openOverlay({ kind: 'settings' })}
      >
        <IconGear />
      </button>
      <button
        className="sb-btn"
        title={`단축키 (${prefixLabel(prefix)} ?)`}
        onClick={() => openOverlay({ kind: 'help' })}
      >
        ?
      </button>
    </footer>
  );
}
