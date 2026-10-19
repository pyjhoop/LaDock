import { useEffect, useRef, useState } from 'react';
import {
  launchAgent,
  PROVIDER_META,
  PROVIDER_ORDER,
  useProviders,
  type LaunchWhere,
} from '../ai/providers';
import { PROVIDER_GLYPH } from '../sessions/ui';
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

const WHERE_KEYS: { code: string; where: LaunchWhere; label: string }[] = [
  { code: 'KeyR', where: 'row', label: 'R 오른쪽 분할' },
  { code: 'KeyD', where: 'col', label: 'D 아래 분할' },
  { code: 'KeyT', where: 'tab', label: 'T 새 탭' },
];

function PaletteOverlay() {
  const close = useKeys((s) => s.closeOverlay);
  const statuses = useProviders((s) => s.statuses);
  const [where, setWhere] = useState<LaunchWhere>('row');
  const [message, setMessage] = useState<string | null>(null);

  const launch = (i: number, at: LaunchWhere) => {
    const err = launchAgent(PROVIDER_ORDER[i], at);
    if (err) setMessage(err);
    else close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'Escape') return close();
      const w = WHERE_KEYS.find((k) => k.code === e.code);
      if (w) return setWhere(w.where);
      const digit = /^Digit([1-4])$/.exec(e.code);
      if (digit) launch(Number(digit[1]) - 1, where);
    };
    (document.activeElement as HTMLElement | null)?.blur();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, where]);

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="overlay-box small" onMouseDown={(e) => e.stopPropagation()}>
        <h2>AI 실행</h2>
        <div className="pal-where">
          {WHERE_KEYS.map((k) => (
            <button
              key={k.code}
              type="button"
              className={k.where === where ? 'on' : undefined}
              onClick={() => setWhere(k.where)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <ul className="pal-list">
          {PROVIDER_ORDER.map((id, i) => {
            const st = statuses.find((s) => s.id === id);
            const installed = st?.installed ?? false;
            const g = PROVIDER_GLYPH[id];
            return (
              <li key={id}>
                <button
                  type="button"
                  className={installed ? undefined : 'off'}
                  onClick={() => launch(i, where)}
                >
                  <kbd>{i + 1}</kbd>
                  <span style={{ color: g.color }}>{g.glyph}</span>
                  <span>{PROVIDER_META[id].name}</span>
                  <span className="muted">{installed ? st?.version : '미설치'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {message && <p className="pal-msg">{message}</p>}
        <p className="muted">숫자로 실행 · Esc 닫기</p>
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
      {overlay?.kind === 'palette' && <PaletteOverlay />}
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
