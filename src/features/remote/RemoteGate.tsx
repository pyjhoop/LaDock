import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { loadSettings } from '../settings/settings';
import { remoteClient, useLink } from './client';
import './remote.css';

/** 키보드에 없는 키를 눌러 주는 줄. 포커스된 pane의 PTY로 바로 보낸다. */
const KEYS: [string, string][] = [
  ['Esc', '\x1b'],
  ['Tab', '\t'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
  ['Enter', '\r'],
  ['Ctrl+C', '\x03'],
  ['Ctrl+D', '\x04'],
  ['Ctrl+L', '\x0c'],
];

function focusedPty(): number | undefined {
  const s = useStore.getState();
  const win = s.sessions
    .find((x) => x.id === s.activeSessionId)
    ?.windows.find(
      (w) => w.id === s.sessions.find((x) => x.id === s.activeSessionId)?.activeWindowId,
    );
  return win ? remoteClient?.ptyFor(win.focusPaneId) : undefined;
}

function sendToFocused(text: string) {
  const pty = focusedPty();
  if (pty !== undefined) remoteClient?.write(pty, text);
}

export function KeyBar() {
  const [text, setText] = useState('');
  return (
    <div className="remote-keys">
      <div className="remote-keys-row">
        {KEYS.map(([label, seq]) => (
          <button key={label} type="button" onClick={() => sendToFocused(seq)}>
            {label}
          </button>
        ))}
      </div>
      <form
        className="remote-send"
        onSubmit={(e) => {
          e.preventDefault();
          sendToFocused(text + '\r');
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="입력 후 전송 (Enter 포함)"
        />
        <button type="submit">전송</button>
      </form>
    </div>
  );
}

/** 폰에서 PC의 상태를 받기 전에는 앱을 그리지 않고, 끊기면 안내한다. */
export function RemoteGate({ children }: { children: ReactNode }) {
  const phase = useLink((s) => s.phase);
  const everReady = useLink((s) => s.everReady);
  useEffect(() => void loadSettings(), []);

  if (phase === 'no-token') {
    return (
      <div className="remote-msg">
        주소에 토큰이 없어요. PC의 설정 › 모바일 접속에 있는 주소로 열어 주세요.
      </div>
    );
  }
  if (!everReady) return <div className="remote-msg">PC에 연결하는 중…</div>;
  return (
    <>
      {children}
      {phase === 'closed' && <div className="remote-banner">연결이 끊겼어요. 다시 연결 중…</div>}
    </>
  );
}
