//! ConPTY 백엔드. pane 1개 = PTY 1개.
//!
//! 코어(`PtyHandle::spawn`)는 Tauri와 무관하게 콜백만 받는다 — 테스트하기 쉽게.
//! IPC 어댑터(`pty_*` 명령)는 아래쪽에 있다.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};

/// 출력 묶음 단위: 16ms 또는 64KB.
const BATCH_INTERVAL: Duration = Duration::from_millis(16);
const BATCH_MAX: usize = 64 * 1024;
/// 프론트가 아직 ack하지 않은 바이트 상한. 넘으면 리더가 멈춰 ConPTY 쪽이 막힌다.
const INFLIGHT_MAX: usize = 1024 * 1024;

pub type PaneId = u32;

#[derive(Debug, Clone, Default)]
pub struct SpawnOptions {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub cols: u16,
    pub rows: u16,
    pub env_remove: Vec<String>,
    /// 자식에게 추가로 넘길 환경변수
    pub env: Vec<(String, String)>,
}

/// 프론트가 소비한 바이트를 세는 흐름 제어 장치.
#[derive(Default)]
struct Flow {
    inflight: Mutex<usize>,
    cv: Condvar,
}

impl Flow {
    fn add(&self, n: usize) {
        *self.inflight.lock().unwrap() += n;
    }

    fn ack(&self, n: usize) {
        let mut g = self.inflight.lock().unwrap();
        *g = g.saturating_sub(n);
        self.cv.notify_all();
    }

    /// 상한 아래로 내려올 때까지 기다린다. 닫혔으면 즉시 반환.
    fn wait_room(&self, closed: &AtomicUsize) {
        let mut g = self.inflight.lock().unwrap();
        while *g >= INFLIGHT_MAX && closed.load(Ordering::Relaxed) == 0 {
            g = self
                .cv
                .wait_timeout(g, Duration::from_millis(100))
                .unwrap()
                .0;
        }
    }
}

pub struct PtyHandle {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
    flow: Arc<Flow>,
    pid: Option<u32>,
}

impl PtyHandle {
    /// `on_data`는 묶인 출력 덩어리마다, `on_exit`는 출력을 모두 흘린 뒤 한 번만 호출된다.
    pub fn spawn(
        opts: SpawnOptions,
        on_data: impl FnMut(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce(i32) + Send + 'static,
    ) -> Result<Self, String> {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: opts.rows.max(1),
                cols: opts.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(&opts.command);
        cmd.args(&opts.args);
        if let Some(cwd) = &opts.cwd {
            cmd.cwd(cwd);
        }
        for key in &opts.env_remove {
            cmd.env_remove(key);
        }
        for (key, value) in &opts.env {
            cmd.env(key, value);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let pid = child.process_id();
        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let flow = Arc::new(Flow::default());
        let closed = Arc::new(AtomicUsize::new(0));

        // 리더: ConPTY 파이프 → 청크 큐. 큐는 크기가 제한돼 있어 배처가 막히면 같이 막힌다.
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
        let reader_thread = thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // 배처: 16ms / 64KB 단위로 묶어 전달. ack 대기로 흐름 제어.
        let batcher_flow = flow.clone();
        let batcher_closed = closed.clone();
        let batcher = thread::spawn(move || {
            let mut on_data = on_data;
            let mut pending: Vec<u8> = Vec::with_capacity(BATCH_MAX);
            let mut deadline = Instant::now();
            let mut flush = |pending: &mut Vec<u8>| {
                if pending.is_empty() {
                    return;
                }
                batcher_flow.wait_room(&batcher_closed);
                batcher_flow.add(pending.len());
                on_data(std::mem::take(pending));
                pending.reserve(BATCH_MAX);
            };
            loop {
                let timeout = if pending.is_empty() {
                    Duration::from_secs(3600)
                } else {
                    deadline.saturating_duration_since(Instant::now())
                };
                match rx.recv_timeout(timeout) {
                    Ok(chunk) => {
                        if pending.is_empty() {
                            deadline = Instant::now() + BATCH_INTERVAL;
                        }
                        pending.extend_from_slice(&chunk);
                        if pending.len() >= BATCH_MAX {
                            flush(&mut pending);
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => flush(&mut pending),
                    Err(RecvTimeoutError::Disconnected) => {
                        flush(&mut pending);
                        break;
                    }
                }
            }
        });

        let master = Arc::new(Mutex::new(Some(pair.master)));
        let handle = PtyHandle {
            master: master.clone(),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            flow,
            pid,
        };

        // 종료 감시: 자식이 끝나면 ConPTY를 닫아 리더 EOF를 유도하고, 출력이 다 나간 뒤 on_exit.
        thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
            master.lock().unwrap().take();
            let _ = reader_thread.join();
            let _ = batcher.join();
            closed.store(1, Ordering::Relaxed);
            on_exit(code);
        });
        Ok(handle)
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data)
            .and_then(|_| w.flush())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        match self.master.lock().unwrap().as_ref() {
            Some(m) => m
                .resize(PtySize {
                    rows: rows.max(1),
                    cols: cols.max(1),
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string()),
            None => Ok(()),
        }
    }

    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    pub fn kill(&self) {
        let _ = self.killer.lock().unwrap().kill();
    }

    pub fn ack(&self, bytes: usize) {
        self.flow.ack(bytes);
    }
}

#[cfg(test)]
#[path = "pty_tests.rs"]
mod tests;
