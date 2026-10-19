import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { onPtyExit, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite, type SpawnArgs } from './pty';
import { readTerminalTheme, watchTheme } from './theme';
import './terminal.css';

export interface TerminalPaneProps {
  profileId: string;
  title: string;
  cwd?: string;
  command?: string;
  args?: string[];
  envRemove?: string[];
  /** 선택하면 자동 복사. 기본 끔 (M3-02 설정 연결 전까지 prop). */
  copyOnSelect?: boolean;
  onClose?: () => void;
}

const ACTIVITY_MS = 1000;
const RESIZE_DEBOUNCE_MS = 80;
const encoder = new TextEncoder();

export function TerminalPane({
  profileId,
  title,
  cwd,
  command,
  args,
  envRemove,
  copyOnSelect = false,
  onClose,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const onCloseRef = useRef(onClose);
  const copyRef = useRef(copyOnSelect);
  useEffect(() => {
    onCloseRef.current = onClose;
    copyRef.current = copyOnSelect;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(host);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      term.loadAddon(gl);
    } catch {
      // WebGL 불가 → 기본 DOM 렌더러
    }
    fit.fit();

    let disposed = false;
    let paneId: number | null = null;
    let exited = false;
    let activityTimer: number | undefined;
    let resizeTimer: number | undefined;

    const markActive = () => {
      setActive(true);
      clearTimeout(activityTimer);
      activityTimer = window.setTimeout(() => setActive(false), ACTIVITY_MS);
    };

    const spawnArgs = (): SpawnArgs => ({
      profileId,
      command,
      args,
      cwd,
      envRemove,
      cols: term.cols,
      rows: term.rows,
    });

    const start = async () => {
      exited = false;
      setExitCode(null);
      let id: number | null = null;
      const pending: Uint8Array[] = [];
      const write = (pid: number, data: Uint8Array) => {
        markActive();
        term.write(data, () => void ptyAck(pid, data.length).catch(() => {}));
      };
      const handle = (data: Uint8Array) => {
        if (id === null) pending.push(data);
        else write(id, data);
      };
      try {
        id = await ptySpawn(spawnArgs(), handle);
      } catch (e) {
        term.write(`\r\n\x1b[31m[실행 실패: ${String(e)}]\x1b[0m`);
        exited = true;
        setExitCode(-1);
        return;
      }
      if (disposed) {
        void ptyKill(id);
        return;
      }
      paneId = id;
      const spawned = id;
      pending.splice(0).forEach((d) => write(spawned, d));
    };

    const restart = () => {
      term.reset();
      fit.fit();
      void start();
    };

    const unlistenExit = onPtyExit((pid, code) => {
      if (pid !== paneId) return;
      exited = true;
      paneId = null;
      setExitCode(code);
      term.write(`\r\n\x1b[2m[프로세스 종료: code ${code}] — Enter로 재시작, x로 닫기\x1b[0m`);
    });

    // 입력
    term.onData((s) => {
      if (exited) {
        if (s === '\r') restart();
        else if (s === 'x') onCloseRef.current?.();
        return;
      }
      if (paneId !== null) void ptyWrite(paneId, encoder.encode(s)).catch(() => {});
    });
    term.onBinary((s) => {
      if (paneId !== null) {
        void ptyWrite(
          paneId,
          Uint8Array.from(s, (c) => c.charCodeAt(0)),
        ).catch(() => {});
      }
    });

    // 복사/붙여넣기
    const paste = async () => {
      const text = await navigator.clipboard.readText();
      if (text) term.paste(text);
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.code === 'KeyC') {
          if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        if (e.code === 'KeyV') {
          void paste();
          return false;
        }
      }
      return true;
    });
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      void paste();
    };
    host.addEventListener('contextmenu', onContext);
    term.onSelectionChange(() => {
      if (copyRef.current && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
      }
    });

    // 크기
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        fit.fit();
        if (paneId !== null) void ptyResize(paneId, term.cols, term.rows).catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(host);

    const unwatchTheme = watchTheme(() => {
      term.options.theme = readTerminalTheme();
    });

    void start();

    return () => {
      disposed = true;
      clearTimeout(activityTimer);
      clearTimeout(resizeTimer);
      ro.disconnect();
      unwatchTheme();
      host.removeEventListener('contextmenu', onContext);
      void unlistenExit.then((un) => un());
      if (paneId !== null) void ptyKill(paneId).catch(() => {});
      term.dispose();
    };
    // 프로필/cwd/command가 바뀌면 새 pane으로 취급한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, cwd, command]);

  return (
    <section className="pane">
      <header className="pane-head">
        <span className="pane-icon" aria-hidden>
          ❯_
        </span>
        <span className="pane-title">{title}</span>
        {cwd && <span className="pane-cwd">{cwd}</span>}
        <span
          className={`pane-dot${active ? ' on' : ''}${exitCode !== null ? ' dead' : ''}`}
          title={exitCode !== null ? '종료됨' : active ? '출력 중' : '대기'}
        />
        <span className="spacer" />
        <span className="pane-actions">
          {/* M1-02에서 분할 · 줌 버튼 연결 */}
          <button type="button" title="닫기" onClick={() => onClose?.()}>
            ✕
          </button>
        </span>
      </header>
      <div className="pane-body" ref={hostRef} />
    </section>
  );
}
