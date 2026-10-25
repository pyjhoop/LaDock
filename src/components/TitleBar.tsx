import { remoteClient } from '../features/remote/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { nextTheme, themeInfo } from '../app/theme';
import { useSettings } from '../features/settings/settings';

import { IconAuto, IconMenu, IconMoon, IconPanelR, IconSun } from './icons';
import { useFiles } from '../features/files/files';
import { TitleTabs } from '../features/sessions/TitleTabs';
import { useSessionsUi } from '../features/sessions/ui';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1 } as const;

export function TitleBar() {
  const theme = useSettings((s) => s.settings.theme);
  const win = getCurrentWindow();
  const toggleSidebar = useSessionsUi((s) => s.toggleSidebar);

  const filesOpen = useFiles((s) => s.panelOpen);
  const wide = useSessionsUi((s) => s.mode === 'wide');

  const info = themeInfo(theme);
  const ThemeIcon = theme === 'system' ? IconAuto : info.dark ? IconMoon : IconSun;
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
      {wide && !remoteClient && (
        <button
          className={`icon-btn${filesOpen ? ' on' : ''}`}
          onClick={() => useFiles.getState().setPanelOpen(!filesOpen)}
          title="파일 패널 접기/펼치기 (프로젝트 폴더 구조)"
          aria-label="파일 패널"
        >
          <IconPanelR />
        </button>
      )}
      <button
        className="icon-btn"
        onClick={cycleTheme}
        title={`테마: ${info.label} (클릭하면 다음 테마)`}
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
