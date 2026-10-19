//! 한도 읽기. Claude는 statusline 브리지가 남긴 스냅샷(공식 데이터)만 쓴다.

mod claude;
mod gemini;
mod watch;

use std::path::PathBuf;

use serde::Serialize;

pub use claude::{save_snapshot, snapshot_from_stdin};
pub use watch::start_watcher;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub key: &'static str,
    pub used_pct: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<u64>,
    /// 횟수 기반 한도일 때 (Gemini 일일 요청)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitStatus {
    pub provider: &'static str,
    pub windows: Vec<LimitWindow>,
    pub source: &'static str,
    pub source_detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

/// `%APPDATA%\LaDock`
pub(crate) fn app_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("LaDock"))
}

pub(crate) fn limits_dir() -> Option<PathBuf> {
    app_dir().map(|d| d.join("limits"))
}

fn none(provider: &'static str, detail: &str) -> LimitStatus {
    LimitStatus {
        provider,
        windows: vec![],
        source: "none",
        source_detail: detail.into(),
        updated_at: None,
    }
}

/// Antigravity: 공식 한도 경로를 아직 못 찾음 (조사 결과는 M2-04 작업 기록).
fn antigravity() -> LimitStatus {
    none(
        "antigravity",
        "한도 정보를 얻을 공식 경로를 아직 찾지 못했어요",
    )
}

/// Codex: 이 PC에는 미설치(D3)라 `rate_limits` 형식을 확인할 수 없다 — 읽기는 구현하지 않음.
fn codex() -> LimitStatus {
    let has_sessions =
        crate::providers::home().is_some_and(|h| h.join(r".codex\sessions").is_dir());
    if has_sessions {
        none("codex", "한도 읽기 미구현 — 세션 기록 형식 확인 필요")
    } else {
        none("codex", "Codex 미설치")
    }
}

pub fn get() -> Vec<LimitStatus> {
    vec![claude::read(), gemini::read(), antigravity(), codex()]
}

#[tauri::command]
pub fn limits_get(_force: Option<bool>) -> Vec<LimitStatus> {
    get()
}
