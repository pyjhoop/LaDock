//! Claude Code statusline 브리지.
//!
//! - `ladock.exe statusline-bridge` (CLI): statusline stdin JSON에서 `rate_limits`를 저장하고,
//!   같은 입력으로 원래 statusline 명령을 실행해 출력 · 종료 코드를 그대로 넘긴다.
//!   원래 명령은 `%APPDATA%\LaDock\bridge.json`에 있다 (셸 인용 문제를 피하려고 인자로 받지 않는다).
//! - `claude_bridge_*` (IPC): `~/.claude/settings.json`의 `statusLine.command`를 브리지로 감싸거나 되돌린다.
//!   순서는 확인 → 백업 → 변경.

use std::fs;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::limits::{app_dir, save_snapshot, snapshot_from_stdin};
use crate::providers::{home, now_secs};

pub const CLI_ARG: &str = "statusline-bridge";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ── 저장된 연결 정보 ─────────────────────────────

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct BridgeInfo {
    /// 연결 전 `statusLine.command`. 없으면 브리지만 실행한다.
    original: Option<String>,
    /// 연결 전에 `statusLine` 자체가 있었는지 (해제할 때 지울지 판단).
    had_status_line: bool,
}

fn info_path() -> Option<PathBuf> {
    app_dir().map(|d| d.join("bridge.json"))
}

fn load_info() -> Option<BridgeInfo> {
    serde_json::from_str(&fs::read_to_string(info_path()?).ok()?).ok()
}

fn save_info(info: &BridgeInfo) -> Result<(), String> {
    let p = info_path().ok_or("APPDATA 없음")?;
    write_atomic(
        &p,
        &serde_json::to_string_pretty(info).map_err(|e| e.to_string())?,
    )
}

fn write_atomic(target: &Path, text: &str) -> Result<(), String> {
    let dir = target.parent().ok_or("경로 오류")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(
        "{}.{}.tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file"),
        std::process::id()
    ));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

// ── CLI: statusline-bridge ───────────────────────

/// 브리지 쪽 실패는 원래 출력을 막지 않는다 — 저장 실패는 stderr에 한 줄만 남기고 넘어간다.
pub fn run_cli() -> i32 {
    let mut input = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut input);
    let original = load_info().and_then(|i| i.original);

    let mut child = original.and_then(|cmd| {
        Command::new("cmd")
            .raw_arg(format!("/D /S /C \"{cmd}\""))
            .stdin(Stdio::piped())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .inspect_err(|e| eprintln!("[ladock bridge] 원래 명령 실행 실패: {e}"))
            .ok()
    });
    // 원래 명령을 먼저 띄우고 입력을 흘려보낸 뒤 저장한다 (저장이 출력 지연이 되지 않게).
    if let Some(stdin) = child.as_mut().and_then(|c| c.stdin.take()) {
        let mut stdin = stdin;
        let _ = stdin.write_all(&input);
    }
    let text = String::from_utf8_lossy(&input);
    if let Some(snap) = snapshot_from_stdin(&text, now_secs())
        && let Err(e) = save_snapshot(&snap)
    {
        eprintln!("[ladock bridge] 한도 저장 실패: {e}");
    }
    child
        .and_then(|mut c| c.wait().ok())
        .and_then(|s| s.code())
        .unwrap_or(0)
}

// ── settings.json 편집 (순수 함수) ───────────────

fn is_ours(command: &str) -> bool {
    command.contains(CLI_ARG)
}

fn bridge_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Claude Code가 bash로 실행해도 되도록 슬래시를 쓴다.
    Ok(format!(
        "\"{}\" {CLI_ARG}",
        exe.to_string_lossy().replace('\\', "/")
    ))
}

fn current_command(settings: &Value) -> Option<&str> {
    settings.get("statusLine")?.get("command")?.as_str()
}

