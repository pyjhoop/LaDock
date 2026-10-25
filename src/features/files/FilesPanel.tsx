import { IconBranch, IconChevR, IconFile, IconFolder, IconRefresh } from '../../components/icons';
import { useRef } from 'react';
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

/** 우측 사이드바: 프로젝트 폴더 구조(git이면 저장소 루트). 파일을 누르면 작업 영역에 내용이 열린다. */
export function FilesPanel() {
  const git = useFiles((s) => s.git);
  const rootList = useFiles((s) => s.dirs['']);
  const refresh = useFiles((s) => s.refresh);
  const width = useFiles((s) => s.width);
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
      <div className="ftree">
        {!rootList && <div className="fempty">불러오는 중…</div>}
        {rootList?.map((c) => (
          <Node key={c.name} dir="" name={c.name} isDir={c.isDir} depth={0} />
        ))}
      </div>
    </aside>
  );
}
