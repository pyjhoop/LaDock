// 브라우저(폰)에는 Tauri가 없으므로, 앱이 쓰는 `@tauri-apps/api`의 내부 규약만 흉내 낸다.
// pty_* 는 TerminalPane이 폰 모드에서 따로 처리하고, 나머지 조회는 PC에 rpc로 맡긴다.
import { remoteClient } from './client';

type Callback = (arg: unknown) => void;

interface Listener {
  event: string;
  cb: Callback;
}

const callbacks = new Map<number, Callback>();
const listeners = new Map<number, Listener>();
let nextId = 1;

/** PC에서 온 이벤트를 `listen()`으로 등록된 콜백에 전달한다 */
export function dispatchEvent(event: string, payload: unknown) {
  for (const [id, l] of listeners) if (l.event === event) l.cb({ event, id, payload });
}

const NOOP = new Set([
  'pty_resize',
  'pty_ack',
  'pty_kill',
  'pty_spawn',
  'notify_agent_done',
  'state_save',
  'settings_save',
]);

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case 'plugin:event|listen': {
      const id = nextId++;
      const cb = callbacks.get(args.handler as number);
      if (cb) listeners.set(id, { event: args.event as string, cb });
      return id;
    }
    case 'plugin:event|unlisten':
      listeners.delete(args.eventId as number);
      return null;
    case 'plugin:app|version':
      return '';
    case 'pty_write': {
      const text = new TextDecoder().decode(new Uint8Array(args.data as number[]));
      remoteClient?.write(args.paneId as number, text);
      return null;
    }
  }
  if (cmd.startsWith('plugin:') || NOOP.has(cmd)) return null;
  return remoteClient?.rpc(cmd, args);
}

export function installTauriShim() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (cb: Callback) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id: number) => void callbacks.delete(id),
    convertFileSrc: (p: string) => p,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, id: number) => void listeners.delete(id),
  };
}
