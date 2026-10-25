import { useEffect } from 'react';
import { IconClose } from '../../components/icons';
import { useFiles } from './files';

const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

/** 선택한 파일의 내용(읽기 전용). 작업 영역 위에 덮이고, 터미널은 아래에서 그대로 살아 있다. */
export function FileViewer() {
  const file = useFiles((s) => s.file);
  const closeFile = useFiles((s) => s.closeFile);
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      // 아래 터미널에 Esc가 흘러가지 않게 먼저 가로챈다
      e.stopPropagation();
      e.preventDefault();
      closeFile();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [file, closeFile]);
  if (!file) return null;
  const { content, error } = file;
  const lines = content && !content.binary ? content.text.split('\n') : [];
  return (
    <div className="fviewer">
      <div className="fv-head">
        <span className="fv-path" title={file.rel}>
          {file.rel}
        </span>
        {content && <span className="fv-size">{fmtSize(content.size)}</span>}
        <button className="icon-btn" onClick={closeFile} title="닫기 (Esc)" aria-label="닫기">
          <IconClose />
        </button>
      </div>
      <div className="fv-body">
        {!content && !error && <p className="fv-note">불러오는 중…</p>}
        {error && <p className="fv-note">{error}</p>}
        {content?.binary && <p className="fv-note">바이너리 파일이라 내용을 표시하지 않습니다</p>}
        {content && !content.binary && (
          <pre className="fv-code">
            {lines.map((line, i) => (
              <div key={i} className="fv-line">
                <span className="fv-no">{i + 1}</span>
                <span className="fv-text">{line || ' '}</span>
              </div>
            ))}
          </pre>
        )}
        {content?.truncated && <p className="fv-note">파일이 커서 앞부분(512KB)만 표시합니다</p>}
      </div>
    </div>
  );
}
