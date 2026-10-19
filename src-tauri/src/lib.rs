mod pty;
mod pty_ipc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty_ipc::PtyRegistry::default())
        .invoke_handler(tauri::generate_handler![
            pty_ipc::pty_spawn,
            pty_ipc::pty_write,
            pty_ipc::pty_resize,
            pty_ipc::pty_kill,
            pty_ipc::pty_ack
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
