mod bridge;
mod limits;
mod persist;
mod providers;
mod pty;
mod pty_ipc;
mod shells;
#[cfg(test)]
mod watch_e2e;

pub use bridge::CLI_ARG as BRIDGE_CLI_ARG;

/// `ladock.exe statusline-bridge` — 창 없이 statusline 입력을 처리한다.
pub fn run_bridge_cli() -> i32 {
    bridge::run_cli()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            providers::start_watcher(app.handle().clone());
            limits::start_watcher(app.handle().clone());
            let bridge = bridge::status();
            if bridge.state == "stale" {
                use tauri::Emitter;
                let _ = app.emit("claude-bridge://changed", &bridge);
            }
            Ok(())
        })
        .manage(pty_ipc::PtyRegistry::default())
        .invoke_handler(tauri::generate_handler![
            pty_ipc::pty_spawn,
            pty_ipc::pty_write,
            pty_ipc::pty_resize,
            pty_ipc::pty_kill,
            pty_ipc::pty_ack,
            shells::shells_detect,
            providers::providers_detect,
            limits::limits_get,
            persist::state_load,
            persist::state_save,
            persist::state_quarantine,
            persist::dirs_exist,
            persist::settings_load,
            persist::settings_save,
            bridge::claude_bridge_status,
            bridge::claude_bridge_connect,
            bridge::claude_bridge_disconnect
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<pty_ipc::PtyRegistry>().kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn sanity() {
        assert_eq!(2 + 2, 4);
    }
}
