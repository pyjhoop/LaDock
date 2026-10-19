import type { Direction } from '../../store/tree';

/** prefix 다음 키로 실행되는 명령 */
export type Command =
  | { id: 'tree' }
  | { id: 'newSession' }
  | { id: 'renameSession' }
  | { id: 'stepSession'; delta: 1 | -1 }
  | { id: 'closeSession' }
  | { id: 'newWindow' }
  | { id: 'renameWindow' }
  | { id: 'stepWindow'; delta: 1 | -1 }
  | { id: 'selectWindow'; n: number }
  | { id: 'closeWindow' }
  | { id: 'split'; dir: 'row' | 'col' }
  | { id: 'moveFocus'; dir: Direction }
  | { id: 'resize'; dir: Direction }
  | { id: 'zoom' }
  | { id: 'closePane' }
  | { id: 'palette' }
  | { id: 'settings' }
  | { id: 'help' }
  | { id: 'sendPrefix' };

export interface PrefixSpec {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** 결정 D2: 기본 prefix는 Ctrl+B. 바꾸는 곳은 설정(M3-02). */
export const DEFAULT_PREFIX: PrefixSpec = { code: 'KeyB', ctrl: true, alt: false, shift: false };

export const PREFIX_TIMEOUT_MS = 2000;

/** resolve에 필요한 KeyboardEvent 부분 */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export const isModifierOnly = (e: Pick<KeyLike, 'key'>) => MODIFIER_KEYS.has(e.key);

export const matchesPrefix = (e: KeyLike, spec: PrefixSpec) =>
  e.code === spec.code &&
  e.ctrlKey === spec.ctrl &&
  e.altKey === spec.alt &&
  e.shiftKey === spec.shift &&
  !e.metaKey;

const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Shift+숫자 기호 키: 한글 입력 상태에서는 e.key가 달라질 수 있어 e.code로도 맞춘다 (US 배열 기준) */
const SHIFTED: Record<string, { key: string; code: string; command: Command }> = {
  dollar: { key: '$', code: 'Digit4', command: { id: 'renameSession' } },
  lparen: { key: '(', code: 'Digit9', command: { id: 'stepSession', delta: -1 } },
  rparen: { key: ')', code: 'Digit0', command: { id: 'stepSession', delta: 1 } },
  amp: { key: '&', code: 'Digit7', command: { id: 'closeWindow' } },
  percent: { key: '%', code: 'Digit5', command: { id: 'split', dir: 'row' } },
  quote: { key: '"', code: 'Quote', command: { id: 'split', dir: 'col' } },
  question: { key: '?', code: 'Slash', command: { id: 'help' } },
};

/**
 * prefix 다음에 눌린 키를 명령으로 바꾼다. 알 수 없는 키는 null.
 * 문자 키는 e.code 기준이라 한글 입력 상태에서도 동작한다. 대소문자는 Shift로 구분한다.
 */
export function resolveKey(e: KeyLike, prefix: PrefixSpec = DEFAULT_PREFIX): Command | null {
  if (e.metaKey) return null;
  if (matchesPrefix(e, prefix)) return { id: 'sendPrefix' };

  const arrow = ARROWS[e.code];
  if (arrow) {
    if (e.altKey || e.shiftKey) return null;
    return e.ctrlKey ? { id: 'resize', dir: arrow } : { id: 'moveFocus', dir: arrow };
  }
  if (e.ctrlKey || e.altKey) return null;

  if (e.shiftKey) {
    for (const s of Object.values(SHIFTED)) {
      if (e.key === s.key || e.code === s.code) return s.command;
    }
    if (e.code === 'KeyC') return { id: 'newSession' };
    if (e.code === 'KeyX') return { id: 'closeSession' };
    return null;
  }

  switch (e.code) {
    case 'KeyS':
    case 'KeyW':
      return { id: 'tree' };
    case 'KeyC':
      return { id: 'newWindow' };
    case 'Comma':
      return { id: 'renameWindow' };
    case 'KeyN':
      return { id: 'stepWindow', delta: 1 };
    case 'KeyP':
      return { id: 'stepWindow', delta: -1 };
    case 'KeyZ':
      return { id: 'zoom' };
    case 'KeyX':
      return { id: 'closePane' };
    case 'KeyA':
      return { id: 'palette' };
    case 'Period':
      return { id: 'settings' };
  }
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) {
    const n = Number(digit[1]);
    return { id: 'selectWindow', n: n === 0 ? 10 : n };
  }
  return null;
}

/** prefix가 Ctrl+<글자>일 때 터미널에 그대로 보낼 제어 문자. 그 외 조합이면 null. */
export function prefixControlChar(spec: PrefixSpec): string | null {
  const m = /^Key([A-Z])$/.exec(spec.code);
  if (!spec.ctrl || spec.alt || !m) return null;
  return String.fromCharCode(m[1].charCodeAt(0) - 64);
}

export const prefixLabel = (spec: PrefixSpec) =>
  [spec.ctrl && 'Ctrl', spec.alt && 'Alt', spec.shift && 'Shift', spec.code.replace(/^Key/, '')]
    .filter(Boolean)
    .join('+');

export interface HelpRow {
  keys: string;
  desc: string;
  extension?: boolean;
}

export const HELP_ROWS: HelpRow[] = [
  { keys: 's / w', desc: '세션 · 탭 트리 열기' },
  { keys: 'C', desc: '새 세션', extension: true },
  { keys: '$', desc: '세션 이름 변경' },
  { keys: '( / )', desc: '이전 / 다음 세션' },
  { keys: 'X', desc: '세션 닫기', extension: true },
  { keys: 'c', desc: '새 탭' },
  { keys: ',', desc: '탭 이름 변경' },
  { keys: 'n / p', desc: '다음 / 이전 탭' },
  { keys: '0–9', desc: 'N번 탭 (0 = 10번)' },
  { keys: '&', desc: '탭 닫기' },
  { keys: '%', desc: '좌우 분할' },
  { keys: '"', desc: '상하 분할' },
  { keys: '← ↑ → ↓', desc: 'pane 포커스 이동' },
  { keys: 'Ctrl+← ↑ → ↓', desc: 'pane 크기 조절' },
  { keys: 'z', desc: 'pane 줌 토글' },
  { keys: 'x', desc: 'pane 닫기' },
  { keys: 'a', desc: 'AI 실행 팔레트', extension: true },
  { keys: '.', desc: '설정', extension: true },
  { keys: '?', desc: '단축키 도움말' },
  { keys: 'prefix 한 번 더', desc: '터미널에 prefix 키 그대로 전달' },
];
