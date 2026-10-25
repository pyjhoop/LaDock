import { IconFolderPlus } from '../../components/icons';
import { useKeys } from '../keys/keys';
import { remoteClient } from '../remote/client';
import { addProject, addQuickProject } from '../sessions/ui';

/** 프로젝트가 하나도 없을 때의 시작 화면 */
export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-box">
        <h2>프로젝트가 없습니다</h2>
        <p>폴더를 골라 프로젝트를 추가하거나, 기본 폴더에서 바로 시작하세요.</p>
        <div className="empty-actions">
          <button className="empty-btn primary" onClick={() => void addProject()}>
            <IconFolderPlus />
            프로젝트 추가
          </button>
          {!remoteClient && (
            <button
              className="empty-btn"
              onClick={() => useKeys.getState().openOverlay({ kind: 'taskEdit', id: null })}
            >
              + 작업 추가
            </button>
          )}
        </div>
        <button className="empty-link" onClick={addQuickProject}>
          기본 폴더에서 빠르게 시작
        </button>
      </div>
    </div>
  );
}
