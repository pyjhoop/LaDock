//! 우측 파일 패널용 읽기 전용 파일 시스템 조회: git 저장소 감지 · 폴더 목록 · 파일 내용.
//! 모든 경로는 `root` 안에 있어야 하고(`..` · 심볼릭 링크 탈출 차단), 쓰기는 하지 않는다.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// 한 번에 읽는 파일 최대 크기
const MAX_READ: u64 = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    /// 저장소 최상위 폴더
    root: String,
    /// 현재 브랜치(분리된 HEAD면 짧은 해시). git 저장소가 아니면 없음
    branch: Option<String>,
    is_git: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    text: String,
    /// 크기 제한으로 잘렸는지
    truncated: bool,
    /// 텍스트가 아니라 내용을 보여주지 않았는지
    binary: bool,
    size: u64,
}

fn branch_of(git_dir: &Path) -> Option<String> {
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref: refs/heads/") {
        Some(name) => Some(name.to_string()),
        None => Some(head.chars().take(7).collect()),
    }
}

/// `.git`이 폴더면 그대로, 파일(worktree · submodule)이면 `gitdir:` 가리키는 곳.
fn resolve_git_dir(dot_git: &Path) -> Option<PathBuf> {
    if dot_git.is_dir() {
        return Some(dot_git.to_path_buf());
    }
    let text = fs::read_to_string(dot_git).ok()?;
    let target = text.trim().strip_prefix("gitdir:")?.trim();
    let p = PathBuf::from(target);
    Some(if p.is_absolute() {
        p
    } else {
        dot_git.parent()?.join(p)
    })
}

fn find_git(start: &Path) -> Option<GitInfo> {
    for dir in start.ancestors() {
        let dot_git = dir.join(".git");
        if dot_git.exists() {
            let branch = resolve_git_dir(&dot_git).and_then(|g| branch_of(&g));
            return Some(GitInfo {
                root: dir.to_string_lossy().into_owned(),
                branch,
                is_git: true,
            });
        }
    }
    None
}

/// `rel`이 `root` 안의 경로인지 확인하고 실제 경로를 돌려준다.
fn resolve_inside(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("폴더를 열 수 없음: {e}"))?;
    let rel = Path::new(rel);
    if rel
        .components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err("허용되지 않는 경로".into());
    }
    let full = fs::canonicalize(root.join(rel)).map_err(|e| format!("경로를 열 수 없음: {e}"))?;
    if full.starts_with(&root) {
        Ok(full)
    } else {
        Err("저장소 밖의 경로".into())
    }
}

/// 파일 패널이 보여줄 루트. git 저장소 안이면 저장소 루트, 아니면 `cwd` 자체.
/// `cwd`가 비면 사용자 홈(셸 기본 위치). 폴더가 아니면 `None`.
#[tauri::command]
pub fn fs_root(cwd: String) -> Option<GitInfo> {
    let dir = if cwd.is_empty() {
        PathBuf::from(std::env::var_os("USERPROFILE")?)
    } else {
        PathBuf::from(&cwd)
    };
    if !dir.is_dir() {
        return None;
    }
    find_git(&dir).or(Some(GitInfo {
        root: dir.to_string_lossy().into_owned(),
        branch: None,
        is_git: false,
    }))
}

/// `root/rel` 폴더의 항목. 폴더 먼저, 이름순. `.git`은 숨긴다.
#[tauri::command]
pub fn fs_list(root: String, rel: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve_inside(&root, &rel)?;
    let mut out: Vec<DirEntry> = fs::read_dir(&dir)
        .map_err(|e| format!("폴더를 읽을 수 없음: {e}"))?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                return None;
            }
            // 심볼릭 링크는 가리키는 쪽 기준으로 폴더 여부를 본다 (실패하면 파일 취급)
            let is_dir = fs::metadata(e.path()).map(|m| m.is_dir()).unwrap_or(false);
            Some(DirEntry { name, is_dir })
        })
        .collect();
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// `root/rel` 파일의 텍스트. 너무 크면 앞부분만, 바이너리면 내용 없이 알린다.
#[tauri::command]
pub fn fs_read(root: String, rel: String) -> Result<FileContent, String> {
    use std::io::Read;
    let path = resolve_inside(&root, &rel)?;
    let meta = fs::metadata(&path).map_err(|e| format!("파일 정보를 읽을 수 없음: {e}"))?;
    if !meta.is_file() {
        return Err("파일이 아님".into());
    }
    let size = meta.len();
    let mut buf = Vec::new();
    fs::File::open(&path)
        .and_then(|f| f.take(MAX_READ).read_to_end(&mut buf))
        .map_err(|e| format!("파일을 읽을 수 없음: {e}"))?;
    if buf.contains(&0) {
        return Ok(FileContent {
            text: String::new(),
            truncated: false,
            binary: true,
            size,
        });
    }
    Ok(FileContent {
        text: String::from_utf8_lossy(&buf).into_owned(),
        truncated: size > MAX_READ,
        binary: false,
        size,
    })
}

