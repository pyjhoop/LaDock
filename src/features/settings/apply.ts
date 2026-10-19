import { applyTheme } from '../../app/theme';
import { defaults } from '../../store/ops';
import { useKeys } from '../keys/keys';
import { useSettings, type Settings } from './settings';

/** 재시작 없이 바로 적용되는 항목(테마 · 기본 셸 · prefix)을 앱 상태에 반영한다. 폰트 · 복사는 pane이 직접 구독한다. */
function apply(s: Settings, prev?: Settings) {
  if (s.theme !== prev?.theme) applyTheme(s.theme);
  if (s.defaultShell !== prev?.defaultShell) defaults.profile = s.defaultShell;
  if (s.prefix !== prev?.prefix) useKeys.getState().setPrefix(s.prefix);
}

export function startSettingsApply(): () => void {
  apply(useSettings.getState().settings);
  return useSettings.subscribe((state, prev) => apply(state.settings, prev.settings));
}
