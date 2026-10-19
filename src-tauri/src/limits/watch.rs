//! `limits/claude.json`이 바뀌면 `limits://changed`로 알린다.

use std::sync::mpsc;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use super::{get, limits_dir};

const DEBOUNCE: Duration = Duration::from_millis(200);

pub fn start_watcher(app: AppHandle) {
    watch(move |name, payload| {
        let _ = app.emit(name, payload);
    });
}

/// 감시 스레드를 시작한다. 이벤트는 `emit(이름, JSON)`으로 내보낸다 (테스트에서 바꿔 끼울 수 있게).
pub(crate) fn watch(emit: impl Fn(&str, serde_json::Value) + Send + 'static) {
    std::thread::spawn(move || {
        let Some(dir) = limits_dir() else { return };
        if let Err(e) = std::fs::create_dir_all(&dir) {
            return eprintln!("[limits] {} 만들기 실패: {e}", dir.display());
        }
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => return eprintln!("[limits] 파일 감시 시작 실패: {e}"),
        };
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            return eprintln!("[limits] {} 감시 실패: {e}", dir.display());
        }
        while rx.recv().is_ok() {
            while rx.recv_timeout(DEBOUNCE).is_ok() {}
            emit(
                "limits://changed",
                serde_json::to_value(get()).unwrap_or_default(),
            );
        }
    });
}
