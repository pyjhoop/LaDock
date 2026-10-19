use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::{AuthState, ProviderStatus, api_key_warning, env_path, find_exe, home};

const CRED: &str = ".claude/.credentials.json";

pub(super) struct Cred {
    pub plan: Option<String>,
    pub expires_at_ms: Option<u64>,
}

/// `claudeAiOauth`에서 구독 종류와 만료 시각만 꺼낸다. 토큰 필드는 건드리지 않는다.
pub(super) fn parse_cred(text: &str) -> Option<Cred> {
    let v: Value = serde_json::from_str(text).ok()?;
    let o = v.get("claudeAiOauth")?;
    Some(Cred {
        plan: o
            .get("subscriptionType")
            .and_then(Value::as_str)
            .map(str::to_lowercase),
        expires_at_ms: o.get("expiresAt").and_then(Value::as_u64),
    })
}

pub(super) fn detect() -> ProviderStatus {
    let known = [
        home().map(|h| h.join(r".local\bin\claude.exe")),
        env_path("APPDATA").map(|d| d.join(r"npm\claude.cmd")),
    ];
    let Some(bin) = find_exe(&["claude.exe", "claude.cmd"], &known) else {
        return ProviderStatus::not_installed("claude", "npm i -g @anthropic-ai/claude-code");
    };
    let mut s = ProviderStatus::installed_at("claude", &bin);
    api_key_warning("ANTHROPIC_API_KEY", &mut s);

    let path = home().map(|h| h.join(CRED));
    match path.and_then(|p| std::fs::read_to_string(p).ok()) {
        None => {
            s.auth = AuthState::LoggedOut;
            s.evidence = format!("~/{CRED} 없음 → 로그인 안 됨");
        }
        Some(text) => match parse_cred(&text) {
            Some(Cred {
                plan: Some(plan),
                expires_at_ms,
            }) => {
                s.auth = AuthState::Subscription;
                s.evidence = format!("~/{CRED}: subscriptionType = {plan}");
                // 접근 토큰은 CLI가 알아서 갱신하므로 만료는 참고만 한다.
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                if expires_at_ms.is_some_and(|e| e < now_ms) {
                    s.evidence.push_str(" (접근 토큰 만료 — 다음 실행 때 갱신)");
                }
                s.plan = Some(plan);
            }
            Some(_) => s.evidence = format!("~/{CRED}에 subscriptionType이 없음"),
            None => s.evidence = format!("~/{CRED}를 읽을 수 없음 (형식이 다름)"),
        },
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plan_and_expiry_only() {
        let c = parse_cred(
            r#"{"claudeAiOauth":{"accessToken":"sk-ant-SECRET","refreshToken":"R","expiresAt":123,"subscriptionType":"Pro","rateLimitTier":"x"}}"#,
        )
        .unwrap();
        assert_eq!(c.plan.as_deref(), Some("pro"));
        assert_eq!(c.expires_at_ms, Some(123));
    }

    #[test]
    fn missing_or_broken_gives_none() {
        assert!(parse_cred("{}").is_none());
        assert!(parse_cred("not json").is_none());
    }
}
