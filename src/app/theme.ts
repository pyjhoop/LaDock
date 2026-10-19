export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'ladock.theme';
const MODES: readonly ThemeMode[] = ['dark', 'light', 'system'];

export function parseTheme(value: string | null | undefined): ThemeMode {
  return MODES.find((m) => m === value) ?? 'dark';
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
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
