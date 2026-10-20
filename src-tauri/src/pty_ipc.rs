//! `pty_*` IPC 명령 어댑터. 코어는 `pty.rs`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::pty::{PaneId, PtyHandle, SpawnOptions};
use crate::remote::Hub;

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

    /// 모바일 원격 입력용 (이미 닫힌 pane이면 오류).
    pub fn write(&self, id: PaneId, data: &[u8]) -> Result<(), String> {
        self.get(id)?.write(data)
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
    /// true면 command를 프로필 셸 안에서 실행해 command가 끝나도 셸이 남는다.
    #[serde(default)]
    pub keep_shell: bool,
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
    let (command, spawn_args) = match args.command {
        Some(c) => match args.keep_shell {
            true => {
                crate::shells::wrap_in_shell(&args.profile_id, &c, &args.args.unwrap_or_default())
            }
            false => (c, args.args.unwrap_or_default()),
        },
        None => {
            let (c, profile_args) = crate::shells::resolve(&args.profile_id);
            (c, args.args.unwrap_or(profile_args))
        }
    };
    let opts = SpawnOptions {
        command,
        args: spawn_args,
        cwd: args.cwd.map(PathBuf::from),
        cols: args.cols,
        rows: args.rows,
        env_remove: args.env_remove,
    };
    let (hub_app, err_app) = (app.clone(), app.clone());
    app.state::<Hub>().open(pane_id, opts.cols, opts.rows);
    let handle = PtyHandle::spawn(
        opts,
        move |data| {
            hub_app.state::<Hub>().output(pane_id, &data);
            let _ = on_data.send(InvokeResponseBody::Raw(data));
        },
        move |code| {
            app.state::<Hub>().exited(pane_id, code);
            let _ = app.emit("pty://exit", ExitEvent { pane_id, code });
        },
    )
    .inspect_err(|_| err_app.state::<Hub>().close(pane_id))?;
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
    hub: State<'_, Hub>,
    pane_id: PaneId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.get(pane_id)?.resize(cols, rows)?;
    hub.resized(pane_id, cols, rows);
    Ok(())
}

#[tauri::command]
pub fn pty_kill(
    registry: State<'_, PtyRegistry>,
    hub: State<'_, Hub>,
    pane_id: PaneId,
) -> Result<(), String> {
    if let Some(h) = registry.panes.lock().unwrap().remove(&pane_id) {
        h.kill();
    }
    hub.close(pane_id);
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

/// 각 pane의 셸 아래에서 실행 중인 AI CLI. pane id → provider id (없으면 빠진다).
#[tauri::command]
pub fn pty_detect_agents(
    registry: State<'_, PtyRegistry>,
    pane_ids: Vec<PaneId>,
) -> HashMap<PaneId, &'static str> {
    let roots: Vec<(PaneId, u32)> = pane_ids
        .into_iter()
        .filter_map(|id| Some((id, registry.get(id).ok()?.pid()?)))
        .collect();
    crate::agent_detect::running_agents(&roots)
}
