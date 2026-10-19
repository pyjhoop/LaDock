//! 한도 읽기. Claude는 statusline 브리지가 남긴 스냅샷(공식 데이터)만 쓴다.

mod antigravity;
mod claude;
mod watch;

use std::path::PathBuf;

use serde::Serialize;

pub use claude::{save_snapshot, snapshot_from_stdin};
pub use watch::start_watcher;
#[cfg(test)]
pub(crate) use watch::watch;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub key: &'static str,
    pub used_pct: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<u64>,
    /// 횟수 기반 한도일 때
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    /// 모델 묶음별로 한도가 나뉘는 provider (Antigravity: "Gemini Models" 등)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
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
    vec![claude::read(), antigravity::cached(), codex()]
}

/// `force`면 Antigravity 한도를 지금 다시 읽고(약 5초), 아니면 캐시를 돌려주면서
/// 낡았을 때만 백그라운드에서 갱신한다 (끝나면 `limits://changed`).
#[tauri::command]
pub async fn limits_get(app: tauri::AppHandle, force: Option<bool>) -> Vec<LimitStatus> {
    if force.unwrap_or(false) {
        let _ = tauri::async_runtime::spawn_blocking(antigravity::refresh).await;
    } else {
        antigravity::refresh_if_stale(app);
    }
    get()
}
