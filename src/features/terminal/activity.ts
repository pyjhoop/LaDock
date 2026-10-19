import { create } from 'zustand';

/**
 * pane 출력 흐름으로 추정한 상태. CLI가 공식으로 알려 주는 값이 아니라 추정이다.
 * working: 출력 중 · done: 출력이 멈췄는데 아직 안 본 pane · (없음): 대기
 */
export type PaneActivity = 'working' | 'done';

export const useActivity = create<{ byPane: Record<string, PaneActivity> }>()(() => ({
  byPane: {},
}));

/** 출력이 이 시간(ms) 끊기면 답변이 끝난 것으로 본다 */
const QUIET_MS = 2500;
/** 키 입력 직후 이 시간(ms)의 출력은 에코로 보고 무시한다 */
const ECHO_MS = 300;

const timers = new Map<string, number>();
const lastInput = new Map<string, number>();
const focusedKeys = new Set<string>();
/** pane → 마지막 Enter 시각. 이 뒤에 나오는 출력만 작업으로 본다 */
const armed = new Map<string, number>();
/** Enter 뒤 이 시간(ms) 안에 출력이 시작되지 않으면 무시한다 */
const ARM_MS = 15000;

/** 사용자가 이 pane을 보고 있는가: 포커스된 pane이고 앱 창도 앞에 있을 때 */
const seen = (key: string) => focusedKeys.has(key) && !document.hidden && document.hasFocus();

function set(key: string, value: PaneActivity | undefined) {
  const cur = useActivity.getState().byPane;
  if (cur[key] === value) return;
  const next = { ...cur };
  if (value) next[key] = value;
  else delete next[key];
  useActivity.setState({ byPane: next });
}

/** Enter를 보낸 pane만 '작업'으로 센다: 시작 배너 · 프롬프트 · 리사이즈 재그리기는 무시한다 */
export function noteInput(key: string, data: string) {
  const now = Date.now();
  // 터미널이 스스로 보내는 응답(포커스 · 커서 위치 보고 등 ESC 시퀀스)은 사용자 입력이 아니다
  if (data.startsWith(String.fromCharCode(27))) return;
  lastInput.set(key, now);
  if (data.includes('\r')) armed.set(key, now);
}

export function noteOutput(key: string) {
  const now = Date.now();
  if (now - (lastInput.get(key) ?? 0) < ECHO_MS) return;
  const since = armed.get(key);
  if (since === undefined) return;
  if (!timers.has(key) && now - since > ARM_MS) {
    armed.delete(key);
    return;
  }
  set(key, 'working');
  clearTimeout(timers.get(key));
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      armed.delete(key);
      set(key, seen(key) ? undefined : 'done');
    }, QUIET_MS),
  );
}

/** 포커스된 pane은 "안 본 완료"가 없다 */
export function noteFocus(key: string, focused: boolean) {
  if (focused) {
    focusedKeys.add(key);
    if (useActivity.getState().byPane[key] === 'done') set(key, undefined);
  } else focusedKeys.delete(key);
}

export function clearActivity(key: string) {
  clearTimeout(timers.get(key));
  timers.delete(key);
  lastInput.delete(key);
  armed.delete(key);
  focusedKeys.delete(key);
  set(key, undefined);
}

// 앱 창이 다시 앞으로 오면 지금 보이는 pane의 '완료'는 본 것으로 친다
window.addEventListener('focus', () => {
  for (const key of focusedKeys)
    if (useActivity.getState().byPane[key] === 'done') set(key, undefined);
});
