import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { IconClose, IconSplitD, IconSplitR, IconUnzoom, IconZoom } from '../../components/icons';
import { useStore } from '../../store/store';
import { remoteClient } from '../remote/client';
import { parseDiff, type FileDiff } from './parseDiff';
import './diff.css';

interface CommitDiff {
  hash: string;
  author: string;
  date: string;
  message: string;
  patch: string;
  truncated: boolean;
}

const STATUS_LABEL = { modified: '수정', added: '추가', deleted: '삭제', renamed: '이름 변경' };
const STATUS_MARK = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R' };

/** 선택한 파일 하나의 변경 내용 */
function FileView({ file }: { file: FileDiff }) {
  return (
    <div className="dview">
      <div className="dview-head">
        <span className={`dstatus ${file.status}`}>{STATUS_LABEL[file.status]}</span>
        <span className="dpath" title={file.path}>
          {file.status === 'renamed' ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="dnum add">+{file.add}</span>
        <span className="dnum del">−{file.del}</span>
      </div>
      <div className="dbody">
        {file.binary && <p className="dnote">바이너리 파일입니다</p>}
        {!file.binary && file.hunks.length === 0 && (
          <p className="dnote">내용 변경이 없습니다 (이름 · 권한만 바뀜)</p>
        )}
        {file.hunks.map((h, i) => (
          <div key={i} className="dhunk">
            <div className="dhunk-head">{h.header}</div>
            {h.lines.map((l, j) => (
              <div key={j} className={`dline ${l.kind}`}>
                <span className="dno">{l.oldNo ?? ''}</span>
                <span className="dno">{l.newNo ?? ''}</span>
                <span className="dsign">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                </span>
                <span className="dtext">{l.text || ' '}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface DiffPaneProps {
  paneKey: string;
  root: string;
  hash: string;
  focused: boolean;
  zoomed: boolean;
  onFocus: () => void;
  onSplit: (dir: 'row' | 'col') => void;
  onToggleZoom: () => void;
  onClose: () => void;
}

/** 커밋 하나가 바꾼 내용을 보여주는 pane (읽기 전용). 터미널 pane과 같은 자리에 들어간다. */
export function DiffPane(p: DiffPaneProps) {
  const paneNo = useStore((s) => s.panes[p.paneKey]?.no);
  const [data, setData] = useState<CommitDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (remoteClient) return;
    let alive = true;
    invoke<CommitDiff>('git_show', { root: p.root, hash: p.hash })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [p.root, p.hash]);

  const files = useMemo(() => (data ? parseDiff(data.patch) : []), [data]);
  const add = files.reduce((n, f) => n + f.add, 0);
  const del = files.reduce((n, f) => n + f.del, 0);
  const [subject, ...rest] = (data?.message ?? '').split('\n');
  const body = rest.join('\n').trim();
  const [sel, setSel] = useState(0);
  const [showMsg, setShowMsg] = useState(false);

  return (
    <section
      className={`pane diffpane${p.focused ? ' focused' : ''}`}
      onMouseDownCapture={p.onFocus}
    >
      <header className="pane-head">
        <span className="pane-icon" aria-hidden>
          ±
        </span>
        <span className="pane-title">{paneNo ?? '변경'}</span>
        <span className="pane-cwd">{p.hash.slice(0, 7)}</span>
        <span className="pane-actions">
          <button type="button" className="opt" title="좌우 분할" onClick={() => p.onSplit('row')}>
            <IconSplitR />
          </button>
          <button type="button" className="opt" title="상하 분할" onClick={() => p.onSplit('col')}>
            <IconSplitD />
          </button>
          <button type="button" className="opt" title="줌" onClick={p.onToggleZoom}>
            {p.zoomed ? <IconUnzoom /> : <IconZoom />}
          </button>
          <button type="button" className="danger" title="닫기" onClick={p.onClose}>
            <IconClose />
          </button>
        </span>
      </header>
      <div className="dsplit">
        {remoteClient && <p className="dnote">변경 내용은 PC 화면에서만 볼 수 있습니다</p>}
        {!data && !error && !remoteClient && <p className="dnote">불러오는 중…</p>}
        {error && <p className="dnote derr">{error}</p>}
        {data && (
          <>
            <nav className="dside">
              <div className="dcommit">
                <h3 title={subject}>{subject}</h3>
                <div className="dmeta">
                  <code>{data.hash.slice(0, 10)}</code>
                  <span>{data.author}</span>
                  <span>{data.date}</span>
                </div>
                {body && (
                  <>
                    <button className="dtoggle" onClick={() => setShowMsg((v) => !v)}>
                      {showMsg ? '메시지 접기' : '메시지 보기'}
                    </button>
                    {showMsg && <pre className="dmsg">{body}</pre>}
                  </>
                )}
                <div className="dsummary">
                  파일 {files.length}개 <span className="dnum add">+{add}</span>{' '}
                  <span className="dnum del">−{del}</span>
                </div>
              </div>
              <ul className="dtoc">
                {files.map((f, i) => (
                  <li key={i}>
                    <button
                      className={i === sel ? 'on' : undefined}
                      onClick={() => setSel(i)}
                      title={f.path}
                    >
                      <span className={`dmark ${f.status}`}>{STATUS_MARK[f.status]}</span>
                      <span className="dname">
                        <b>{f.path.split('/').pop()}</b>
                        <i>
                          {f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}
                        </i>
                      </span>
                      <span className="dnum add">+{f.add}</span>
                      <span className="dnum del">−{f.del}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.truncated && <p className="dnote">변경이 너무 커서 앞부분(3MB)만 표시합니다</p>}
            </nav>
            {files[sel] ? (
              <FileView key={sel} file={files[sel]} />
            ) : (
              <p className="dnote">변경된 파일이 없습니다</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
