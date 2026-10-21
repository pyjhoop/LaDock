import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { parseTheme, type ThemeMode } from '../../app/theme';
import type { ProviderId } from '../../store/types';
import { DEFAULT_PREFIX, type PrefixSpec } from '../keys/keymap';

export interface Settings {
  /** 새 셸 pane의 기본 프로필 id (shells_detect 목록) */
  defaultShell: string;
  fontFamily: string;
  fontSize: number;
  theme: ThemeMode;
  prefix: PrefixSpec;
  copyOnSelect: boolean;
  /** 구독으로만 실행 — API 키 환경변수를 AI 자식 프로세스에서 지운다 */
  subscriptionOnly: boolean;
  /** 권한 확인 없이 실행 플래그를 붙인다 */
  skipPermissions: boolean;
  /** 다른 에이전트가 pane 순번으로 화면을 읽을 수 있게 파일로 내놓는다 */
  sharePanes: boolean;
  /** provider별 추가 인자 (공백 구분, "..." 로 묶기) */
  providerArgs: Record<ProviderId, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultShell: 'pwsh',
  fontFamily: 'Cascadia Code',
  fontSize: 13,
  theme: 'dark',
  prefix: DEFAULT_PREFIX,
  copyOnSelect: false,
  subscriptionOnly: true,
  skipPermissions: true,
  sharePanes: true,
  providerArgs: { claude: '', codex: '', antigravity: '' },
};

export const FONT_SIZE_RANGE = { min: 8, max: 32 } as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

function parsePrefix(v: unknown): PrefixSpec {
  if (!isObj(v) || typeof v.code !== 'string' || !/^(Key[A-Z]|Digit\d|F\d{1,2})$/.test(v.code))
    return DEFAULT_PREFIX;
  const spec = {
    code: v.code,
    ctrl: bool(v.ctrl, false),
    alt: bool(v.alt, false),
    shift: bool(v.shift, false),
  };
  // 수식키 없는 prefix는 일반 입력을 전부 가로채므로 받지 않는다
  return spec.ctrl || spec.alt ? spec : DEFAULT_PREFIX;
}

/** 알 수 없는 키는 무시하고, 없거나 잘못된 값은 기본값으로 채운다. 깨진 JSON이면 전부 기본값. */
export function parseSettings(text: string | null): Settings {
  let raw: unknown;
  try {
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  const o = isObj(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const args = isObj(o.providerArgs) ? o.providerArgs : {};
  const size =
    typeof o.fontSize === 'number' && Number.isFinite(o.fontSize) ? o.fontSize : d.fontSize;
  return {
    defaultShell: str(o.defaultShell, d.defaultShell),
    fontFamily: str(o.fontFamily, d.fontFamily),
    fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, Math.round(size))),
    theme: parseTheme(typeof o.theme === 'string' ? o.theme : null),
    prefix: parsePrefix(o.prefix),
    copyOnSelect: bool(o.copyOnSelect, d.copyOnSelect),
    subscriptionOnly: bool(o.subscriptionOnly, d.subscriptionOnly),
    skipPermissions: bool(o.skipPermissions, d.skipPermissions),
    sharePanes: bool(o.sharePanes, d.sharePanes),
    providerArgs: {
      claude: typeof args.claude === 'string' ? args.claude : '',
      codex: typeof args.codex === 'string' ? args.codex : '',
      antigravity: typeof args.antigravity === 'string' ? args.antigravity : '',
    },
  };
}

/** `--model "opus 4" -c` → ['--model', 'opus 4', '-c'] */
export function splitArgs(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]).filter((a) => a !== '');
}

/** 셸·터미널이 이미 쓰는 Ctrl 조합. prefix로 쓰면 그 기능을 못 쓰게 된다. */
const SHELL_CTRL: Record<string, string> = {
  KeyA: '줄 맨 앞으로',
  KeyC: '실행 중단',
  KeyD: '입력 끝 / 종료',
  KeyE: '줄 맨 끝으로',
  KeyK: '줄 끝까지 지우기',
  KeyL: '화면 지우기',
  KeyR: '기록 검색',
  KeyU: '줄 지우기',
  KeyW: '단어 지우기',
  KeyZ: '작업 중지',
};

/** 충돌 경고 문구. 문제 없으면 null. */
export function prefixWarning(p: PrefixSpec): string | null {
  if (!p.ctrl && !p.alt) return '수식키(Ctrl 또는 Alt)가 필요합니다';
  const use = p.ctrl && !p.alt && !p.shift ? SHELL_CTRL[p.code] : undefined;
  return use ? `셸에서 쓰는 키입니다 (${use}) — prefix로 쓰면 그 기능이 가려져요` : null;
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    scheduleSave();
  },
}));

let timer: ReturnType<typeof setTimeout> | undefined;

async function save() {
  try {
    await invoke('settings_save', {
      json: JSON.stringify(useSettings.getState().settings, null, 2),
    });
  } catch (e) {
    console.error('settings_save 실패', e);
  }
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => void save(), 400);
}

/** 시작할 때 한 번. 읽기에 실패해도 기본값으로 계속한다. */
export async function loadSettings(): Promise<void> {
  let text: string | null = null;
  try {
    text = await invoke<string | null>('settings_load');
  } catch (e) {
    console.error('settings_load 실패', e);
  }
  const settings = parseSettings(text);
  useSettings.setState({ settings, loaded: true });
}
