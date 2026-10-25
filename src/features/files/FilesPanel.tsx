import { IconBranch, IconChevR, IconFile, IconFolder, IconRefresh } from '../../components/icons';
import { useRef } from 'react';
import type { GitStatus } from './files';
import { openCommit } from './files';
import { joinRel, useFiles } from './files';
import './files.css';

function Node({
  dir,
  name,
  isDir,
  depth,
}: {
  dir: string;
  name: string;
  isDir: boolean;
  depth: number;
}) {
  const rel = joinRel(dir, name);
  const open = useFiles((s) => !!s.expanded[rel]);
  const children = useFiles((s) => s.dirs[rel]);
  const selected = useFiles((s) => s.file?.rel === rel);
  const { toggleDir, openFile } = useFiles.getState();
  return (
    <>
      <button
        className={`fnode${selected ? ' sel' : ''}${name.startsWith('.') ? ' dim' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDir ? toggleDir(rel) : openFile(rel))}
        title={rel}
      >
        <span className={`fchev${isDir ? '' : ' none'}${open ? ' open' : ''}`}>
          <IconChevR />
        </span>
        <span className="fico">{isDir ? <IconFolder /> : <IconFile />}</span>
        <span className="fname">{name}</span>
      </button>
      {isDir &&
        open &&
        children?.map((c) => (
          <Node key={c.name} dir={rel} name={c.name} isDir={c.isDir} depth={depth + 1} />
        ))}
      {isDir && open && children?.length === 0 && (
        <div className="fempty" style={{ paddingLeft: 30 + depth * 14 }}>
          비어 있음
        </div>
      )}
    </>
  );
}

/** 푸시/풀 필요 여부 한 줄 요약 */
function syncLabel(st: GitStatus): { text: string; tone: 'ok' | 'warn' | 'info' } {
  if (!st.upstream) return { text: '업스트림 없음 (푸시한 적 없는 브랜치)', tone: 'info' };
  if (st.ahead > 0 && st.behind > 0)
    return { text: `갈라짐 · 푸시 ${st.ahead} · 풀 ${st.behind}`, tone: 'warn' };
  if (st.ahead > 0) return { text: `푸시 필요 · ${st.ahead}개 커밋`, tone: 'warn' };
  if (st.behind > 0) return { text: `풀 필요 · ${st.behind}개 커밋`, tone: 'warn' };
  return { text: '원격과 같음', tone: 'ok' };
}

function GitSummary() {
  const status = useFiles((s) => s.status);
  const error = useFiles((s) => s.statusError);
  const fetching = useFiles((s) => s.fetching);
  const fetchError = useFiles((s) => s.fetchError);
  const fetchRemote = useFiles((s) => s.fetchRemote);
  if (error) return <div className="gsum err">{error}</div>;
  if (!status) return null;
  const sync = syncLabel(status);
  const changes = [
    status.conflicted > 0 && `충돌 ${status.conflicted}`,
    status.staged > 0 && `스테이지 ${status.staged}`,
    status.modified > 0 && `수정 ${status.modified}`,
    status.untracked > 0 && `새 파일 ${status.untracked}`,
  ].filter(Boolean);
  return (
    <div className="gsum">
      <div className="gsync">
        <span className={`gtag ${sync.tone}`} title={status.upstream ?? undefined}>
          {status.ahead > 0 && <b>↑{status.ahead}</b>}
          {status.behind > 0 && <b>↓{status.behind}</b>}
          {sync.text}
        </span>
        <button
          className="gfetch"
          onClick={fetchRemote}
          disabled={fetching}
          title="원격에서 최신 상태를 가져와 풀 필요 여부를 갱신합니다 (git fetch, 파일은 바뀌지 않음)"
        >
          {fetching ? '확인 중…' : '원격 확인'}
        </button>
      </div>
      <div className="gchanges">{changes.length > 0 ? changes.join(' · ') : '변경 없음'}</div>
      {fetchError && <div className="gerr">{fetchError}</div>}
    </div>
  );
}

function CommitLog() {
  const commits = useFiles((s) => s.commits);
  const loading = useFiles((s) => s.logLoading);
  const end = useFiles((s) => s.logEnd);
  const error = useFiles((s) => s.logError);
  const loadLog = useFiles((s) => s.loadLog);
  return (
    <div className="ftree glog">
      {error && <div className="gerr">{error}</div>}
      {commits.map((c) => (
        <button
          key={c.hash}
          className="gcommit"
          title={`${c.hash}
${c.subject}

클릭: 변경 내용을 새 탭에서 보기`}
          onClick={() => openCommit(c)}
        >
          <div className="gsubject">{c.subject}</div>
          <div className="gmeta">
            <code>{c.short}</code>
            <span>{c.author}</span>
            <span>{c.when}</span>
          </div>
          {c.refs.length > 0 && (
            <div className="grefs">
              {c.refs.map((r) => (
                <span key={r} className="gref">
                  {r}
                </span>
              ))}
            </div>
          )}
        </button>
      ))}
      {!loading && !error && commits.length === 0 && <div className="fempty">커밋이 없습니다</div>}
      {loading && <div className="fempty">불러오는 중…</div>}
      {!loading && !end && commits.length > 0 && (
        <button className="gmore" onClick={() => loadLog(true)}>
          더 보기
        </button>
      )}
    </div>
  );
}

/** 우측 사이드바: 프로젝트 폴더 구조(git이면 저장소 루트). 파일을 누르면 작업 영역에 내용이 열린다. */
export function FilesPanel() {
  const git = useFiles((s) => s.git);
  const rootList = useFiles((s) => s.dirs['']);
  const refresh = useFiles((s) => s.refresh);
  const width = useFiles((s) => s.width);
  const tab = useFiles((s) => s.tab);
  const setTab = useFiles((s) => s.setTab);
  const drag = useRef<{ x: number; w: number } | null>(null);
  if (!git) return null;
  const name =
    git.root
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || git.root;
  return (
    <aside className="files-panel" style={{ width }}>
      <div
        className="fresize"
        role="separator"
        aria-orientation="vertical"
        title="드래그해서 폭 조절 (더블클릭: 기본 폭)"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, w: width };
        }}
        onPointerMove={(e) => {
          // 패널이 오른쪽에 있으니 왼쪽으로 끌수록 넓어진다
          if (drag.current)
            useFiles.getState().setWidth(drag.current.w + drag.current.x - e.clientX);
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => useFiles.getState().setWidth(260)}
      />
      <div className="fhead">
        <div className="ftitle" title={`${git.root}${git.isGit ? '' : ' (git 저장소 아님)'}`}>
          <span className="frepo">{name}</span>
          {git.branch && (
            <span className="fbranch" title="현재 브랜치">
              <IconBranch />
              {git.branch}
            </span>
          )}
        </div>
        <button className="icon-btn" onClick={refresh} title="새로고침" aria-label="새로고침">
          <IconRefresh />
        </button>
      </div>
      {git.isGit && <GitSummary />}
      {git.isGit && (
        <div className="ftabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'files'}
            className={tab === 'files' ? 'on' : undefined}
            onClick={() => setTab('files')}
          >
            폴더
          </button>
          <button
            role="tab"
            aria-selected={tab === 'log'}
            className={tab === 'log' ? 'on' : undefined}
            onClick={() => setTab('log')}
          >
            로그
          </button>
        </div>
      )}
      {tab === 'log' && git.isGit ? (
        <CommitLog />
      ) : (
        <div className="ftree">
          {!rootList && <div className="fempty">불러오는 중…</div>}
          {rootList?.map((c) => (
            <Node key={c.name} dir="" name={c.name} isDir={c.isDir} depth={0} />
          ))}
        </div>
      )}
    </aside>
  );
}
