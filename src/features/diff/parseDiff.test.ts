import { describe, expect, it } from 'vitest';
import { parseDiff } from './parseDiff';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@ function x
 keep
--- not a header
-old
+new
\\ No newline at end of file
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+one
+two
diff --git a/old.png b/new.png
similarity index 100%
rename from old.png
rename to new.png
diff --git a/bin.dat b/bin.dat
Binary files a/bin.dat and b/bin.dat differ
`;

describe('parseDiff', () => {
  const files = parseDiff(PATCH);

  it('파일을 나누고 상태를 구분한다', () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/a.ts', 'modified'],
      ['new.txt', 'added'],
      ['new.png', 'renamed'],
      ['bin.dat', 'modified'],
    ]);
    expect(files[2].oldPath).toBe('old.png');
    expect(files[3].binary).toBe(true);
  });

  it('hunk 안의 `--- ` 줄은 삭제된 줄로 센다', () => {
    const f = files[0];
    expect(f.add).toBe(1);
    expect(f.del).toBe(2);
    expect(f.hunks[0].lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'del', 'add']);
  });

  it('줄 번호를 붙인다', () => {
    const l = files[0].hunks[0].lines;
    expect([l[0].oldNo, l[0].newNo]).toEqual([1, 1]);
    expect(l[1].oldNo).toBe(2);
    expect(l[3].newNo).toBe(2);
    expect(files[1].hunks[0].lines[1].newNo).toBe(2);
  });
});