// ── git 상태 · 로그 (git CLI, 읽기 전용 · fetch만 사용자가 눌렀을 때) ──────────

#[derive(Serialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    branch: Option<String>,
    upstream: Option<String>,
    /// 업스트림보다 앞선 커밋 수 (푸시할 것)
    ahead: u32,
    /// 업스트림보다 뒤진 커밋 수 (풀할 것) — 마지막 fetch 기준
    behind: u32,
    staged: u32,
    modified: u32,
    untracked: u32,
    conflicted: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    hash: String,
    short: String,
    author: String,
    /// "3 hours ago" 같은 상대 시간
    when: String,
    refs: Vec<String>,
    subject: String,
}

fn run_git(root: &str, args: &[&str]) -> Result<String, String> {
    use std::process::Command;
    let mut cmd = Command::new("git");
    cmd.arg("--no-optional-locks")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd
        .output()
        .map_err(|e| format!("git을 실행할 수 없음: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `git status --porcelain=v2 --branch` 출력 해석
fn parse_status(text: &str) -> GitStatus {
    let mut st = GitStatus::default();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            st.branch = Some(rest.to_string()).filter(|b| b != "(detached)");
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            st.upstream = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    st.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    st.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let mut xy = line[2..].chars();
            if xy.next().is_some_and(|c| c != '.') {
                st.staged += 1;
            }
            if xy.next().is_some_and(|c| c != '.') {
                st.modified += 1;
            }
        } else if line.starts_with("u ") {
            st.conflicted += 1;
        } else if line.starts_with("? ") {
            st.untracked += 1;
        }
    }
    st
}

fn parse_log(text: &str) -> Vec<Commit> {
    text.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_matches(['\n', '\r']);
            let f: Vec<&str> = rec.split('\x1f').collect();
            if f.len() < 6 {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                author: f[2].to_string(),
                when: f[3].to_string(),
                refs: f[4]
                    .split(", ")
                    .filter(|r| !r.is_empty())
                    .map(|r| r.trim_start_matches("HEAD -> ").to_string())
                    .collect(),
                subject: f[5].to_string(),
            })
        })
        .collect()
}

/// 현재 브랜치 · 푸시/풀 필요 여부 · 변경 파일 수
#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    run_git(&root, &["status", "--porcelain=v2", "--branch"]).map(|t| parse_status(&t))
}

