import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { onPtyExit, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite, type SpawnArgs } from './pty';
import { registerPty, unregisterPty } from './registry';
import { readTerminalTheme, watchTheme } from './theme';
import './terminal.css';

export interface TerminalPaneProps {
  /** store의 pane id. 주면 store에서 pane이 사라질 때 PTY를 종료할 수 있다. */
  paneKey?: string;
  profileId: string;
  title: string;
  cwd?: string;
  command?: string;
  args?: string[];
  envRemove?: string[];
  /** 선택하면 자동 복사. 기본 끔 (M3-02 설정 연결 전까지 prop). */
  copyOnSelect?: boolean;
  onClose?: () => void;
  /** 포커스된 pane인가 (테두리 강조 + 키 입력 포커스) */
  focused?: boolean;
  zoomed?: boolean;
  onFocus?: () => void;
  onSplit?: (dir: 'row' | 'col') => void;
  onToggleZoom?: () => void;
  /** 렌더러가 정해지거나 바뀔 때 알린다 (M0-04 검증용). */
  onRenderer?: (renderer: 'webgl' | 'dom') => void;
}

/** 분할선 드래그가 끝났을 때 모든 pane이 크기를 다시 맞추게 하는 이벤트 */
export const REFIT_EVENT = 'ladock:refit';
const ACTIVITY_MS = 1000;
const RESIZE_DEBOUNCE_MS = 80;
const encoder = new TextEncoder();

export function TerminalPane({
  paneKey,
  profileId,
  title,
  cwd,
  command,
  args,
  envRemove,
  copyOnSelect = false,
  onClose,
  focused = false,
  zoomed = false,
  onFocus,
  onSplit,
  onToggleZoom,
  onRenderer,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [active, setActive] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const onCloseRef = useRef(onClose);
  const copyRef = useRef(copyOnSelect);
  const onRendererRef = useRef(onRenderer);
  useEffect(() => {
    onRendererRef.current = onRenderer;
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
    termRef.current = term;
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => {
        gl.dispose();
        onRendererRef.current?.('dom');
      });
      term.loadAddon(gl);
      onRendererRef.current?.('webgl');
    } catch {
      // WebGL 불가 → 기본 DOM 렌더러
      onRendererRef.current?.('dom');
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
      if (paneKey) registerPty(paneKey, id);
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
      if (paneKey) unregisterPty(paneKey, pid);
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

    // 크기. 분할선 드래그 중에는 PTY 리사이즈를 미루고, 끝나면 REFIT_EVENT로 한 번 맞춘다.
    const refit = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      if (paneId !== null) void ptyResize(paneId, term.cols, term.rows).catch(() => {});
    };
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (document.body.dataset.dragging) return;
        refit();
      }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(host);
    window.addEventListener(REFIT_EVENT, refit);

    const unwatchTheme = watchTheme(() => {
      term.options.theme = readTerminalTheme();
    });

    void start();

    return () => {
      disposed = true;
      clearTimeout(activityTimer);
      clearTimeout(resizeTimer);
      ro.disconnect();
      window.removeEventListener(REFIT_EVENT, refit);
      termRef.current = null;
      unwatchTheme();
      host.removeEventListener('contextmenu', onContext);
      void unlistenExit.then((un) => un());
      if (paneId !== null) {
        if (paneKey) unregisterPty(paneKey, paneId);
        void ptyKill(paneId).catch(() => {});
      }
      term.dispose();
    };
    // 프로필/cwd/command가 바뀌면 새 pane으로 취급한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, cwd, command]);

  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  return (
    <section className={`pane${focused ? ' focused' : ''}`} onMouseDownCapture={() => onFocus?.()}>
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
          <button type="button" title="좌우 분할" onClick={() => onSplit?.('row')}>
            ▥
          </button>
          <button type="button" title="상하 분할" onClick={() => onSplit?.('col')}>
            ▤
          </button>
          <button type="button" title={zoomed ? '줌 해제' : '줌'} onClick={() => onToggleZoom?.()}>
            {zoomed ? '⤡' : '⤢'}
          </button>
          <button type="button" title="닫기" onClick={() => onClose?.()}>
            ✕
          </button>
        </span>
      </header>
      <div className="pane-body" ref={hostRef} />
    </section>
  );
}