/// 연결: `statusLine.command`만 브리지로 바꾼다. 이전 값을 돌려준다.
fn wrap(settings: &mut Value, bridge: &str) -> Result<BridgeInfo, String> {
    let root = settings
        .as_object_mut()
        .ok_or("settings.json이 객체가 아님")?;
    let had = root.contains_key("statusLine");
    let prev = match root.get("statusLine") {
        None => None,
        Some(sl) => match sl.get("command").and_then(Value::as_str) {
            Some(c) => Some(c.to_owned()),
            None => return Err("statusLine에 command가 없어 감쌀 수 없음".into()),
        },
    };
    let sl = root
        .entry("statusLine")
        .or_insert_with(|| json!({ "type": "command" }));
    sl.as_object_mut()
        .ok_or("statusLine이 객체가 아님")?
        .insert("command".into(), Value::String(bridge.into()));
    Ok(BridgeInfo {
        original: prev,
        had_status_line: had,
    })
}

/// 해제: 원래 명령으로 복구. 연결 전에 statusLine이 없었으면 키를 지운다.
fn unwrap(settings: &mut Value, info: &BridgeInfo) -> Result<(), String> {
    let root = settings
        .as_object_mut()
        .ok_or("settings.json이 객체가 아님")?;
    match (&info.original, info.had_status_line) {
        (Some(orig), _) => {
            root.get_mut("statusLine")
                .and_then(Value::as_object_mut)
                .ok_or("statusLine이 없음")?
                .insert("command".into(), Value::String(orig.clone()));
        }
        (None, _) => {
            root.remove("statusLine");
        }
    }
    Ok(())
}

// ── 파일 입출력 ──────────────────────────────────

fn settings_path() -> Result<PathBuf, String> {
    Ok(home()
        .ok_or("홈 폴더를 찾지 못함")?
        .join(".claude")
        .join("settings.json"))
}

fn read_settings(p: &Path) -> Result<(Value, String), String> {
    let text = fs::read_to_string(p).map_err(|e| format!("{} 읽기 실패: {e}", p.display()))?;
    let v = serde_json::from_str(&text).map_err(|e| format!("settings.json 파싱 실패: {e}"))?;
    Ok((v, text))
}

fn backup(p: &Path) -> Result<PathBuf, String> {
    let dir = app_dir().ok_or("APPDATA 없음")?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("claude-settings.{}.json", now_secs()));
    fs::copy(p, &dest).map_err(|e| format!("백업 실패: {e}"))?;
    Ok(dest)
}

fn write_settings(p: &Path, v: &Value, original_text: &str) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    if original_text.ends_with('\n') {
        text.push('\n');
    }
    write_atomic(p, &text)
}

// ── IPC ──────────────────────────────────────────

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    /// `connected` | `disconnected` | `stale` (브리지는 있으나 실행 파일 경로가 다름) | `unavailable`
    pub state: &'static str,
    pub detail: String,
    /// 연결 전 원래 명령 (표시용)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original: Option<String>,
}

fn classify(settings: &Value, bridge: &str) -> &'static str {
    match current_command(settings) {
        Some(c) if c == bridge => "connected",
        Some(c) if is_ours(c) => "stale",
        _ => "disconnected",
    }
}

pub fn status() -> BridgeStatus {
    let bridge = match bridge_command() {
        Ok(b) => b,
        Err(e) => {
            return BridgeStatus {
                state: "unavailable",
                detail: e,
                original: None,
            };
        }
    };
    let settings = match settings_path().and_then(|p| read_settings(&p)) {
        Ok((v, _)) => v,
        // 설정 파일이 아직 없으면 연결만 안 된 상태.
        Err(e) if !settings_path().is_ok_and(|p| p.exists()) => {
            return BridgeStatus {
                state: "disconnected",
                detail: e,
                original: None,
            };
        }
        Err(e) => {
            return BridgeStatus {
                state: "unavailable",
                detail: e,
                original: None,
            };
        }
    };
    let state = classify(&settings, &bridge);
    let detail = match state {
        "connected" => "statusline 브리지 연결됨",
        "stale" => "브리지의 실행 파일 경로가 지금과 다름 — 다시 연결 필요",
        _ => "연결되지 않음",
    };
    BridgeStatus {
        state,
        detail: detail.into(),
        original: load_info().and_then(|i| i.original),
    }
}

