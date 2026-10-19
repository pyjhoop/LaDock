//! 인증 · 설정 파일이 바뀌면 다시 감지해서 `providers://changed`로 알린다.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use super::{ProviderStatus, detect, home};

const WATCH_DIRS: [&str; 3] = [".claude", ".gemini", ".codex"];
const WATCH_FILES: [&str; 5] = [
    ".credentials.json",
    "settings.json",
    "oauth_creds.json",
    "google_accounts.json",
    "auth.json",
];
const DEBOUNCE: Duration = Duration::from_millis(800);

fn relevant(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| WATCH_FILES.contains(&n))
}

fn is_hit(ev: notify::Result<notify::Event>) -> bool {
    ev.is_ok_and(|e| e.paths.iter().any(|p| relevant(p)))
}

fn same(a: &[ProviderStatus], b: &[ProviderStatus]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.same_state(y))
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(home) = home() else { return };
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => return eprintln!("[providers] 파일 감시 시작 실패: {e}"),
        };
        for d in WATCH_DIRS {
            let dir = home.join(d);
            if dir.is_dir()
                && let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive)
            {
                eprintln!("[providers] {} 감시 실패: {e}", dir.display());
            }
        }
        let mut last = detect();
        while let Ok(first) = rx.recv() {
            let mut hit = is_hit(first);
            // 짧은 시간에 몰린 변경은 한 번으로 합친다.
            while let Ok(ev) = rx.recv_timeout(DEBOUNCE) {
                hit |= is_hit(ev);
            }
            if !hit {
                continue;
            }
            let now = detect();
            if !same(&last, &now) {
                let _ = app.emit("providers://changed", &now);
                last = now;
            }
        }
    });
}
