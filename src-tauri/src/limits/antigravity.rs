//! Antigravity 한도. 공식 CLI의 `agy -p "/usage" --output-format json`을 실행해서 읽는다
//! (모델 호출 없이 5시간 · 주간 한도를 내줌, 약 5초). 인증 파일은 건드리지 않는다.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::{LimitStatus, LimitWindow, none};
use crate::providers::antigravity::find_bin;
use crate::providers::{now_secs, run};

const TTL: Duration = Duration::from_secs(60);
const TIMEOUT: Duration = Duration::from_secs(30);

static CACHE: Mutex<Option<(Instant, LimitStatus)>> = Mutex::new(None);
static REFRESHING: AtomicBool = AtomicBool::new(false);

/// 지금까지 읽어 둔 값. 아직 한 번도 못 읽었으면 "확인 중".
pub fn cached() -> LimitStatus {
    CACHE
        .lock()
        .ok()
        .and_then(|c| c.as_ref().map(|(_, s)| s.clone()))
        .unwrap_or_else(|| none("antigravity", "확인 중…"))
}

fn is_stale() -> bool {
    CACHE
        .lock()
        .ok()
        .is_none_or(|c| c.as_ref().is_none_or(|(at, _)| at.elapsed() >= TTL))
}

/// 낡았으면 별도 스레드에서 갱신하고 끝나면 `limits://changed`를 보낸다.
pub fn refresh_if_stale(app: AppHandle) {
    if !is_stale() || REFRESHING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        refresh();
        let _ = app.emit("limits://changed", super::get());
    });
}

/// `agy`를 실행해서 캐시를 갱신한다 (블로킹).
pub fn refresh() {
    REFRESHING.store(true, Ordering::Release);
    let status = read();
    if let Ok(mut c) = CACHE.lock() {
        *c = Some((Instant::now(), status));
    }
    REFRESHING.store(false, Ordering::Release);
}

fn read() -> LimitStatus {
    let Some(bin) = find_bin() else {
        return none("antigravity", "Antigravity 미설치");
    };
    let args = ["-p", "/usage", "--output-format", "json"];
    let Some(r) = run(&bin, &args, TIMEOUT) else {
        return none("antigravity", "`agy`를 실행하지 못함");
    };
    if r.timed_out {
        return none("antigravity", "`agy /usage`가 30초 안에 끝나지 않음");
    }
    match parse(&r.out) {
        Some(windows) if !windows.is_empty() => LimitStatus {
            provider: "antigravity",
            windows,
            source: "official",
            source_detail: "agy /usage".into(),
            updated_at: Some(now_secs()),
        },
        _ => none(
            "antigravity",
            "`agy /usage` 응답에 한도 정보가 없음 (로그인 필요?)",
        ),
    }
}

/// `agy -p "/usage" --output-format json` 출력 → 창 목록 (모델 묶음마다 5시간 · 주간).
fn parse(out: &str) -> Option<Vec<LimitWindow>> {
    let json = &out[out.find('{')?..];
    let v: Value = serde_json::from_str(json.trim()).ok()?;
    let groups = v.pointer("/command/data/groups")?.as_array()?;
    let mut windows = vec![];
    for g in groups {
        let name = g.get("name").and_then(Value::as_str).map(String::from);
        let start = windows.len();
        for b in g.get("buckets")?.as_array()? {
            let key = match b.get("window").and_then(Value::as_str) {
                Some("5h") => "5h",
                Some("weekly") => "7d",
                _ => continue,
            };
            let Some(remaining) = b.get("remaining_fraction").and_then(Value::as_f64) else {
                continue;
            };
            windows.push(LimitWindow {
                key,
                used_pct: ((1.0 - remaining) * 100.0).clamp(0.0, 100.0),
                resets_at: b
                    .get("reset_time")
                    .and_then(Value::as_str)
                    .and_then(parse_iso_utc),
                used: None,
                limit: None,
                group: name.clone(),
            });
        }
        windows[start..].sort_by_key(|w| w.key != "5h"); // 5시간 먼저
    }
    Some(windows)
}

/// `2026-10-26T03:11:48Z` → unix 초. 형식이 다르면 None.
fn parse_iso_utc(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hh, mm, ss) = (num(11..13)?, num(14..16)?, num(17..19)?);
    // days from civil (Howard Hinnant)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + hh * 3600 + mm * 60 + ss).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"status":"SUCCESS","command":{"name":"usage","data":{"groups":[
      {"name":"Gemini Models","buckets":[
        {"window":"weekly","remaining_fraction":0.75,"reset_time":"2026-10-26T03:11:48Z"},
        {"window":"5h","remaining_fraction":0.9,"reset_time":"2026-10-19T08:11:48Z"}]},
      {"name":"Claude and GPT models","buckets":[
        {"window":"5h","remaining_fraction":1,"reset_time":"2026-10-19T08:12:57Z"}]}]}}}"#;

    #[test]
    fn parses_groups_and_windows() {
        let w = parse(SAMPLE).unwrap();
        assert_eq!(w.len(), 3);
        assert_eq!(w[0].key, "5h");
        assert!((w[0].used_pct - 10.0).abs() < 1e-9);
        assert_eq!(w[0].group.as_deref(), Some("Gemini Models"));
        assert_eq!((w[1].key, w[1].used_pct), ("7d", 25.0));
        assert_eq!(w[2].used_pct, 0.0);
    }

    #[test]
    fn ignores_noise_before_json_and_bad_input() {
        assert!(parse(&format!("warn: x\n{SAMPLE}")).is_some());
        assert!(parse("로그인 필요").is_none());
        assert!(parse("{}").is_none());
    }

    /// 실제 `agy`가 설치된 PC에서만: `cargo test live_read -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_read() {
        let s = read();
        println!("{s:#?}");
        assert_eq!(s.source, "official");
    }

    #[test]
    fn iso_time_to_unix() {
        assert_eq!(parse_iso_utc("1970-01-02T00:00:01Z"), Some(86_401));
        assert_eq!(parse_iso_utc("2026-10-19T08:11:48Z"), Some(1_792_397_508));
        assert_eq!(parse_iso_utc("nope"), None);
    }
}
