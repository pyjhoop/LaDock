use super::*;
use std::sync::mpsc::channel;

const WAIT: Duration = Duration::from_secs(20);

fn pwsh(script: &str) -> SpawnOptions {
    SpawnOptions {
        command: "pwsh.exe".into(),
        args: vec!["-NoProfile".into(), "-Command".into(), script.into()],
        cols: 100,
        rows: 30,
        ..Default::default()
    }
}

/// ConPTY는 시작 시 커서 위치 질의(ESC[6n)를 보내고 응답을 기다린다. xterm.js가 하는 일을 흉내낸다.
fn answer_dsr(h: &PtyHandle, d: &[u8]) {
    if d.windows(4).any(|w| w == b"[6n") {
        h.write(b"[1;1R").unwrap();
    }
}

/// 실행하고 (전체 출력, 종료 코드)를 돌려준다. 출력은 자동 ack.
fn run(opts: SpawnOptions) -> (String, i32) {
    let (dtx, drx) = channel();
    let (etx, erx) = channel();
    let h = PtyHandle::spawn(
        opts,
        move |d| {
            let _ = dtx.send(d);
        },
        move |c| {
            let _ = etx.send(c);
        },
    )
    .unwrap();
    let mut out = Vec::new();
    let deadline = Instant::now() + WAIT;
    let code = loop {
        if let Ok(d) = drx.recv_timeout(Duration::from_millis(20)) {
            answer_dsr(&h, &d);
            h.ack(d.len());
            out.extend(d);
        }
        if let Ok(c) = erx.try_recv() {
            break c;
        }
        assert!(Instant::now() < deadline, "종료 이벤트 시간 초과");
    };
    while let Ok(d) = drx.try_recv() {
        h.ack(d.len());
        out.extend(d);
    }
    (String::from_utf8_lossy(&out).into_owned(), code)
}

#[test]
fn echo_output_and_exit_code() {
    let (out, code) = run(pwsh("echo ladock-hello; exit 7"));
    assert!(out.contains("ladock-hello"), "출력: {out:?}");
    assert_eq!(code, 7);
}

#[test]
fn env_remove_hides_variable() {
    unsafe {
        std::env::set_var("LADOCK_TEST_SECRET", "visible");
    }
    let script = "echo \"[$env:LADOCK_TEST_SECRET]\"";
    let (kept, _) = run(pwsh(script));
    assert!(kept.contains("[visible]"), "출력: {kept:?}");
    let mut opts = pwsh(script);
    opts.env_remove = vec!["LADOCK_TEST_SECRET".into()];
    let (removed, _) = run(opts);
    assert!(removed.contains("[]"), "출력: {removed:?}");
}

#[test]
fn write_resize_and_kill() {
    let (dtx, drx) = channel();
    let (etx, erx) = channel();
    let opts = SpawnOptions {
        command: "pwsh.exe".into(),
        args: vec!["-NoProfile".into()],
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let h = PtyHandle::spawn(
        opts,
        move |d| {
            let _ = dtx.send(d);
        },
        move |c| {
            let _ = etx.send(c);
        },
    )
    .unwrap();
    h.resize(120, 40).unwrap();
    h.write(b"echo ping-$($Host.UI.RawUI.WindowSize.Width)\r")
        .unwrap();
    let mut seen = String::new();
    let deadline = Instant::now() + WAIT;
    while !seen.contains("ping-120") && Instant::now() < deadline {
        if let Ok(d) = drx.recv_timeout(Duration::from_millis(200)) {
            answer_dsr(&h, &d);
            h.ack(d.len());
            seen.push_str(&String::from_utf8_lossy(&d));
        }
    }
    assert!(seen.contains("ping-120"), "리사이즈 반영 안 됨: {seen:?}");
    h.kill();
    erx.recv_timeout(WAIT).expect("kill 후 종료 이벤트");
}

#[test]
fn heavy_output_stays_bounded() {
    let (dtx, drx) = channel::<Vec<u8>>();
    let (etx, erx) = channel();
    let h = PtyHandle::spawn(
        pwsh("1..100000 | ForEach-Object { \"line $_ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\" }"),
        move |d| {
            let _ = dtx.send(d);
        },
        move |c| {
            let _ = etx.send(c);
        },
    )
    .unwrap();
    let (mut total, mut max_inflight, mut inflight) = (0usize, 0usize, 0usize);
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match drx.recv_timeout(Duration::from_millis(50)) {
            Ok(d) => {
                answer_dsr(&h, &d);
                total += d.len();
                inflight += d.len();
                max_inflight = max_inflight.max(inflight);
                // 소비 지연 흉내: 일정량이 쌓이면 한꺼번에 ack
                if inflight > 256 * 1024 {
                    h.ack(inflight);
                    inflight = 0;
                }
            }
            Err(_) => {
                if erx.try_recv().is_ok() {
                    break;
                }
                assert!(Instant::now() < deadline, "시간 초과");
            }
        }
    }
    assert!(total > 100_000 * 30, "출력이 너무 적음: {total}");
    // 상한 + 배치 1개 + 종료 꼬리(큐 32 × 16KB) 이내
    assert!(
        max_inflight <= INFLIGHT_MAX + BATCH_MAX + 32 * 16 * 1024 + 64 * 1024,
        "max_inflight={max_inflight}"
    );
}

/// 감지된 모든 셸이 ConPTY에서 실제로 뜨고 명령을 실행한다 (M1-06).
#[test]
fn every_detected_shell_runs() {
    let run_arg = |id: &str| -> Vec<&'static str> {
        match id {
            "cmd" => vec!["/c", "echo ladock-ok"],
            "pwsh" | "powershell" => vec!["-NoProfile", "-Command", "echo ladock-ok"],
            _ => vec![],
        }
    };
    for p in crate::shells::detect() {
        let mut args = p.args.clone();
        match p.id.as_str() {
            "bash" => args = vec!["-c".into(), "echo ladock-ok".into()],
            id if id.starts_with("wsl:") => {
                args.extend(["--".into(), "echo".into(), "ladock-ok".into()])
            }
            id => args = run_arg(id).into_iter().map(String::from).collect(),
        }
        let (out, code) = run(SpawnOptions {
            command: p.path.clone(),
            args,
            cols: 100,
            rows: 30,
            ..Default::default()
        });
        assert!(out.contains("ladock-ok"), "{}: 출력 {out:?}", p.id);
        assert_eq!(code, 0, "{}", p.id);
    }
}
