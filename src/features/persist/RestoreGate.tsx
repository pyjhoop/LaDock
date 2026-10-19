import { useEffect, type ReactNode } from 'react';
import '../keys/keys.css';
import { chooseResume, loadSaved, startAutoSave, useRestore } from './persist';
import './persist.css';

/** 저장된 레이아웃을 불러오기 전에는 pane을 그리지 않는다 (기본 세션이 먼저 뜨는 것을 막는다). */
export function RestoreGate({ children }: { children: ReactNode }) {
  const restore = useRestore((s) => s.restore);
  const notice = useRestore((s) => s.notice);
  const dismiss = useRestore((s) => s.dismissNotice);
  const phase = restore.phase;

  useEffect(() => void loadSaved(), []);
  useEffect(() => (phase === 'ready' ? startAutoSave() : undefined), [phase]);

  useEffect(() => {
    if (phase !== 'ask') return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.key === 'Enter' || e.key.toLowerCase() === 'y') chooseResume(true);
      else if (e.key === 'Escape' || e.key.toLowerCase() === 'n') chooseResume(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase]);

  if (phase === 'loading') return null;
  if (restore.phase === 'ask') {
    return (
      <div className="overlay">
        <div className="overlay-box small">
          <h2>이전 대화 이어서 열까요?</h2>
          <p className="muted">AI pane {restore.agents}개가 저장되어 있습니다.</p>
          <div className="restore-actions">
            <button type="button" className="primary" onClick={() => chooseResume(true)}>
              <kbd>Enter</kbd> 이어서 열기
            </button>
            <button type="button" onClick={() => chooseResume(false)}>
              <kbd>N</kbd> 새로 시작
            </button>
          </div>
          <p className="muted">
            Claude Code · Antigravity는 직전 대화를 잇고, Codex는 새로 시작합니다.
          </p>
        </div>
      </div>
    );
  }
  return (
    <>
      {children}
      {notice && (
        <div className="restore-notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={dismiss} aria-label="닫기">
            ×
          </button>
        </div>
      )}
    </>
  );
}
