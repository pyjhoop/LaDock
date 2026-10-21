mod agent_detect;
mod bridge;
mod limits;
mod notify;
mod panes;
mod persist;
mod providers;
mod pty;
mod pty_ipc;
mod remote;
mod shells;
mod skills;
mod task_run;
#[cfg(test)]
mod watch_e2e;

pub use bridge::CLI_ARG as BRIDGE_CLI_ARG;

/// `ladock.exe statusline-bridge` — 창 없이 statusline 입력을 처리한다.
pub fn run_bridge_cli() -> i32 {
    bridge::run_cli()
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "LaDock 열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("LaDock")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
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
            panes::clear_stale();
            skills::install_background();
            remote::Remote::start_background(app.handle().clone());
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 닫기는 종료가 아니라 트레이로 숨김 — pane의 프로세스는 계속 돈다.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .manage(pty_ipc::PtyRegistry::default())
        .manage(task_run::TaskRuns::default())
        .manage(remote::Hub::default())
        .manage(remote::Remote::default())
        .invoke_handler(tauri::generate_handler![
            pty_ipc::pty_spawn,
            pty_ipc::pty_write,
            pty_ipc::pty_resize,
            pty_ipc::pty_kill,
            pty_ipc::pty_ack,
            pty_ipc::pty_detect_agents,
            remote::remote_status,
            remote::remote_set_enabled,
            remote::remote_set_https,
            remote::remote_regenerate_token,
            remote::remote_set_layout,
            remote::remote_rpc_reply,
            panes::pane_dump,
            panes::panes_index,
            skills::skills_install,
            notify::notify_agent_done,
            shells::shells_detect,
            providers::providers_detect,
            limits::limits_get,
            persist::state_load,
            persist::state_save,
            persist::state_quarantine,
            persist::dirs_exist,
            persist::settings_load,
            persist::settings_save,
            persist::tasks_load,
            persist::tasks_save,
            persist::task_history_load,
            persist::task_history_save,
            task_run::task_run_start,
            task_run::task_run_kill,
            task_run::task_log_read,
            task_run::task_log_delete,
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
                app.state::<task_run::TaskRuns>().kill_all();
                app.state::<remote::Remote>()
                    .shutdown(&app.state::<remote::Hub>());
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
