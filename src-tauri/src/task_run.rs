//! 자동 작업(M6)의 백그라운드 실행. 창 없이 프로세스를 띄우고 stdout · stderr를
//! `%APPDATA%\LaDock\task-logs\<runId>.log`에 모은다. 끝나면 `task://exit` 이벤트.
//! AI 작업도 같은 경로로 공식 CLI의 비대화형 플래그를 실행할 뿐이다 (토큰은 만지지 않는다).

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::limits::app_dir;

const LOG_DIR: &str = "task-logs";
/// 로그 한 건의 상한. 넘으면 잘라 내고 안내 문구를 남긴다.
const MAX_LOG: usize = 2 * 1024 * 1024;
const TRUNCATED_NOTE: &[u8] = "\n[로그가 2MB를 넘어 여기서 잘렸습니다]\n".as_bytes();
/// 종료 직후 남은 출력을 기다리는 최대 시간 (자식이 남긴 손자 프로세스가 파이프를 쥐고 있어도 멈추지 않게)
const DRAIN_WAIT: Duration = Duration::from_millis(500);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArgs {
    pub run_id: String,
    pub profile_id: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env_remove: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    run_id: String,
    code: Option<i32>,
    killed: bool,
}

/// 실행 중인 작업의 pid. 사용자가 중지한 것(`killed`)은 종료 이벤트에 표시한다.
#[derive(Default)]
pub struct TaskRuns {
    running: Mutex<HashMap<String, u32>>,
    killed: Mutex<Vec<String>>,
}

impl TaskRuns {
    pub fn kill_all(&self) {
        if let Ok(map) = self.running.lock() {
            for pid in map.values() {
                kill_tree(*pid);
            }
        }
    }
}

/// 파일 이름으로 쓰므로 영숫자 · `_` · `-`만 허용한다 (경로 탈출 방지).
fn valid_run_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn log_dir() -> Result<PathBuf, String> {
    Ok(app_dir().ok_or("APPDATA 없음")?.join(LOG_DIR))
}

fn log_path(run_id: &str) -> Result<PathBuf, String> {
    if !valid_run_id(run_id) {
        return Err("잘못된 실행 id".into());
    }
    Ok(log_dir()?.join(format!("{run_id}.log")))
}

/// 프로세스 트리를 통째로 끝낸다 (셸이 띄운 python · node 등까지).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// 파이프 → 로그 파일. 상한을 넘으면 버리고 안내 문구를 한 번 남긴다.
fn pump<R: Read>(mut r: R, file: Arc<Mutex<File>>, written: Arc<AtomicUsize>) {
    let mut buf = [0u8; 8192];
    while let Ok(n) = r.read(&mut buf) {
        if n == 0 {
            break;
        }
        let prev = written.fetch_add(n, Ordering::SeqCst);
        if prev > MAX_LOG {
            continue;
        }
        let take = n.min(MAX_LOG - prev);
        if let Ok(mut f) = file.lock() {
            let _ = f.write_all(&buf[..take]);
            // 상한을 처음 넘는 순간에만 (정확히 상한에서 끊겨도 포함)
            if prev + n > MAX_LOG {
                let _ = f.write_all(TRUNCATED_NOTE);
            }
        }
    }
}

