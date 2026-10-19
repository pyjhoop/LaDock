//! 파일 감시 → 이벤트 확인. 실제 `notify` 감시와 `emit`을 mock 앱으로 돌린다.
//! 임시 홈에서만 돈다: `USERPROFILE`/`APPDATA`를 `...e2e...` 경로로 지정하고
//! 빌드된 테스트 exe를 `--ignored`로 직접 실행한다.

use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{limits, providers};

type Log = Arc<Mutex<Vec<String>>>;

/// 감시 스레드가 보내는 이벤트(JSON)를 `log`에 모으는 emit 함수.
fn sink(log: &Log) -> impl Fn(&str, serde_json::Value) + Send + 'static + use<> {
    let l = log.clone();
    move |_name, payload| l.lock().unwrap().push(payload.to_string())
}

fn wait_for(log: &Log, from: usize, secs: u64, pred: impl Fn(&str) -> bool) -> Option<String> {
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end {
        if let Some(hit) = log.lock().unwrap().iter().skip(from).find(|p| pred(p)) {
            return Some(hit.clone());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

fn cred(plan: &str) -> String {
    format!(
        r#"{{"claudeAiOauth":{{"accessToken":"FAKE","refreshToken":"FAKE","expiresAt":9999999999999,"subscriptionType":"{plan}"}}}}"#
    )
}

fn snap(a: u32, b: u32) -> String {
    format!(
        r#"{{"sessionId":"s","updatedAt":1,"fiveHour":{{"usedPct":{a},"resetsAt":9999999999}},"sevenDay":{{"usedPct":{b},"resetsAt":9999999999}}}}"#
    )
}

#[test]
#[ignore]
fn watchers_emit_events_in_temp_home() {
    let home = providers::home().unwrap();
    assert!(
        home.to_string_lossy().to_lowercase().contains("e2e"),
        "임시 홈이 아님"
    );
    let dot_claude = home.join(".claude");
    fs::create_dir_all(&dot_claude).unwrap();
    let cred_path = dot_claude.join(".credentials.json");
    fs::write(&cred_path, cred("pro")).unwrap();

    let (prov, lim): (Log, Log) = (Arc::default(), Arc::default());
    providers::watch(sink(&prov));
    limits::watch(sink(&lim));
    // providers 감시는 시작할 때 한 번 감지(agy 포함)를 돌린다 — 끝나기 전에 바꾸면 기준값에 섞인다.
    std::thread::sleep(Duration::from_secs(15));

    let limits_file = limits::limits_dir().unwrap().join("claude.json");
    let n = lim.lock().unwrap().len();
    let t = Instant::now();
    fs::write(&limits_file, snap(55, 66)).unwrap();
    let hit = wait_for(&lim, n, 5, |p| p.contains(r#""usedPct":55"#));
    println!(
        "claude.json 변경 → limits://changed: {:?} ({} ms)",
        hit.is_some(),
        t.elapsed().as_millis()
    );
    assert!(hit.is_some(), "limits://changed 없음");

    let n = prov.lock().unwrap().len();
    let t = Instant::now();
    fs::write(&cred_path, cred("max")).unwrap();
    let hit = wait_for(&prov, n, 10, |p| p.contains(r#""plan":"max""#));
    println!(
        "인증 파일 pro→max → providers://changed: {:?} ({} ms)",
        hit.is_some(),
        t.elapsed().as_millis()
    );
    assert!(hit.is_some(), "providers://changed(max) 없음");
    assert!(!hit.unwrap().contains("FAKE"), "토큰 값이 이벤트에 섞임");

    let n = prov.lock().unwrap().len();
    let t = Instant::now();
    fs::remove_file(&cred_path).unwrap();
    let hit = wait_for(&prov, n, 10, |p| p.contains(r#""auth":"logged_out""#));
    println!(
        "인증 파일 삭제 → providers://changed(logged_out): {:?} ({} ms)",
        hit.is_some(),
        t.elapsed().as_millis()
    );
    assert!(hit.is_some(), "providers://changed(logged_out) 없음");

    // 상태가 안 바뀌는 변경은 이벤트를 보내지 않는다.
    let n = prov.lock().unwrap().len();
    fs::write(dot_claude.join("settings.json"), r#"{"theme":"x"}"#).unwrap();
    std::thread::sleep(Duration::from_secs(4));
    assert_eq!(prov.lock().unwrap().len(), n, "상태 동일인데 이벤트가 옴");
    println!("OK");
}
