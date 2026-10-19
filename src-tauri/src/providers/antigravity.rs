use std::time::Duration;

use super::{AuthState, ProviderStatus, env_path, find_exe, home, run};

/// `agy models`가 성공하면 로그인된 것으로 본다 (공식 CLI가 모델 목록을 내줌).
pub(super) fn detect() -> ProviderStatus {
    let known = [env_path("LOCALAPPDATA").map(|d| d.join(r"agy\bin\agy.exe"))];
    let Some(bin) = find_exe(&["agy.exe"], &known) else {
        return ProviderStatus::not_installed("antigravity", "antigravity.google 에서 agy 설치");
    };
    let mut s = ProviderStatus::installed_at("antigravity", &bin);
    let has_dir = home().is_some_and(|h| h.join(r".gemini\antigravity-cli").is_dir());

    match run(&bin, &["models"], Duration::from_secs(10)) {
        Some(r) if r.ok => {
            s.auth = AuthState::Subscription;
            s.evidence = "`agy models` 성공 → 로그인됨".into();
        }
        Some(r) if r.timed_out => {
            s.evidence = "`agy models`가 10초 안에 끝나지 않음 → 판별 못 함".into();
        }
        Some(_) => {
            s.auth = AuthState::LoggedOut;
            s.evidence = if has_dir {
                "`agy models` 실패 → 로그인 필요".into()
            } else {
                "~/.gemini/antigravity-cli 없음, `agy models` 실패 → 로그인 안 됨".into()
            };
        }
        None => s.evidence = "`agy`를 실행하지 못함".into(),
    }
    s
}
