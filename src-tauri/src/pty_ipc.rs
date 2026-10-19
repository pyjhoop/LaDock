//! `pty_*` IPC 명령 어댑터. 코어는 `pty.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

use crate::pty::{PaneId, PtyHandle, SpawnOptions};

#[derive(Default)]
pub struct PtyRegistry {
    next: AtomicU32,
    panes: Mutex<HashMap<PaneId, Arc<PtyHandle>>>,
}

impl PtyRegistry {
    fn get(&self, id: PaneId) -> Result<Arc<PtyHandle>, String> {
        self.panes
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("pane {id} 없음"))
    }

    /// 앱 종료 시 전부 kill.
    pub fn kill_all(&self) {
        for (_, h) in self.panes.lock().unwrap().drain() {
            h.kill();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnArgs {
    pub profile_id: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub env_remove: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    pane_id: PaneId,
    code: i32,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    registry: State<'_, PtyRegistry>,
    args: SpawnArgs,
    on_data: Channel<InvokeResponseBody>,
) -> Result<PaneId, String> {
    let pane_id = registry.next.fetch_add(1, Ordering::Relaxed) + 1;
    // command가 없으면 프로필(감지된 셸)로 해석한다. 명시한 args가 프로필 기본 인자보다 우선.
    let (command, profile_args) = match args.command {
        Some(c) => (c, vec![]),
        None => crate::shells::resolve(&args.profile_id),
    };
    let opts = SpawnOptions {
        command,
        args: args.args.unwrap_or(profile_args),
        cwd: args.cwd.map(PathBuf::from),
        cols: args.cols,
        rows: args.rows,
        env_remove: args.env_remove,
    };
    let handle = PtyHandle::spawn(
        opts,
        move |data| {
            let _ = on_data.send(InvokeResponseBody::Raw(data));
        },
        move |code| {
            let _ = app.emit("pty://exit", ExitEvent { pane_id, code });
        },
    )?;
    registry
        .panes
        .lock()
        .unwrap()
        .insert(pane_id, Arc::new(handle));
    Ok(pane_id)
}

#[tauri::command]
pub fn pty_write(
    registry: State<'_, PtyRegistry>,
    pane_id: PaneId,
    data: Vec<u8>,
) -> Result<(), String> {
    registry.get(pane_id)?.write(&data)
}

#[tauri::command]
pub fn pty_resize(
    registry: State<'_, PtyRegistry>,
    pane_id: PaneId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.get(pane_id)?.resize(cols, rows)
}

#[tauri::command]
pub fn pty_kill(registry: State<'_, PtyRegistry>, pane_id: PaneId) -> Result<(), String> {
    if let Some(h) = registry.panes.lock().unwrap().remove(&pane_id) {
        h.kill();
    }
    Ok(())
}

/// 프론트가 xterm에 write를 끝낸 바이트 수. 흐름 제어용.
#[tauri::command]
pub fn pty_ack(
    registry: State<'_, PtyRegistry>,
    pane_id: PaneId,
    bytes: usize,
) -> Result<(), String> {
    if let Ok(h) = registry.get(pane_id) {
        h.ack(bytes);
    }
    Ok(())
}
