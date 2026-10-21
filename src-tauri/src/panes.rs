//! pane 화면 공유. 다른 에이전트 · AI가 pane의 내용을 읽을 수 있게 파일로 내놓는다.
//!
//! `%APPDATA%\LaDock\panes\` 아래에 `index.json`(pane 목록)과 `<순번>.txt`(화면 + 스크롤백 끝부분)를 둔다.
//! 읽는 쪽은 평범한 파일 읽기(`tail`)만 하면 되고, 앱은 내용이 바뀐 pane만 다시 쓴다.

use std::fs;
use std::path::{Path, PathBuf};

use crate::limits::app_dir;

const DIR: &str = "panes";
const INDEX: &str = "index.json";

pub fn panes_dir() -> Option<PathBuf> {
    Some(app_dir()?.join(DIR))
}

/// pane 프로세스에 넘기는 환경변수: 자기 순번과 공유 폴더 위치.
pub fn child_env(pane_no: Option<u32>) -> Vec<(String, String)> {
    let mut env = Vec::new();
    if let Some(no) = pane_no {
        env.push(("LADOCK_PANE".to_string(), no.to_string()));
    }
    if let Some(dir) = panes_dir() {
        env.push(("LADOCK_PANES_DIR".to_string(), dir.display().to_string()));
    }
    env
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("저장 경로 오류")?;
    fs::create_dir_all(dir).map_err(|e| format!("panes 폴더 생성 실패: {e}"))?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| format!("panes 쓰기 실패: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("panes 교체 실패: {e}"))
}

fn txt_no(path: &Path) -> Option<u32> {
    if path.extension()?.to_str()? != "txt" {
        return None;
    }
    path.file_stem()?.to_str()?.parse().ok()
}

/// 목록에 없는 `<순번>.txt`를 지운다.
fn prune(dir: &Path, keep: &[u32]) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        if txt_no(&path).is_some_and(|n| !keep.contains(&n)) {
            let _ = fs::remove_file(path);
        }
    }
}

/// 앱을 켤 때: 지난 실행에서 남은 화면 파일을 치운다 (pane은 새로 그려지며 다시 쓴다).
pub fn clear_stale() {
    if let Some(dir) = panes_dir() {
        prune(&dir, &[]);
        let _ = fs::remove_file(dir.join(INDEX));
    }
}

fn dump_to(dir: &Path, no: u32, text: &str) -> Result<(), String> {
    write_atomic(&dir.join(format!("{no}.txt")), text)
}

fn index_to(dir: &Path, json: &str, keep: &[u32]) -> Result<(), String> {
    write_atomic(&dir.join(INDEX), json)?;
    prune(dir, keep);
    Ok(())
}

/// pane 한 개의 화면 텍스트를 쓴다.
#[tauri::command]
pub fn pane_dump(no: u32, text: String) -> Result<(), String> {
    dump_to(&panes_dir().ok_or("APPDATA 없음")?, no, &text)
}

/// pane 목록(`index.json`)을 쓰고, 닫힌 pane의 화면 파일을 지운다.
#[tauri::command]
pub fn panes_index(json: String, nos: Vec<u32>) -> Result<(), String> {
    index_to(&panes_dir().ok_or("APPDATA 없음")?, &json, &nos)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ladock-panes-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn dump_replaces_content() {
        let d = temp("dump");
        dump_to(&d, 3, "첫째\n").unwrap();
        dump_to(&d, 3, "둘째\n").unwrap();
        assert_eq!(fs::read_to_string(d.join("3.txt")).unwrap(), "둘째\n");
        assert!(!d.join("3.tmp").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn index_prunes_closed_panes_only() {
        let d = temp("prune");
        dump_to(&d, 1, "a").unwrap();
        dump_to(&d, 2, "b").unwrap();
        fs::write(d.join("memo.txt"), "남의 파일").unwrap();
        index_to(&d, "{}", &[2]).unwrap();
        assert!(!d.join("1.txt").exists());
        assert!(d.join("2.txt").exists());
        assert!(d.join("memo.txt").exists());
        assert!(d.join(INDEX).exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn child_env_has_pane_number() {
        let env = child_env(Some(4));
        assert!(env.contains(&("LADOCK_PANE".to_string(), "4".to_string())));
        assert!(child_env(None).iter().all(|(k, _)| k != "LADOCK_PANE"));
    }
}
