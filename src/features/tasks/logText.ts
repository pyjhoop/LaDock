// 터미널 색상 · 커서 제어 시퀀스는 로그 보기에서 지운다
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분 ${sec % 60}초`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
