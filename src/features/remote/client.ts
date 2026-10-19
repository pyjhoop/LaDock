// 폰(브라우저) 쪽 연결. PC의 LaDock에 WebSocket으로 붙어 앱 상태를 맞추고,
// PTY 출력/입력을 중계하고, 읽기 전용 조회(rpc)를 PC에 맡긴다.
// 프로토콜: docs/milestones/M5-01-mobile-remote.md
import { create } from 'zustand';
import { useStore } from '../../store/store';
import { isAppState, pickState, type RemoteSnapshot } from './publish';

export interface PaneHandlers {
  onData: (data: Uint8Array) => void;
  onSize: (cols: number, rows: number) => void;
}

export interface RemoteClient {
  waitPty: (paneKey: string) => Promise<number>;
  ptyFor: (paneKey: string) => number | undefined;
  attach: (pty: number, h: PaneHandlers) => () => void;
  write: (pty: number, text: string) => void;
  rpc: (cmd: string, args?: unknown) => Promise<unknown>;
  /** 'pty://exit' 같은 PC 이벤트를 받는다 */
  onEvent: (fn: (event: string, payload: unknown) => void) => void;
}

/** 폰 모드일 때만 값이 있다. TerminalPane 등이 PC 모드와 갈라지는 기준. */
export let remoteClient: RemoteClient | null = null;

interface Link {
  phase: 'connecting' | 'ready' | 'closed' | 'no-token';
  /** 한 번이라도 PC 상태를 받았는가 (끊겨도 화면은 유지한다) */
  everReady: boolean;
}
export const useLink = create<Link>()(() => ({ phase: 'connecting', everReady: false }));

const TOKEN_KEY = 'ladock.token';
const STATE_DEBOUNCE_MS = 150;

function loadToken(): string {
  // 주소의 #토큰을 저장해 두고 주소창에서는 지운다
  const hash = location.hash.slice(1);
  try {
    if (hash) {
      localStorage.setItem(TOKEN_KEY, hash);
      history.replaceState(null, '', location.pathname);
    }
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return hash;
  }
}

export function startRemoteClient(): void {
  const token = loadToken();
  if (!token) useLink.setState({ phase: 'no-token' });
  let ws: WebSocket | null = null;
  const ptys = new Map<string, number>();
  const waiters = new Map<string, ((pty: number) => void)[]>();
  const attached = new Map<number, PaneHandlers>();
  const rpcs = new Map<number, { ok: (v: unknown) => void; fail: (e: unknown) => void }>();
  const eventFns: ((event: string, payload: unknown) => void)[] = [];
  let nextRpc = 1;
  let lastState = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  remoteClient = {
    waitPty: (key) => {
      const have = ptys.get(key);
      if (have !== undefined) return Promise.resolve(have);
      return new Promise((resolve) => waiters.set(key, [...(waiters.get(key) ?? []), resolve]));
    },
    ptyFor: (key) => ptys.get(key),
    attach: (pty, h) => {
      attached.set(pty, h);
      send({ t: 'attach', pane: pty });
      return () => {
        if (attached.get(pty) === h) {
          attached.delete(pty);
          send({ t: 'detach', pane: pty });
        }
      };
    },
    write: (pty, text) => send({ t: 'input', pane: pty, data: text }),
    rpc: (cmd, args) =>
      new Promise((ok, fail) => {
        const id = nextRpc++;
        rpcs.set(id, { ok, fail });
        send({ t: 'rpc', id, cmd, args });
      }),
    onEvent: (fn) => void eventFns.push(fn),
  };

  const applySnapshot = (snap: RemoteSnapshot) => {
    for (const [key, pty] of Object.entries(snap.ptys)) {
      ptys.set(key, pty);
      waiters.get(key)?.forEach((r) => r(pty));
      waiters.delete(key);
    }
    for (const key of [...ptys.keys()]) if (!(key in snap.ptys)) ptys.delete(key);
    if (!isAppState(snap.state)) return;
    const next = pickState(snap.state);
    if (JSON.stringify(next) !== JSON.stringify(pickState(useStore.getState()))) {
      useStore.setState(next);
    }
    // 방금 받은 상태를 폰이 다시 보내지 않도록 기준을 맞춘다
    lastState = JSON.stringify(pickState(useStore.getState()));
    useLink.setState({ phase: 'ready', everReady: true });
  };

  // 폰에서 바꾼 상태(탭 전환, 분할, 닫기…)를 PC로 보낸다
  useStore.subscribe(() => {
    if (useLink.getState().phase !== 'ready') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const json = JSON.stringify(pickState(useStore.getState()));
      if (json === lastState) return;
      lastState = json;
      send({ t: 'state', state: JSON.parse(json) });
    }, STATE_DEBOUNCE_MS);
  });

  const connect = () => {
    if (!token) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(token)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      // 재연결: 이미 열려 있는 pane들을 다시 붙인다 (재생 버퍼부터 받는다)
      for (const pty of attached.keys()) send({ t: 'attach', pane: pty });
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        const buf = new Uint8Array(e.data as ArrayBuffer);
        const pty = new DataView(buf.buffer).getUint32(0, true);
        attached.get(pty)?.onData(buf.subarray(4));
        return;
      }
      const m = JSON.parse(e.data) as Record<string, unknown>;
      switch (m.t) {
        case 'layout':
          applySnapshot(m.layout as RemoteSnapshot);
          break;
        case 'attached':
        case 'size':
          attached.get(m.pane as number)?.onSize(m.cols as number, m.rows as number);
          break;
        case 'exit':
          eventFns.forEach((fn) => fn('pty://exit', { paneId: m.pane, code: m.code }));
          break;
        case 'rpc': {
          const r = rpcs.get(m.id as number);
          rpcs.delete(m.id as number);
          if (m.ok) r?.ok(m.result);
          else r?.fail(m.result);
          break;
        }
      }
    };
    ws.onclose = () => {
      useLink.setState({ phase: 'closed' });
      setTimeout(connect, 2000);
    };
  };
  connect();
}
