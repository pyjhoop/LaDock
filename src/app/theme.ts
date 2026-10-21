/** 'system'은 OS 설정을 따르고, 나머지는 theme.css의 [data-theme] 팔레트 이름이다. */
export type ThemeMode =
  'system' | 'dark' | 'light' | 'nord' | 'nord-light' | 'sepia' | 'mocha' | 'gruvbox';

export interface ThemeInfo {
  id: ThemeMode;
  label: string;
  /** 바탕이 어두운 테마인지 (타이틀바 아이콘용) */
  dark: boolean;
}

/** 설정 화면 · 순환 순서. 팔레트는 theme.css에 있다. */
export const THEMES: readonly ThemeInfo[] = [
  { id: 'system', label: '시스템', dark: true },
  { id: 'dark', label: '다크', dark: true },
  { id: 'nord', label: 'Nord', dark: true },
  { id: 'mocha', label: 'Mocha', dark: true },
  { id: 'gruvbox', label: 'Gruvbox', dark: true },
  { id: 'light', label: '라이트', dark: false },
  { id: 'nord-light', label: 'Nord 라이트', dark: false },
  { id: 'sepia', label: '세피아', dark: false },
];

const STORAGE_KEY = 'ladock.theme';

export function parseTheme(value: string | null | undefined): ThemeMode {
  return THEMES.find((t) => t.id === value)?.id ?? 'dark';
}

export function themeInfo(mode: ThemeMode): ThemeInfo {
  return THEMES.find((t) => t.id === mode) ?? THEMES[1];
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  const i = THEMES.findIndex((t) => t.id === mode);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function loadTheme(): ThemeMode {
  return parseTheme(localStorage.getItem(STORAGE_KEY));
}

/** system이면 data-theme을 지워 prefers-color-scheme을 따른다. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  localStorage.setItem(STORAGE_KEY, mode);
}
