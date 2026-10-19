//! AI CLI 감지. 인증 파일은 읽기 전용으로 열고 허용된 메타데이터 필드만 꺼낸다.
//! 토큰 값은 이 모듈 밖으로 나가지 않는다 (IPC · 로그 · 저장 모두).

mod antigravity;
mod claude;
mod codex;
mod gemini;
mod watch;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

pub use watch::start_watcher;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    Subscription,
    ApiKey,
    LoggedOut,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: &'static str,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bin_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub auth: AuthState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    pub evidence: String,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_hint: Option<String>,
    pub checked_at: u64,
}

impl ProviderStatus {
    fn new(id: &'static str) -> Self {
        Self {
            id,
            installed: false,
            bin_path: None,
            version: None,
            auth: AuthState::Unknown,
            plan: None,
            account: None,
            evidence: String::new(),
            warnings: vec![],
            install_hint: None,
            checked_at: now_secs(),
        }
    }

    fn installed_at(id: &'static str, bin: &Path) -> Self {
        let mut s = Self::new(id);
        s.installed = true;
        s.bin_path = Some(bin.to_string_lossy().into_owned());
        s.version = version_of(bin);
        s
    }

    fn not_installed(id: &'static str, hint: &str) -> Self {
        let mut s = Self::new(id);
        s.evidence = "설치되어 있지 않음".into();
        s.install_hint = Some(hint.into());
        s
    }

    /// 변경 감지용 — 검사 시각만 다른 결과는 같은 상태로 본다.
    fn same_state(&self, other: &Self) -> bool {
        let mut a = self.clone();
        a.checked_at = other.checked_at;
        a == *other
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub(crate) fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

fn env_set(var: &str) -> bool {
    std::env::var_os(var).is_some_and(|v| !v.is_empty())
}

fn api_key_warning(var: &str, status: &mut ProviderStatus) {
    if env_set(var) {
        status
            .warnings
            .push(format!("{var} 환경변수가 설정됨 → API 과금 가능"));
    }
}

/// PATH에서 먼저 찾고, 없으면 알려진 경로를 본다.
fn find_exe(names: &[&str], known: &[Option<PathBuf>]) -> Option<PathBuf> {
    let path_hit = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|d| names.iter().map(move |n| d.join(n)))
            .find(|p| p.is_file())
    });
    path_hit.or_else(|| known.iter().flatten().find(|p| p.is_file()).cloned())
}

struct RunResult {
    ok: bool,
    timed_out: bool,
    out: String,
}

/// 창 없이 실행하고 타임아웃이 지나면 죽인다. 실행 자체가 안 되면 None.
fn run(bin: &Path, args: &[&str], timeout: Duration) -> Option<RunResult> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let mut stderr = child.stderr.take()?;
    let out_t = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_t = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + timeout;
    let (ok, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(st)) => break (st.success(), false),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break (false, true);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break (false, false),
        }
    };
    let mut out = out_t.join().unwrap_or_default();
    out.push_str(&err_t.join().unwrap_or_default());
    Some(RunResult { ok, timed_out, out })
}

/// `--version` 출력에서 처음 나오는 숫자로 시작하는 토큰.
fn parse_version(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|t| t.trim_start_matches('v'))
        .find(|t| t.starts_with(|c: char| c.is_ascii_digit()))
        .map(String::from)
}

fn version_of(bin: &Path) -> Option<String> {
    let r = run(bin, &["--version"], Duration::from_secs(5))?;
    r.ok.then(|| parse_version(&r.out)).flatten()
}

pub fn detect() -> Vec<ProviderStatus> {
    // agy models, gemini 기동이 느려서 병렬로 돌린다.
    std::thread::scope(|s| {
        let tasks = [
            s.spawn(claude::detect),
            s.spawn(codex::detect),
            s.spawn(gemini::detect),
            s.spawn(antigravity::detect),
        ];
        tasks.into_iter().filter_map(|t| t.join().ok()).collect()
    })
}

#[tauri::command]
pub async fn providers_detect() -> Vec<ProviderStatus> {
    tauri::async_runtime::spawn_blocking(detect)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_tokens() {
        assert_eq!(
            parse_version("2.1.303 (Claude Code)\n").as_deref(),
            Some("2.1.303")
        );
        assert_eq!(parse_version("1.4.2").as_deref(), Some("1.4.2"));
        assert_eq!(parse_version("codex-cli v0.9.1").as_deref(), Some("0.9.1"));
        assert_eq!(parse_version("error"), None);
    }

    #[test]
    fn serializes_to_ipc_shape() {
        let mut s = ProviderStatus::not_installed("codex", "npm i -g @openai/codex");
        s.auth = AuthState::LoggedOut;
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["id"], "codex");
        assert_eq!(v["auth"], "logged_out");
        assert_eq!(v["installHint"], "npm i -g @openai/codex");
        assert!(v.get("binPath").is_none());
    }

    #[test]
    fn same_state_ignores_checked_at() {
        let a = ProviderStatus::new("claude");
        let mut b = a.clone();
        b.checked_at += 99;
        assert!(a.same_state(&b));
        b.auth = AuthState::LoggedOut;
        assert!(!a.same_state(&b));
    }

    /// 실제 인증 파일의 토큰 값이 IPC 응답에 섞이지 않는다.
    #[test]
    fn ipc_output_has_no_token_values() {
        let out = serde_json::to_string(&detect()).unwrap();
        let Some(h) = home() else { return };
        let files = [
            h.join(".claude/.credentials.json"),
            h.join(".gemini/oauth_creds.json"),
            h.join(".codex/auth.json"),
        ];
        let mut checked = 0;
        for f in files {
            let Ok(text) = std::fs::read_to_string(f) else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            let mut stack = vec![&v];
            while let Some(n) = stack.pop() {
                match n {
                    serde_json::Value::Object(m) => {
                        for (k, c) in m {
                            if let Some(s) = c.as_str()
                                && k.to_lowercase().contains("token")
                                && s.len() > 16
                            {
                                checked += 1;
                                assert!(!out.contains(s), "토큰 값이 응답에 있음");
                            }
                            stack.push(c);
                        }
                    }
                    serde_json::Value::Array(a) => stack.extend(a),
                    _ => {}
                }
            }
        }
        eprintln!("토큰 {checked}개 대조");
    }
}
