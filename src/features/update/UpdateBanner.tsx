import { useUpdate } from './updater';
import './update.css';

/** 새 버전이 있으면 화면 오른쪽 아래에 알린다. [지금 업데이트]를 누르면 받아서 설치하고 다시 시작한다. */
export function UpdateBanner() {
  const phase = useUpdate((s) => s.phase);
  const version = useUpdate((s) => s.version);
  const progress = useUpdate((s) => s.progress);
  const error = useUpdate((s) => s.error);
  const dismissed = useUpdate((s) => s.dismissed);
  const { install, dismiss } = useUpdate.getState();

  const installing = phase === 'installing';
  const failed = phase === 'error' && version !== null;
  if (!(phase === 'available' || installing || failed) || (dismissed && !installing)) return null;

  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong>새 버전 {version}</strong>
        <small>
          {installing
            ? `받는 중${progress === null ? '…' : ` ${progress}%`} — 끝나면 자동으로 다시 시작해요`
            : failed
              ? `업데이트 실패: ${error}`
              : '업데이트가 있어요. 설치하면 앱이 다시 시작돼요'}
        </small>
      </div>
      {!installing && (
        <div className="update-actions">
          <button type="button" className="set-btn primary" onClick={() => void install()}>
            {failed ? '다시 시도' : '지금 업데이트'}
          </button>
          <button type="button" className="set-btn" onClick={dismiss}>
            나중에
          </button>
        </div>
      )}
    </div>
  );
}
