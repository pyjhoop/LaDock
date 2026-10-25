export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  binary: boolean;
  add: number;
  del: number;
  hunks: Hunk[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** `git show --patch` 출력(커밋 메타 제외)을 파일 · hunk · 줄로 나눈다. */
export function parseDiff(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      // `diff --git a/x b/x` — 경로에 공백이 있어도 a/ · b/ 가 같은 길이라는 점으로 나눈다
      const rest = line.slice('diff --git '.length);
      const half = (rest.length - 1) / 2;
      const a = rest.slice(0, half).replace(/^a\//, '');
      const b = rest.slice(half + 1).replace(/^b\//, '');
      file = { path: b, oldPath: a, status: 'modified', binary: false, add: 0, del: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      // 헤더 구간: 첫 @@ 전까지만 해석한다 (이후의 `--- ` 는 삭제된 줄일 수 있다)
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length);
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch'))
        file.binary = true;
      else if (line.startsWith('+++ b/')) file.path = line.slice('+++ b/'.length);
      else if (line.startsWith('--- a/')) file.oldPath = line.slice('--- a/'.length);
    }
    const m = HUNK.exec(line);
    if (m) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    if (!hunk) continue;
    const c = line[0];
    if (c === '+') {
      hunk.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ });
      file.add++;
    } else if (c === '-') {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ });
      file.del++;
    } else if (c === ' ') {
      hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
    // `\ No newline at end of file` 등은 건너뛴다
  }
  return files;
}
