import { useEffect, useRef } from 'react';
import { useStore } from '../../store/store';
import { TreeOverlay } from '../sessions/TreeOverlay';
import { HELP_ROWS, prefixLabel } from './keymap';
import { useKeys } from './keys';
import './keys.css';

function HelpOverlay() {
  const prefix = useKeys((s) => s.prefix);
  const close = useKeys((s) => s.closeOverlay);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?') close();
    };
    (document.activeElement as HTMLElement | null)?.blur();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="overlay-box" onMouseDown={(e) => e.stopPropagation()}>
        <h2>단축키</h2>
        <p className="muted">
          <kbd>{prefixLabel(prefix)}</kbd> 를 누른 뒤 2초 안에 다음 키
        </p>
        <table>
          <tbody>
            {HELP_ROWS.map((r) => (
              <tr key={r.keys}>
                <td>
                  <kbd>{r.keys}</kbd>
                </td>
                <td>
                  {r.desc}
                  {r.extension && <span className="ext">LaDock 확장</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenameOverlay({
  target,
  id,
  value,
}: {
  target: 'session' | 'window';
  id: string;
  value: string;
}) {
  const close = useKeys((s) => s.closeOverlay);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);
  const submit = (text: string) => {
    const { renameSession, renameWindow } = useStore.getState();
    if (target === 'session') renameSession(id, text);
    else renameWindow(id, text); // 빈 이름이면 auto-rename으로 돌아간다
    close();
  };
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="overlay-box small" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{target === 'session' ? '세션 이름 변경' : '탭 이름 변경'}</h2>
        <input
          ref={inputRef}
          autoFocus
          defaultValue={value}
          placeholder={target === 'window' ? '비우면 자동 이름' : undefined}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') submit(e.currentTarget.value);
            else if (e.key === 'Escape') close();
          }}
        />
      </div>
    </div>
  );
}

export function Overlays() {
  const overlay = useKeys((s) => s.overlay);
  return (
    <>
      {overlay?.kind === 'help' && <HelpOverlay />}
      {overlay?.kind === 'tree' && <TreeOverlay />}
      {overlay?.kind === 'rename' && (
        <RenameOverlay
          key={overlay.id}
          target={overlay.target}
          id={overlay.id}
          value={overlay.value}
        />
      )}
    </>
  );
}
