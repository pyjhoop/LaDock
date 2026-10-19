//! Gemini CLI 일일 요청 추정. `~/.gemini/tmp/<project>/chats/session-*.json`에서
//! 오늘(로컬 날짜) 받은 모델 응답(`tokens`가 있는 메시지) 수를 세어 플랜 한도로 나눈다.
//! 공식 수치가 아니므로 `source: "estimate"`.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::{LimitStatus, LimitWindow, app_dir};

const DEFAULT_LIMIT: u64 = 1000;
const DAY: u64 = 86_400;

/// 설정의 `geminiPlan` 값 → (이름, 일일 한도). 설정 UI는 M3-02, 지금은 파일을 직접 고친다.
fn plan_limit(plan: Option<&str>) -> (&'static str, u64) {
    match plan {
        Some("pro") => ("Google AI Pro", 1500),
        Some("ultra") => ("Google AI Ultra", 2000),
        Some("apikey") => ("API 키 무료 등급", 250),
        _ => ("개인 무료", DEFAULT_LIMIT),
    }
}

fn configured_plan() -> Option<String> {
    let text = fs::read_to_string(app_dir()?.join("settings.json")).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    v.get("geminiPlan")?.as_str().map(str::to_owned)
}

/// 로컬 시간대의 UTC 오프셋(초, 동쪽이 +). 알 수 없으면 0.
#[cfg(windows)]
fn local_offset_secs() -> i64 {
    #[repr(C)]
    struct Tzi {
        bias: i32,
        standard_name: [u16; 32],
        standard_date: [u16; 8],
        standard_bias: i32,
        daylight_name: [u16; 32],
        daylight_date: [u16; 8],
        daylight_bias: i32,
    }
    unsafe extern "system" {
        fn GetTimeZoneInformation(info: *mut Tzi) -> u32;
    }
    let mut tzi = Tzi {
        bias: 0,
        standard_name: [0; 32],
        standard_date: [0; 8],
        standard_bias: 0,
        daylight_name: [0; 32],
        daylight_date: [0; 8],
        daylight_bias: 0,
    };
    // SAFETY: 크기와 레이아웃이 TIME_ZONE_INFORMATION과 같은 구조체를 넘긴다.
    let kind = unsafe { GetTimeZoneInformation(&mut tzi) };
    let extra = match kind {
        1 => tzi.standard_bias,
        2 => tzi.daylight_bias,
        _ => 0,
    };
    -((tzi.bias + extra) as i64) * 60
}

#[cfg(not(windows))]
fn local_offset_secs() -> i64 {
    0
}

/// `2026-03-19T00:21:47.348Z` → unix 초. 형식이 다르면 None.
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

/// `[start, start + DAY)`에 든 모델 응답 수.
fn count_in_session(text: &str, start: u64) -> u64 {
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return 0;
    };
    let Some(msgs) = v.get("messages").and_then(Value::as_array) else {
        return 0;
    };
    msgs.iter()
        .filter(|m| m.get("tokens").is_some())
        .filter_map(|m| parse_iso_utc(m.get("timestamp")?.as_str()?))
        .filter(|t| (start..start + DAY).contains(t))
        .count() as u64
}

/// 오늘 이후 수정된 세션 파일만 읽는다.
fn count_today(gemini_tmp: &Path, start: u64) -> u64 {
    let since = UNIX_EPOCH + Duration::from_secs(start);
    let Ok(projects) = fs::read_dir(gemini_tmp) else {
        return 0;
    };
    let mut total = 0;
    for p in projects.flatten() {
        let Ok(chats) = fs::read_dir(p.path().join("chats")) else {
            continue;
        };
        for f in chats.flatten() {
            let path = f.path();
            let is_session = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("session-") && n.ends_with(".json"));
            let fresh = f
                .metadata()
                .and_then(|m| m.modified())
                .is_ok_and(|t| t >= since);
            if is_session
                && fresh
                && let Ok(text) = fs::read_to_string(&path)
            {
                total += count_in_session(&text, start);
            }
        }
    }
    total
}

fn status(count: u64, plan: &str, limit: u64, now: u64) -> LimitStatus {
    LimitStatus {
        provider: "gemini",
        windows: vec![LimitWindow {
            key: "1d",
            used_pct: (count as f64 / limit as f64 * 100.0).min(100.0),
            resets_at: None,
            used: Some(count),
            limit: Some(limit),
        }],
        source: "estimate",
        source_detail: format!("추정 — 오늘 요청 {count}회 ÷ {limit}회 ({plan}), 리셋 시각 미확인"),
        updated_at: Some(now),
    }
}

pub fn read() -> LimitStatus {
    let none = |detail: &str| LimitStatus {
        provider: "gemini",
        windows: vec![],
        source: "none",
        source_detail: detail.into(),
        updated_at: None,
    };
    let Some(tmp) = crate::providers::home().map(|h| h.join(r".gemini\tmp")) else {
        return none("사용자 폴더를 찾지 못함");
    };
    if !tmp.is_dir() {
        return none("~/.gemini/tmp 없음 — 아직 사용 기록이 없어요");
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let off = local_offset_secs();
    let local_midnight =
        ((now as i64 + off).div_euclid(DAY as i64) * DAY as i64 - off).max(0) as u64;
    let (plan, limit) = plan_limit(configured_plan().as_deref());
    status(count_today(&tmp, local_midnight), plan, limit, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iso() {
        assert_eq!(parse_iso_utc("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_iso_utc("2026-03-19T00:21:47.348Z"),
            Some(1_773_879_707)
        );
        assert_eq!(parse_iso_utc("nope"), None);
    }

    #[test]
    fn counts_only_model_replies_today() {
        let start = parse_iso_utc("2026-03-19T00:00:00Z").unwrap();
        let text = r#"{"messages":[
            {"type":"user","timestamp":"2026-03-19T00:21:39.047Z"},
            {"type":"gemini","timestamp":"2026-03-19T00:21:47.348Z","tokens":{"total":1}},
            {"type":"gemini","timestamp":"2026-03-18T23:59:59.000Z","tokens":{"total":1}},
            {"type":"gemini","timestamp":"2026-03-19T09:00:00.000Z","tokens":{"total":1}}]}"#;
        assert_eq!(count_in_session(text, start), 2);
        assert_eq!(count_in_session("garbage", start), 0);
    }

    #[test]
    fn percent_is_capped_and_labeled_estimate() {
        let s = status(1200, "개인 무료", 1000, 5);
        assert_eq!(s.source, "estimate");
        assert_eq!(s.windows[0].used_pct, 100.0);
        assert_eq!(s.windows[0].used, Some(1200));
        assert!(s.source_detail.starts_with("추정"));
    }

    #[test]
    fn plan_defaults_to_free() {
        assert_eq!(plan_limit(None).1, 1000);
        assert_eq!(plan_limit(Some("pro")).1, 1500);
    }

    /// 이 PC의 실제 기록으로 돌려 본다 (값은 날마다 달라 출력만 한다).
    #[test]
    fn reads_real_sessions() {
        let s = read();
        eprintln!("{} / {:?}", s.source_detail, s.windows);
    }
}
