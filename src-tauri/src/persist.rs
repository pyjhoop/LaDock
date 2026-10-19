//! 레이아웃 저장 파일(`%APPDATA%\LaDock\state.json`), 설정 파일(`settings.json`),
//! 자동 작업 파일(`tasks.json`) 입출력.
//! 내용 검증 · 마이그레이션은 프론트(`features/persist`, `features/settings`)가 하고,
//! 여기서는 파일만 안전하게 다룬다.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::limits::app_dir;

const FILE: &str = "state.json";
const SETTINGS_FILE: &str = "settings.json";
const TASKS_FILE: &str = "tasks.json";
const HISTORY_FILE: &str = "task-history.json";

fn state_path() -> Result<PathBuf, String> {
    Ok(app_dir().ok_or("APPDATA 없음")?.join(FILE))
}

fn read_state(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("state.json 읽기 실패: {e}")),
    }
}

/// 임시 파일에 쓴 뒤 바꿔치기해서, 쓰는 도중 꺼져도 기존 파일이 깨지지 않게 한다.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("저장 경로 오류")?;
    fs::create_dir_all(dir).map_err(|e| format!("저장 폴더 생성 실패: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("state.json 쓰기 실패: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("state.json 교체 실패: {e}"))
}

/// 깨진 파일을 `state.corrupt-<unix초>.json`으로 옮겨 두고 그 경로를 돌려준다.
fn quarantine(path: &Path) -> Result<PathBuf, String> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = path.with_file_name(format!("state.corrupt-{secs}.json"));
    fs::rename(path, &dest).map_err(|e| format!("백업 실패: {e}"))?;
    Ok(dest)
}

/// 저장된 원문. 파일이 없으면 `None`.
#[tauri::command]
pub fn state_load() -> Result<Option<String>, String> {
    read_state(&state_path()?)
}

#[tauri::command]
pub fn state_save(json: String) -> Result<(), String> {
    write_atomic(&state_path()?, &json)
}

/// 읽을 수 없는 저장 파일을 백업 이름으로 치운다. 백업 경로를 돌려준다.
#[tauri::command]
pub fn state_quarantine() -> Result<Option<String>, String> {
    let path = state_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(quarantine(&path)?.to_string_lossy().into_owned()))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(app_dir().ok_or("APPDATA 없음")?.join(SETTINGS_FILE))
}

/// 저장된 설정 원문. 파일이 없으면 `None`.
#[tauri::command]
pub fn settings_load() -> Result<Option<String>, String> {
    read_state(&settings_path()?)
}

#[tauri::command]
pub fn settings_save(json: String) -> Result<(), String> {
    write_atomic(&settings_path()?, &json)
}

fn tasks_path() -> Result<PathBuf, String> {
    Ok(app_dir().ok_or("APPDATA 없음")?.join(TASKS_FILE))
}

/// 저장된 자동 작업 원문. 파일이 없으면 `None`.
#[tauri::command]
pub fn tasks_load() -> Result<Option<String>, String> {
    read_state(&tasks_path()?)
}

#[tauri::command]
pub fn tasks_save(json: String) -> Result<(), String> {
    write_atomic(&tasks_path()?, &json)
}

fn history_path() -> Result<PathBuf, String> {
    Ok(app_dir().ok_or("APPDATA 없음")?.join(HISTORY_FILE))
}

/// 자동 작업 실행 기록 원문. 파일이 없으면 `None`.
#[tauri::command]
pub fn task_history_load() -> Result<Option<String>, String> {
    read_state(&history_path()?)
}

#[tauri::command]
pub fn task_history_save(json: String) -> Result<(), String> {
    write_atomic(&history_path()?, &json)
}

/// 각 경로가 지금 존재하는 폴더인지.
#[tauri::command]
pub fn dirs_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_dir()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ladock-persist-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn missing_file_is_none() {
        let d = temp("missing");
        assert_eq!(read_state(&d.join(FILE)).unwrap(), None);
    }

    #[test]
    fn atomic_write_roundtrip_and_overwrite() {
        let d = temp("write");
        let p = d.join(FILE);
        write_atomic(&p, "{\"a\":1}").unwrap();
        write_atomic(&p, "{\"a\":2}").unwrap();
        assert_eq!(read_state(&p).unwrap().as_deref(), Some("{\"a\":2}"));
        assert!(!p.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn quarantine_moves_file_aside() {
        let d = temp("quarantine");
        let p = d.join(FILE);
        write_atomic(&p, "깨진 내용").unwrap();
        let dest = quarantine(&p).unwrap();
        assert!(!p.exists());
        assert_eq!(fs::read_to_string(&dest).unwrap(), "깨진 내용");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn dirs_exist_checks_directories_only() {
        let d = temp("dirs");
        fs::create_dir_all(&d).unwrap();
        let file = d.join("f.txt");
        fs::write(&file, "x").unwrap();
        let got = dirs_exist(vec![
            d.to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            d.join("nope").to_string_lossy().into_owned(),
        ]);
        assert_eq!(got, vec![true, false, false]);
        let _ = fs::remove_dir_all(&d);
    }
}