/// 프로세스를 띄우고 출력 수집 스레드를 붙인다. 테스트에서 AppHandle 없이 쓰려고 분리했다.
fn launch(args: &RunArgs, log: &Path) -> Result<(Child, Vec<JoinHandle<()>>), String> {
    let program = match &args.command {
        Some(c) if !c.is_empty() => c.clone(),
        _ => crate::shells::resolve(&args.profile_id).0,
    };
    let mut cmd = Command::new(program);
    cmd.args(&args.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 파이프로 받는 출력이 한글로 깨지지 않게 파이썬은 UTF-8로 고정
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    if let Some(cwd) = args.cwd.as_deref().filter(|c| !c.is_empty()) {
        cmd.current_dir(cwd);
    }
    for key in args.env_remove.iter().flatten() {
        cmd.env_remove(key);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    fs::create_dir_all(log.parent().ok_or("로그 경로 오류")?)
        .map_err(|e| format!("로그 폴더 생성 실패: {e}"))?;
    let file = Arc::new(Mutex::new(
        File::create(log).map_err(|e| format!("로그 파일 생성 실패: {e}"))?,
    ));
    let mut child = cmd.spawn().map_err(|e| format!("실행 실패: {e}"))?;

    let written = Arc::new(AtomicUsize::new(0));
    let mut pumps = Vec::new();
    if let Some(out) = child.stdout.take() {
        let (f, w) = (file.clone(), written.clone());
        pumps.push(thread::spawn(move || pump(out, f, w)));
    }
    if let Some(err) = child.stderr.take() {
        let (f, w) = (file.clone(), written.clone());
        pumps.push(thread::spawn(move || pump(err, f, w)));
    }
    Ok((child, pumps))
}

/// 종료 직후 남은 출력이 로그에 닿을 때까지 잠깐 기다린다.
fn drain(pumps: Vec<JoinHandle<()>>) {
    let deadline = Instant::now() + DRAIN_WAIT;
    while Instant::now() < deadline && !pumps.iter().all(|h| h.is_finished()) {
        thread::sleep(Duration::from_millis(20));
    }
}

#[tauri::command]
pub fn task_run_start(
    app: AppHandle,
    runs: State<'_, TaskRuns>,
    args: RunArgs,
) -> Result<(), String> {
    let log = log_path(&args.run_id)?;
    let (mut child, pumps) = launch(&args, &log)?;
    let run_id = args.run_id.clone();
    runs.running
        .lock()
        .map_err(|_| "내부 오류")?
        .insert(run_id.clone(), child.id());

    thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        drain(pumps);
        let runs = app.state::<TaskRuns>();
        if let Ok(mut map) = runs.running.lock() {
            map.remove(&run_id);
        }
        let killed = runs
            .killed
            .lock()
            .map(|mut k| {
                let hit = k.contains(&run_id);
                k.retain(|id| id != &run_id);
                hit
            })
            .unwrap_or(false);
        let _ = app.emit(
            "task://exit",
            ExitPayload {
                run_id,
                code,
                killed,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn task_run_kill(runs: State<'_, TaskRuns>, run_id: String) -> Result<(), String> {
    let pid = runs
        .running
        .lock()
        .map_err(|_| "내부 오류")?
        .get(&run_id)
        .copied();
    if let Some(pid) = pid {
        runs.killed.lock().map_err(|_| "내부 오류")?.push(run_id);
        kill_tree(pid);
    }
    Ok(())
}

/// 로그 전문. 파일이 없으면 빈 문자열. 깨진 바이트는 대체 문자로 읽는다.
#[tauri::command]
pub fn task_log_read(run_id: String) -> Result<String, String> {
    match fs::read(log_path(&run_id)?) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("로그 읽기 실패: {e}")),
    }
}

#[tauri::command]
pub fn task_log_delete(run_ids: Vec<String>) {
    for id in run_ids {
        if let Ok(p) = log_path(&id) {
            let _ = fs::remove_file(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ladock-taskrun-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn run_id_rejects_path_tricks() {
        assert!(valid_run_id("r1abc-9_x"));
        assert!(!valid_run_id(""));
        assert!(!valid_run_id("..\\evil"));
        assert!(!valid_run_id("a/b"));
        assert!(!valid_run_id(&"a".repeat(65)));
    }

    #[test]
    fn pump_truncates_with_note() {
        let d = temp("pump");
        fs::create_dir_all(&d).unwrap();
        let path = d.join("x.log");
        let file = Arc::new(Mutex::new(File::create(&path).unwrap()));
        let data = vec![b'a'; MAX_LOG + 100];
        pump(&data[..], file, Arc::new(AtomicUsize::new(0)));
        let out = fs::read(&path).unwrap();
        assert_eq!(out.len(), MAX_LOG + TRUNCATED_NOTE.len());
        assert!(out.ends_with(TRUNCATED_NOTE));
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(windows)]
    #[test]
    fn captures_stdout_and_stderr_and_exit_code() {
        let d = temp("launch");
        let log = d.join("r.log");
        let args = RunArgs {
            run_id: "r".into(),
            profile_id: "cmd".into(),
            command: Some("cmd.exe".into()),
            args: vec!["/c".into(), "echo hello& echo oops 1>&2& exit 3".into()],
            cwd: None,
            env_remove: None,
        };
        let (mut child, pumps) = launch(&args, &log).unwrap();
        let code = child.wait().unwrap().code();
        drain(pumps);
        let text = fs::read_to_string(&log).unwrap();
        assert_eq!(code, Some(3));
        assert!(text.contains("hello"), "{text}");
        assert!(text.contains("oops"), "{text}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn spawn_failure_is_an_error() {
        let d = temp("fail");
        let args = RunArgs {
            run_id: "r".into(),
            profile_id: "x".into(),
            command: Some("C:\\없는\\프로그램.exe".into()),
            args: vec![],
            cwd: None,
            env_remove: None,
        };
        assert!(launch(&args, &d.join("r.log")).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
