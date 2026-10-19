use serde_json::Value;

use super::{AuthState, ProviderStatus, api_key_warning, env_path, find_exe, home};

/// `security.auth.selectedType`만 읽는다.
pub(super) fn parse_selected_type(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    v.pointer("/security/auth/selectedType")
        .and_then(Value::as_str)
        .map(String::from)
}

/// `google_accounts.json`의 활성 계정(이메일)만 읽는다.
pub(super) fn parse_active_account(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    v.get("active").and_then(Value::as_str).map(String::from)
}

pub(super) fn detect() -> ProviderStatus {
    let known = [env_path("APPDATA").map(|d| d.join(r"npm\gemini.cmd"))];
    let Some(bin) = find_exe(&["gemini.cmd", "gemini.exe"], &known) else {
        return ProviderStatus::not_installed("gemini", "npm i -g @google/gemini-cli");
    };
    let mut s = ProviderStatus::installed_at("gemini", &bin);
    api_key_warning("GEMINI_API_KEY", &mut s);

    let dir = home().map(|h| h.join(".gemini"));
    let read = |name: &str| {
        dir.as_ref()
            .and_then(|d| std::fs::read_to_string(d.join(name)).ok())
    };
    let has_oauth = dir
        .as_ref()
        .is_some_and(|d| d.join("oauth_creds.json").is_file());
    let selected = read("settings.json").and_then(|t| parse_selected_type(&t));

    match selected.as_deref() {
        Some("oauth-personal") if has_oauth => {
            s.auth = AuthState::Subscription;
            s.account = read("google_accounts.json").and_then(|t| parse_active_account(&t));
            s.evidence =
                "~/.gemini/settings.json: selectedType = oauth-personal, oauth_creds.json 있음"
                    .into();
        }
        Some("oauth-personal") => {
            s.auth = AuthState::LoggedOut;
            s.evidence = "~/.gemini/oauth_creds.json 없음 → Google 로그인 안 됨".into();
        }
        Some(t @ ("gemini-api-key" | "vertex-ai")) => {
            s.auth = AuthState::ApiKey;
            s.evidence = format!("~/.gemini/settings.json: selectedType = {t} → API 과금");
        }
        Some(t) => s.evidence = format!("~/.gemini/settings.json: 알 수 없는 selectedType = {t}"),
        None if has_oauth => {
            s.evidence = "~/.gemini/oauth_creds.json은 있지만 selectedType이 없음".into();
        }
        None => {
            s.auth = AuthState::LoggedOut;
            s.evidence = "~/.gemini/settings.json에 인증 방식이 없음 → 로그인 안 됨".into();
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_selected_type() {
        let t = r#"{"security":{"auth":{"selectedType":"oauth-personal"}},"x":1}"#;
        assert_eq!(parse_selected_type(t).as_deref(), Some("oauth-personal"));
        assert_eq!(parse_selected_type("{}"), None);
    }

    #[test]
    fn reads_active_account() {
        let t = r#"{"active":"a@b.c","old":[]}"#;
        assert_eq!(parse_active_account(t).as_deref(), Some("a@b.c"));
    }
}