#[tauri::command]
pub fn claude_bridge_status() -> BridgeStatus {
    status()
}

/// `confirm`은 UI가 사용자 확인을 받았다는 표시. 확인 없이는 파일을 건드리지 않는다.
#[tauri::command]
pub fn claude_bridge_connect(confirm: bool) -> Result<BridgeStatus, String> {
    if !confirm {
        return Err("사용자 확인이 필요함".into());
    }
    let path = settings_path()?;
    let bridge = bridge_command()?;
    let (mut settings, text) = if path.exists() {
        read_settings(&path)?
    } else {
        (Value::Object(Map::new()), String::new())
    };
    // 이미 감싸져 있으면(경로만 바뀐 경우 등) 처음 저장한 원래 명령을 유지한다.
    let already_ours = current_command(&settings).is_some_and(is_ours);
    let mut info = wrap(&mut settings, &bridge)?;
    if already_ours && let Some(saved) = load_info() {
        info = saved;
    }
    if path.exists() {
        backup(&path)?;
    }
    save_info(&info)?;
    write_settings(&path, &settings, &text)?;
    Ok(status())
}

#[tauri::command]
pub fn claude_bridge_disconnect() -> Result<BridgeStatus, String> {
    let path = settings_path()?;
    let info = load_info().ok_or("저장된 원래 설정이 없음 — 백업 폴더에서 직접 복구해야 함")?;
    let (mut settings, text) = read_settings(&path)?;
    if current_command(&settings).is_some_and(|c| !is_ours(c)) {
        // 이미 다른 명령으로 바뀜 (Claude Code · 사용자가 직접 수정) → 건드리지 않는다.
        return Ok(status());
    }
    backup(&path)?;
    unwrap(&mut settings, &info)?;
    write_settings(&path, &settings, &text)?;
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    const BRIDGE: &str = "\"C:/x/ladock.exe\" statusline-bridge";

    fn settings() -> Value {
        serde_json::from_str(
            r#"{"theme":"dark","statusLine":{"type":"command","command":"node \"a.js\"","refreshInterval":30},"z":1}"#,
        )
        .unwrap()
    }

    #[test]
    fn wrap_changes_only_command() {
        let mut s = settings();
        let info = wrap(&mut s, BRIDGE).unwrap();
        assert_eq!(info.original.as_deref(), Some("node \"a.js\""));
        assert_eq!(s["statusLine"]["command"], BRIDGE);
        assert_eq!(s["statusLine"]["refreshInterval"], 30);
        assert_eq!(classify(&s, BRIDGE), "connected");
        assert_eq!(
            classify(&s, "\"D:/y/ladock.exe\" statusline-bridge"),
            "stale"
        );
    }

    #[test]
    fn unwrap_restores_original_exactly() {
        let before = settings();
        let mut s = before.clone();
        let info = wrap(&mut s, BRIDGE).unwrap();
        unwrap(&mut s, &info).unwrap();
        assert_eq!(s, before);
        // 키 순서까지 같아야 한다 (preserve_order).
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            serde_json::to_string(&before).unwrap()
        );
    }

    #[test]
    fn no_status_line_is_created_then_removed() {
        let mut s: Value = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        let info = wrap(&mut s, BRIDGE).unwrap();
        assert_eq!(info.original, None);
        assert_eq!(s["statusLine"]["type"], "command");
        unwrap(&mut s, &info).unwrap();
        assert!(s.get("statusLine").is_none());
    }

    #[test]
    fn rejects_status_line_without_command() {
        let mut s: Value = serde_json::from_str(r#"{"statusLine":{"type":"static"}}"#).unwrap();
        assert!(wrap(&mut s, BRIDGE).is_err());
    }
}
