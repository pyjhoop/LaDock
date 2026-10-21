import { activeSession, activeWindow } from '../../store/ops';
import { useStore } from '../../store/store';
import { leaves } from '../../store/tree';
import { PROVIDER_GLYPH } from '../sessions/ui';

/** 스택 모드: 활성 탭의 pane을 칩으로 나열해 전환한다 */
export function PaneChips() {
  const state = useStore();
  const win = activeWindow(activeSession(state));
  return (
    <div className="chips" role="tablist">
      {leaves(win.root).map((id, i) => {
        const p = state.panes[id];
        if (!p) return null;
        const g = p.kind === 'agent' && p.provider ? PROVIDER_GLYPH[p.provider] : null;
        const active = id === win.focusPaneId;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            className={`chip${active ? ' active' : ''}`}
            onClick={() => state.focusPane(id)}
          >
            <span className="g" style={g ? { color: g.color } : undefined}>
              {g ? g.glyph : '❯_'}
            </span>
            {p.no ?? i + 1}
          </button>
        );
      })}
    </div>
  );
}
