import { getCurrentWindow } from '@tauri-apps/api/window';
import { nextTheme, type ThemeMode } from '../app/theme';
import { useKeys } from '../features/keys/keys';
import { useSettings } from '../features/settings/settings';

import { TitleTabs } from '../features/sessions/TitleTabs';
import { useSessionsUi } from '../features/sessions/ui';

const THEME_LABEL: Record<ThemeMode, string> = { dark: '다크', light: '라이트', system: '시스템' };

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const;

export function TitleBar() {
  const theme = useSettings((s) => s.settings.theme);
  const win = getCurrentWindow();
  const toggleSidebar = useSessionsUi((s) => s.toggleSidebar);

  const cycleTheme = () => {
    useSettings.getState().update({ theme: nextTheme(theme) });
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button
        className="icon-btn menu-btn"
        onClick={toggleSidebar}
        title="사이드바 접기/펼치기"
        aria-label="사이드바"
      >
        ☰
      </button>
      <div className="brand" data-tauri-drag-region>
        <span className="mark" />
        <span className="label">LaDock</span>
      </div>
      <TitleTabs />
      <div className="spacer" data-tauri-drag-region />
      <button className="theme-btn" onClick={cycleTheme} title="테마 전환">
        테마: {THEME_LABEL[theme]}
      </button>
      <button
        className="icon-btn"
        onClick={() => useKeys.getState().openOverlay({ kind: 'settings' })}
        title="설정"
        aria-label="설정"
      >
        ⚙
      </button>
      <button className="win-btn" onClick={() => win.minimize()} aria-label="최소화">
        <svg viewBox="0 0 14 14" {...stroke}>
          <path d="M3 7h8" />
        </svg>
      </button>
      <button className="win-btn" onClick={() => win.toggleMaximize()} aria-label="최대화">
        <svg viewBox="0 0 14 14" {...stroke}>
          <rect x="3" y="3" width="8" height="8" />
        </svg>
      </button>
      <button className="win-btn close" onClick={() => win.close()} aria-label="닫기">
        <svg viewBox="0 0 14 14" {...stroke}>
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </header>
  );
}
