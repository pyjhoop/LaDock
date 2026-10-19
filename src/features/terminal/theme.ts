import type { ITheme } from '@xterm/xterm';

/** 앱 테마 토큰(CSS 변수)에서 xterm 색을 만든다. */
export function readTerminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = css.colorScheme.includes('dark');
  return {
    background: v('--term-bg'),
    foreground: v('--term-fg'),
    cursor: v('--accent'),
    cursorAccent: v('--term-bg'),
    selectionBackground: dark ? 'rgba(60, 207, 189, 0.28)' : 'rgba(12, 143, 131, 0.22)',
    brightBlack: v('--t-dim'),
    green: v('--t-green'),
    brightGreen: v('--t-green'),
    blue: v('--t-blue'),
    brightBlue: v('--t-blue'),
    yellow: v('--t-yellow'),
    brightYellow: v('--t-yellow'),
    red: v('--t-red'),
    brightRed: v('--t-red'),
    magenta: v('--t-magenta'),
    brightMagenta: v('--t-magenta'),
  };
}

/** data-theme 변경이나 시스템 테마 변경을 감지한다. */
export function watchTheme(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener('change', cb);
  };
}
