import { useEffect, type ReactNode } from 'react';
import { startAgentDetect } from '../terminal/detect';
import { loadSaved, startAutoSave, useRestore } from './persist';
import './persist.css';

/** 저장된 레이아웃을 불러오기 전에는 pane을 그리지 않는다 (기본 세션이 먼저 뜨는 것을 막는다). */
export function RestoreGate({ children }: { children: ReactNode }) {
  const phase = useRestore((s) => s.restore.phase);
  const notice = useRestore((s) => s.notice);
  const dismiss = useRestore((s) => s.dismissNotice);

  useEffect(() => void loadSaved(), []);
  useEffect(() => (phase === 'ready' ? startAutoSave() : undefined), [phase]);
  useEffect(() => (phase === 'ready' ? startAgentDetect() : undefined), [phase]);

  if (phase === 'loading') return null;
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
