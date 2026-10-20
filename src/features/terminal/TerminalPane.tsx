import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { IconClose, IconSplitD, IconSplitR, IconUnzoom, IconZoom } from '../../components/icons';
import { clearActivity, noteFocus, noteInput, noteOutput } from './activity';
import { onPtyExit, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite, type SpawnArgs } from './pty';
import { remoteClient } from '../remote/client';
import { clearPaneCwd, parseOsc7, registerPty, setPaneCwd, unregisterPty } from './registry';
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
  /** command를 셸 안에서 실행해, command가 끝나도 셸(pane)은 남긴다 */
  keepShell?: boolean;
  /** 헤더 아이콘 (agent pane의 provider 글리프 · 색). 없으면 셸 아이콘. */
  icon?: { glyph: string; color: string };
  /** 선택하면 자동 복사. 기본 끔 */
  copyOnSelect?: boolean;
  fontFamily?: string;
  fontSize?: number;
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

/** 설정한 폰트를 앞에 두고, 없을 때를 위해 앱 기본 모노 폰트를 뒤에 붙인다. */
function termFontFamily(name?: string): string {
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono');
  return name ? `"${name.replace(/"/g, '')}", ${mono}` : mono;
}

export function TerminalPane({
  paneKey,
  profileId,
  title,
  cwd,
  command,
  args,
  envRemove,
  keepShell,
  icon,
  copyOnSelect = false,
  fontFamily,
  fontSize = 13,
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // 셸이 알려 준 현재 폴더. 초기 cwd가 바뀌면(=새 pane) 다시 그 값으로 시작한다.
  const [live, setLive] = useState({ base: cwd, dir: cwd });
  if (live.base !== cwd) setLive({ base: cwd, dir: cwd });
  const liveCwd = live.dir;
  const setLiveCwd = (dir: string) => setLive((s) => ({ ...s, dir }));
  const pasteRef = useRef<() => void>(() => {});
  const onCloseRef = useRef(onClose);
  const copyRef = useRef(copyOnSelect);
  const onRendererRef = useRef(onRenderer);
  const fontRef = useRef({ fontFamily, fontSize });
  useEffect(() => {
    fontRef.current = { fontFamily, fontSize };
    onRendererRef.current = onRenderer;
    onCloseRef.current = onClose;
    copyRef.current = copyOnSelect;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: termFontFamily(fontRef.current.fontFamily),
      fontSize: fontRef.current.fontSize,
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
      keepShell,
      cols: term.cols,
      rows: term.rows,
    });

    // 폰: PTY를 새로 만들지 않고 PC가 이미 띄운 PTY에 붙는다. 크기는 PC가 정한다.
    let detach: (() => void) | undefined;
    const fitRemoteFont = () => {
      // PC가 정한 cols×rows가 호스트에 통째로 들어오도록 폭·높이 중 빡빡한 쪽에 글자 크기를 맞춘다.
      const screen = host.querySelector('.xterm-screen');
      const w = host.clientWidth - 4;
      const h = host.clientHeight - 4;
      if (!screen || w <= 0 || h <= 0) return;
      const cur = term.options.fontSize ?? 12;
      const sw = (screen as HTMLElement).offsetWidth;
      const sh = (screen as HTMLElement).offsetHeight;
      if (sw <= 0 || sh <= 0) return;
      const next = Math.max(4, Math.min(28, cur * Math.min(w / sw, h / sh)));
      if (Math.abs(next - cur) >= 0.25) term.options.fontSize = Math.round(next * 4) / 4;
    };
    const startRemote = async () => {
      if (!remoteClient || !paneKey) return;
      const id = await remoteClient.waitPty(paneKey);
      if (disposed) return;
      paneId = id;
      detach = remoteClient.attach(id, {
        onData: (data) => {
          markActive();
          noteOutput(paneKey);
          term.write(data);
        },
        onSize: (cols, rows) => {
          term.resize(cols, rows);
          requestAnimationFrame(fitRemoteFont);
        },
      });
    };

    const start = async () => {
      if (remoteClient) return startRemote();
      exited = false;
      setExitCode(null);
      let id: number | null = null;
      const pending: Uint8Array[] = [];
      const write = (pid: number, data: Uint8Array) => {
        markActive();
        if (paneKey) noteOutput(paneKey);
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

    // 셸이 OSC 7로 알려 주는 현재 폴더 — AI 실행 때 cwd를 물려주는 데 쓴다
    const osc7 = term.parser.registerOscHandler(7, (data) => {
      const dir = parseOsc7(data);
      if (dir) {
        if (paneKey) setPaneCwd(paneKey, dir);
        setLiveCwd(dir);
      }
      return true;
    });

    // 입력
    term.onData((s) => {
      if (exited) {
        if (s === '\r') restart();
        else if (s === 'x') onCloseRef.current?.();
        return;
      }
      if (paneKey) noteInput(paneKey, s);
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
      // Ctrl+V: 셸/AI CLI에 ^V를 보내지 않고 직접 붙여넣는다 (브라우저 기본 붙여넣기와 겹치지 않게 막는다)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        if (e.type === 'keydown') void paste();
        return false;
      }
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
    pasteRef.current = () => void paste();
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    host.addEventListener('contextmenu', onContext);
    term.onSelectionChange(() => {
      if (copyRef.current && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
      }
    });

    // 크기. 분할선 드래그 중에는 PTY 리사이즈를 미루고, 끝나면 REFIT_EVENT로 한 번 맞춘다.
    const refit = () => {
      if (remoteClient) return fitRemoteFont();
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
      osc7.dispose();
      if (paneKey) clearPaneCwd(paneKey);
      host.removeEventListener('contextmenu', onContext);
      void unlistenExit.then((un) => un());
      detach?.();
      if (paneId !== null) {
        if (paneKey) unregisterPty(paneKey, paneId);
        void ptyKill(paneId).catch(() => {});
      }
      term.dispose();
    };
    // 프로필/cwd/command가 바뀌면 새 pane으로 취급한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, cwd, command]);

  // 설정에서 폰트가 바뀌면 재시작 없이 바로 반영하고 크기를 다시 맞춘다
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = termFontFamily(fontFamily);
    term.options.fontSize = fontSize;
    window.dispatchEvent(new Event(REFIT_EVENT));
  }, [fontFamily, fontSize]);

  useEffect(() => {
    if (focused) termRef.current?.focus();
    if (paneKey) noteFocus(paneKey, focused);
  }, [focused, paneKey]);

  useEffect(() => () => (paneKey ? clearActivity(paneKey) : undefined), [paneKey]);

  // 우클릭 메뉴는 바깥 클릭 · Esc · 스크롤로 닫는다
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <section className={`pane${focused ? ' focused' : ''}`} onMouseDownCapture={() => onFocus?.()}>
      <header className="pane-head">
        <span className="pane-icon" aria-hidden style={icon && { color: icon.color }}>
          {icon?.glyph ?? '❯_'}
        </span>
        <span className="pane-title">{title}</span>
        <span className="pane-cwd">{liveCwd}</span>
        <span className={`activity${active ? ' busy' : ''}${exitCode !== null ? ' dead' : ''}`}>
          <span>{exitCode !== null ? '종료됨' : active ? '출력 중' : '대기'}</span>
        </span>
        <span className="pane-actions">
          <button
            type="button"
            className="opt"
            title="좌우 분할"
            aria-label="좌우 분할"
            onClick={() => onSplit?.('row')}
          >
            <IconSplitR />
          </button>
          <button
            type="button"
            className="opt"
            title="상하 분할"
            aria-label="상하 분할"
            onClick={() => onSplit?.('col')}
          >
            <IconSplitD />
          </button>
          <button
            type="button"
            className="opt"
            title={zoomed ? '줌 해제' : '줌'}
            aria-label="줌"
            onClick={() => onToggleZoom?.()}
          >
            {zoomed ? <IconUnzoom /> : <IconZoom />}
          </button>
          <button
            type="button"
            className="danger"
            title="닫기"
            aria-label="pane 닫기"
            onClick={() => onClose?.()}
          >
            <IconClose />
          </button>
        </span>
      </header>
      <div className="pane-body" ref={hostRef} />
      {menu && (
        <div
          className="pane-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              onSplit?.('row');
            }}
          >
            우측 분할
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              onSplit?.('col');
            }}
          >
            하단 분할
          </button>
          <hr />
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              pasteRef.current();
            }}
          >
            붙여넣기
          </button>
        </div>
      )}
    </section>
  );
}
