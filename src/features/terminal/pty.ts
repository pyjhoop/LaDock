import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SpawnArgs {
  profileId: string;
  command?: string;
  args?: string[];
  cwd?: string;
  cols: number;
  rows: number;
  envRemove?: string[];
}

export function ptySpawn(args: SpawnArgs, onData: (data: Uint8Array) => void): Promise<number> {
  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (msg) => onData(new Uint8Array(msg));
  return invoke<number>('pty_spawn', { args, onData: channel });
}

export const ptyWrite = (paneId: number, data: Uint8Array) =>
  invoke<void>('pty_write', { paneId, data: Array.from(data) });

export const ptyResize = (paneId: number, cols: number, rows: number) =>
  invoke<void>('pty_resize', { paneId, cols, rows });

export const ptyKill = (paneId: number) => invoke<void>('pty_kill', { paneId });

export const ptyAck = (paneId: number, bytes: number) => invoke<void>('pty_ack', { paneId, bytes });

export function onPtyExit(handler: (paneId: number, code: number) => void): Promise<UnlistenFn> {
  return listen<{ paneId: number; code: number }>('pty://exit', (e) =>
    handler(e.payload.paneId, e.payload.code),
  );
}
