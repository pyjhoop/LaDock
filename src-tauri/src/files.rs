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
