use std::time::Duration;

use serde_json::Value;

use super::{AuthState, ProviderStatus, api_key_warning, env_path, find_exe, home, run};

/// `auth_mode`만 읽는다 (`chatgpt` = 구독, `apikey` = API).
pub(super) fn parse_auth_mode(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    v.get("auth_mode").and_then(Value::as_str).map(String::from)
}

pub(super) fn detect() -> ProviderStatus {
    let known = [env_path("APPDATA").map(|d| d.join(r"npm\codex.cmd"))];
    let Some(bin) = find_exe(&["codex.cmd", "codex.exe"], &known) else {
        return ProviderStatus::not_installed("codex", "npm i -g @openai/codex");
    };
    let mut s = ProviderStatus::installed_at("codex", &bin);
    api_key_warning("OPENAI_API_KEY", &mut s);

    let mode = home()
        .and_then(|h| std::fs::read_to_string(h.join(".codex/auth.json")).ok())
        .and_then(|t| parse_auth_mode(&t));
    match mode.as_deref() {
        Some("chatgpt") => {
            s.auth = AuthState::Subscription;
            s.evidence = "~/.codex/auth.json: auth_mode = chatgpt".into();
        }
        Some("apikey") => {
            s.auth = AuthState::ApiKey;
            s.evidence = "~/.codex/auth.json: auth_mode = apikey → API 과금".into();
        }
        Some(m) => s.evidence = format!("~/.codex/auth.json: 알 수 없는 auth_mode = {m}"),
        None => match run(&bin, &["login", "status"], Duration::from_secs(5)) {
            Some(r) if r.ok => {
                s.evidence = "`codex login status` 성공, auth.json에서 방식을 못 읽음".into();
            }
            _ => {
                s.auth = AuthState::LoggedOut;
                s.evidence = "~/.codex/auth.json 없음 → 로그인 안 됨".into();
            }
        },
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_auth_mode_only() {
        let t = r#"{"auth_mode":"chatgpt","tokens":{"id_token":"SECRET"}}"#;
        assert_eq!(parse_auth_mode(t).as_deref(), Some("chatgpt"));
        assert_eq!(parse_auth_mode("{}"), None);
    }
}
