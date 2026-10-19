//! statusline 브리지가 저장한 `limits/claude.json` ↔ `LimitStatus`.
//! 저장하는 필드는 `rate_limits`와 `session_id`뿐이다 (대화 내용 등은 버린다).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{LimitStatus, LimitWindow, limits_dir};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapWindow {
    pub used_pct: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub five_hour: Option<SnapWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seven_day: Option<SnapWindow>,
}

fn window(v: &Value, name: &str) -> Option<SnapWindow> {
    let w = v.get(name)?;
    let pct = w.get("used_percentage")?.as_f64()?;
    Some(SnapWindow {
        used_pct: pct.clamp(0.0, 100.0),
        resets_at: w.get("resets_at").and_then(Value::as_f64).map(|t| t as u64),
    })
}

/// statusline stdin JSON에서 한도 부분만 뽑는다. 한도 창이 하나도 없으면 `None`
/// (첫 응답 전 세션이 기존 스냅샷을 빈 값으로 덮어쓰지 않게).
pub fn snapshot_from_stdin(input: &str, now: u64) -> Option<Snapshot> {
    let v: Value = serde_json::from_str(input).ok()?;
    let rl = v.get("rate_limits")?;
    let five_hour = window(rl, "five_hour");
    let seven_day = window(rl, "seven_day");
    if five_hour.is_none() && seven_day.is_none() {
        return None;
    }
    Some(Snapshot {
        session_id: v
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        updated_at: now,
        five_hour,
        seven_day,
    })
}

fn path() -> Option<PathBuf> {
    limits_dir().map(|d| d.join("claude.json"))
}

/// 임시 파일에 쓰고 rename — 읽는 쪽이 반쯤 쓰인 파일을 보지 않게.
pub fn save_snapshot(snap: &Snapshot) -> std::io::Result<()> {
    let target = path().ok_or_else(|| std::io::Error::other("APPDATA 없음"))?;
    save_to(&target, snap)
}

fn save_to(target: &Path, snap: &Snapshot) -> std::io::Result<()> {
    let dir = target
        .parent()
        .ok_or_else(|| std::io::Error::other("경로 오류"))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("claude.json.{}.tmp", std::process::id()));
    let mut f = fs::File::create(&tmp)?;
    f.write_all(serde_json::to_string(snap)?.as_bytes())?;
    drop(f);
    fs::rename(&tmp, target).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn status_from(snap: Option<Snapshot>) -> LimitStatus {
    let Some(s) = snap else {
        return LimitStatus {
            provider: "claude",
            windows: vec![],
            source: "none",
            source_detail: "Claude Code statusline 연동 전 — 연결 후 첫 응답부터 표시됨".into(),
            updated_at: None,
        };
    };
    let mut windows = vec![];
    for (key, w) in [("5h", &s.five_hour), ("7d", &s.seven_day)] {
        if let Some(w) = w {
            windows.push(LimitWindow {
                key,
                used_pct: w.used_pct,
                resets_at: w.resets_at,
                used: None,
                limit: None,
            });
        }
    }
    LimitStatus {
        provider: "claude",
        windows,
        source: "official",
        source_detail: "Claude Code statusline 연동".into(),
        updated_at: Some(s.updated_at),
    }
}

pub fn read() -> LimitStatus {
    let snap = path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok());
    status_from(snap)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INPUT: &str = r#"{"session_id":"s1","transcript_path":"secret.jsonl","rate_limits":{
        "five_hour":{"used_percentage":23.5,"resets_at":1800000000},
        "seven_day":{"used_percentage":41,"resets_at":1800500000}}}"#;

    #[test]
    fn extracts_only_rate_limits() {
        let s = snapshot_from_stdin(INPUT, 10).unwrap();
        assert_eq!(s.session_id.as_deref(), Some("s1"));
        assert_eq!(s.five_hour.as_ref().unwrap().used_pct, 23.5);
        assert_eq!(s.seven_day.as_ref().unwrap().resets_at, Some(1800500000));
        assert!(!serde_json::to_string(&s).unwrap().contains("secret"));
    }

    #[test]
    fn partial_window_is_kept() {
        let s = snapshot_from_stdin(r#"{"rate_limits":{"seven_day":{"used_percentage":5}}}"#, 1)
            .unwrap();
        assert!(s.five_hour.is_none());
        assert_eq!(status_from(Some(s)).windows.len(), 1);
    }

    #[test]
    fn no_limits_means_no_snapshot() {
        assert!(snapshot_from_stdin(r#"{"session_id":"x"}"#, 1).is_none());
        assert!(snapshot_from_stdin(r#"{"rate_limits":{}}"#, 1).is_none());
        assert!(snapshot_from_stdin("not json", 1).is_none());
    }

    #[test]
    fn save_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ladock-limits-{}", std::process::id()));
        let target = dir.join("claude.json");
        let s = snapshot_from_stdin(INPUT, 7).unwrap();
        save_to(&target, &s).unwrap();
        let back: Snapshot = serde_json::from_str(&fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(back, s);
        let st = status_from(Some(back));
        assert_eq!(st.source, "official");
        assert_eq!(st.windows[0].key, "5h");
        let _ = fs::remove_dir_all(dir);
    }
}
