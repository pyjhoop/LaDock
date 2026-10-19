//! 윈도우 토스트 알림. 눌렀을 때 창을 앞으로 가져오고 프론트에 pane id를 알린다.

#[tauri::command]
pub fn notify_agent_done(app: tauri::AppHandle, pane_id: String, title: String, body: String) {
    #[cfg(windows)]
    {
        use tauri::Emitter;
        use tauri_winrt_notification::Toast;

        // 설치하지 않은 dev 실행은 등록된 앱 ID가 없어 PowerShell ID를 빌려 쓴다.
        let app_id = if cfg!(debug_assertions) {
            Toast::POWERSHELL_APP_ID
        } else {
            "com.laoh.ladock"
        };
        let handle = app.clone();
        let target = pane_id.clone();
        let shown = Toast::new(app_id)
            .title(&title)
            .text1(&body)
            .on_activated(move |_| {
                crate::show_main_window(&handle);
                let _ = handle.emit("notify://activate", &target);
                Ok(())
            })
            .show();
        if let Err(e) = shown {
            eprintln!("알림 표시 실패: {e}");
        }
    }
    #[cfg(not(windows))]
    let _ = (app, pane_id, title, body);
}
