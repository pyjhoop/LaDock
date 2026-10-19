import type { ReactElement } from 'react';
import { remoteClient } from '../features/remote/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nextTheme, type ThemeMode } from '../app/theme';
import { useSettings } from '../features/settings/settings';

import { IconAuto, IconMenu, IconMoon, IconSun } from './icons';
import { TitleTabs } from '../features/sessions/TitleTabs';
import { useSessionsUi } from '../features/sessions/ui';

const THEME_LABEL: Record<ThemeMode, string> = { dark: '다크', light: '라이트', system: '시스템' };
const THEME_ICON: Record<ThemeMode, () => ReactElement> = {
  dark: IconMoon,
  light: IconSun,
  system: IconAuto,
};

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1 } as const;

export function TitleBar() {
  const theme = useSettings((s) => s.settings.theme);
  const win = getCurrentWindow();
  const toggleSidebar = useSessionsUi((s) => s.toggleSidebar);

  const ThemeIcon = THEME_ICON[theme];
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
        <IconMenu />
      </button>
      <div className="brand" data-tauri-drag-region>
        <span className="label">LaDock</span>
      </div>
      <TitleTabs />
      <div className="spacer" data-tauri-drag-region />
      <button
        className="icon-btn"
        onClick={cycleTheme}
        title={`테마: ${THEME_LABEL[theme]}`}
        aria-label="테마 전환"
      >
        <ThemeIcon />
      </button>
      {!remoteClient && (
        <>
          <button className="win-btn" onClick={() => win.minimize()} aria-label="최소화">
            <svg viewBox="0 0 10 10" {...stroke}>
              <path d="M0 5h10" />
            </svg>
          </button>
          <button className="win-btn" onClick={() => win.toggleMaximize()} aria-label="최대화">
            <svg viewBox="0 0 10 10" {...stroke}>
              <rect x=".5" y=".5" width="9" height="9" />
            </svg>
          </button>
          <button className="win-btn close" onClick={() => win.close()} aria-label="닫기">
            <svg viewBox="0 0 10 10" {...stroke}>
              <path d="M0 0l10 10M10 0L0 10" />
            </svg>
          </button>
        </>
      )}
    </header>
  );
}