/// 최근 커밋 `limit`개 (`skip`개 건너뜀). 모든 브랜치가 아니라 현재 HEAD 기준.
#[tauri::command]
pub fn git_log(root: String, limit: u32, skip: u32) -> Result<Vec<Commit>, String> {
    let n = limit.clamp(1, 200).to_string();
    let s = skip.to_string();
    let fmt = "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%D%x1f%s%x1e";
    match run_git(
        &root,
        &["log", "-n", &n, "--skip", &s, "--decorate=short", fmt],
    ) {
        Ok(t) => Ok(parse_log(&t)),
        // 커밋이 하나도 없는 저장소
        Err(e) if e.contains("does not have any commits") => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    hash: String,
    author: String,
    date: String,
    /// 커밋 메시지 전체
    message: String,
    /// `git show`의 patch 부분 (그대로)
    patch: String,
    /// 너무 커서 뒤를 잘랐는지
    truncated: bool,
}

/// patch 최대 크기
const MAX_PATCH: usize = 3 * 1024 * 1024;

/// 커밋이 바꾼 내용 (머지 커밋은 첫 부모 기준).
#[tauri::command]
pub fn git_show(root: String, hash: String) -> Result<CommitDiff, String> {
    // 옵션으로 오해받지 않도록 해시 모양만 받는다
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("올바르지 않은 커밋".into());
    }
    let fmt = "--format=%H%x1f%an%x1f%ad%x1f%B%x1e";
    let text = run_git(
        &root,
        &[
            "show",
            "--no-color",
            "--date=format:%Y-%m-%d %H:%M",
            "--diff-merges=first-parent",
            "-M",
            "--patch",
            fmt,
            &hash,
        ],
    )?;
    let (head, patch) = text
        .split_once('\x1e')
        .ok_or("git show 출력을 해석할 수 없음")?;
    let f: Vec<&str> = head.splitn(4, '\x1f').collect();
    if f.len() < 4 {
        return Err("git show 출력을 해석할 수 없음".into());
    }
    let mut patch = patch.trim_start_matches(['\r', '\n']).to_string();
    let truncated = patch.len() > MAX_PATCH;
    if truncated {
        let mut cut = MAX_PATCH;
        while !patch.is_char_boundary(cut) {
            cut -= 1;
        }
        patch.truncate(cut);
    }
    Ok(CommitDiff {
        hash: f[0].to_string(),
        author: f[1].to_string(),
        date: f[2].to_string(),
        message: f[3].trim().to_string(),
        patch,
        truncated,
    })
}

/// 원격 상태를 새로 받아온다 (파일은 바꾸지 않음). 사용자가 버튼을 눌렀을 때만.
#[tauri::command]
pub fn git_fetch(root: String) -> Result<(), String> {
    run_git(&root, &["fetch", "--quiet"]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("ladock-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parses_status_v2() {
        let text = "# branch.oid abc
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -3
1 M. N... 100644 100644 100644 a b f.rs
1 .M N... 100644 100644 100644 a b g.rs
1 MM N... 100644 100644 100644 a b h.rs
u UU N... 1 1 1 1 a b c.rs
? new.txt
";
        let st = parse_status(text);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 3));
        assert_eq!(
            (st.staged, st.modified, st.untracked, st.conflicted),
            (2, 2, 1, 1)
        );
    }

    #[test]
    fn parses_log_records() {
        let text = "h1h1s김3 hours agoHEAD -> main, origin/main첫 커밋
h2h2sLee1 day ago두번째";
        let log = parse_log(text);
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].refs, ["main", "origin/main"]);
        assert_eq!(log[1].subject, "두번째");
        assert!(log[1].refs.is_empty());
    }

    #[test]
    fn detects_git_from_subfolder() {
        let root = temp("git");
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/feature/x\n").unwrap();
        fs::create_dir_all(root.join("a/b")).unwrap();
        let info = find_git(&root.join("a/b")).unwrap();
        assert_eq!(info.branch.as_deref(), Some("feature/x"));
        assert!(Path::new(&info.root).ends_with(root.file_name().unwrap()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plain_folder_is_its_own_root() {
        let root = temp("plain");
        let info = fs_root(root.to_string_lossy().into_owned()).unwrap();
        assert!(!info.is_git);
        assert!(fs_root(root.join("nope").to_string_lossy().into_owned()).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_escape() {
        let root = temp("esc");
        fs::write(root.join("a.txt"), "hi").unwrap();
        let r = root.to_string_lossy().into_owned();
        assert!(resolve_inside(&r, "../x").is_err());
        assert!(resolve_inside(&r, "C:\\Windows").is_err());
        assert!(resolve_inside(&r, "a.txt").is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_dirs_first_and_hides_git() {
        let root = temp("list");
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("README.md"), "x").unwrap();
        let list = fs_list(root.to_string_lossy().into_owned(), String::new()).unwrap();
        let names: Vec<_> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["src", "README.md"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_text_and_flags_binary() {
        let root = temp("read");
        fs::write(root.join("a.txt"), "안녕").unwrap();
        fs::write(root.join("b.bin"), [1u8, 0, 2]).unwrap();
        let r = root.to_string_lossy().into_owned();
        assert_eq!(fs_read(r.clone(), "a.txt".into()).unwrap().text, "안녕");
        assert!(fs_read(r, "b.bin".into()).unwrap().binary);
        let _ = fs::remove_dir_all(&root);
    }
}
