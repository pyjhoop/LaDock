//! 모바일 원격 접속. Tailscale IP에만 바인딩한 작은 HTTP + WebSocket 서버와,
//! PTY 출력을 폰으로 나눠 주는 hub. 프로토콜은 docs/milestones/M5-01-mobile-remote.md.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};

use crate::limits::app_dir;
use crate::pty::PaneId;

const FILE: &str = "remote.json";
const DEFAULT_PORT: u16 = 47321;
/// `tailscale serve`가 HTTPS로 여는 포트. 443은 다른 서비스가 쓸 수 있어 피한다.
const HTTPS_PORT: u16 = 8443;
/// pane별로 보관하는 최근 출력. 폰이 붙을 때 먼저 재생한다.
const REPLAY_MAX: usize = 256 * 1024;
/// 폰 하나에 쌓아 둘 수 있는 보낼 메시지 수. 넘으면 느린 폰으로 보고 끊는다.
const OUTBOX_MAX: usize = 512;
const HEAD_MAX: usize = 8 * 1024;
/// 폰이 보내는 WebSocket 메시지 상한 (레이아웃 상태가 가장 크다).
const MSG_MAX: usize = 2 * 1024 * 1024;
/// 폰이 PC 프론트를 통해 대신 호출할 수 있는 명령. 읽기 전용 조회만.
const RPC_ALLOWED: &[&str] = &[
    "providers_detect",
    "limits_get",
    "shells_detect",
    "settings_load",
    "dirs_exist",
    "pty_detect_agents",
    "claude_bridge_status",
];
const POLL: Duration = Duration::from_millis(20);

// ── 설정 파일 ─────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    enabled: bool,
    port: u16,
    token: String,
    /// `tailscale serve`로 HTTPS 주소를 연다 (기본 켬)
    #[serde(default = "yes")]
    https: bool,
}

fn yes() -> bool {
    true
}

fn config_path() -> Option<PathBuf> {
    app_dir().map(|d| d.join(FILE))
}

fn new_token() -> String {
    let mut buf = [0u8; 24];
    getrandom::fill(&mut buf).expect("OS 난수 없음");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn load_config() -> Config {
    let saved = config_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Config>(&t).ok())
        .filter(|c| c.token.len() >= 32);
    saved.unwrap_or_else(|| Config {
        enabled: false,
        port: DEFAULT_PORT,
        token: new_token(),
        https: true,
    })
}

fn save_config(c: &Config) -> Result<(), String> {
    let path = config_path().ok_or("APPDATA 없음")?;
    fs::create_dir_all(path.parent().ok_or("저장 경로 오류")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_string_pretty(c).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 길이가 같으면 모든 바이트를 비교한다 (타이밍으로 토큰을 추측하지 못하게).
fn token_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ── Tailscale ─────────────────────────────────────

/// tailscale CLI를 실행해 stdout을 돌려준다. 실패하면 사람이 읽을 이유.
fn tailscale(args: &[&str]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let candidates = ["tailscale", r"C:\Program Files\Tailscale\tailscale.exe"];
    let mut last = "Tailscale이 설치돼 있지 않습니다".to_string();
    for bin in candidates {
        let out = Command::new(bin)
            .args(args)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();
        match out {
            Ok(o) if o.status.success() => {
                return Ok(String::from_utf8_lossy(&o.stdout).to_string());
            }
            Ok(o) => {
                let err = String::from_utf8_lossy(&o.stderr);
                let line = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
                last = if line.is_empty() {
                    "Tailscale이 꺼져 있거나 로그인되지 않았습니다".into()
                } else {
                    line.trim().to_string()
                };
            }
            Err(_) => {}
        }
    }
    Err(last)
}

/// `tailscale ip -4`의 첫 줄.
fn tailscale_ip() -> Result<Ipv4Addr, String> {
    // 개발 빌드 전용: Tailscale 없이 로컬 브라우저로 시험할 때 쓴다
    if cfg!(debug_assertions)
        && let Some(ip) = std::env::var("LADOCK_REMOTE_BIND")
            .ok()
            .and_then(|v| v.parse().ok())
    {
        return Ok(ip);
    }
    tailscale(&["ip", "-4"])?
        .lines()
        .find_map(|l| l.trim().parse::<Ipv4Addr>().ok())
        .ok_or_else(|| "Tailscale IPv4 주소를 찾지 못했습니다".to_string())
}

/// 이 PC의 MagicDNS 이름 (끝의 점 제외). HTTPS 주소에 쓴다.
fn tailscale_dns_name() -> Result<String, String> {
    let json = tailscale(&["status", "--json"])?;
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    v["Self"]["DNSName"]
        .as_str()
        .map(|n| n.trim_end_matches('.').to_string())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "MagicDNS 이름을 찾지 못했습니다 (Tailscale에서 MagicDNS를 켜세요)".into())
}

/// `tailscale serve`로 HTTPS 포트를 열고 접속 호스트 이름을 돌려준다.
///
/// 백엔드는 루프백이다: tailscaled는 자기 Tailscale IP로는 연결하지 못한다 (요청이 응답 없이 멈춘다).
fn https_on(port: u16) -> Result<String, String> {
    let host = tailscale_dns_name()?;
    let https = format!("--https={HTTPS_PORT}");
    tailscale(&["serve", "--bg", &https, &format!("http://127.0.0.1:{port}")]).map_err(|e| {
        format!("HTTPS를 열지 못했습니다 ({e}) — Tailscale 관리 콘솔에서 HTTPS 인증서를 켰는지 확인하세요")
    })?;
    Ok(host)
}

fn https_off() {
    let _ = tailscale(&["serve", &format!("--https={HTTPS_PORT}"), "off"]);
}

// ── hub ───────────────────────────────────────────

enum Out {
    Text(String),
    Bin(Vec<u8>),
}

type Outbox = SyncSender<Out>;

struct PaneBuf {
    replay: Vec<u8>,
    cols: u16,
    rows: u16,
}

#[derive(Default)]
struct HubInner {
    panes: HashMap<PaneId, PaneBuf>,
    layout: String,
    clients: HashMap<u64, (Outbox, HashSet<PaneId>)>,
}

/// PTY 출력의 분배처. 서버가 꺼져 있어도 링버퍼는 계속 채운다 (켜자마자 바로 보이도록).
#[derive(Default)]
pub struct Hub {
    inner: Mutex<HubInner>,
    next_client: AtomicU64,
}

fn size_msg(t: &str, pane: PaneId, cols: u16, rows: u16) -> Out {
    Out::Text(format!(
        r#"{{"t":"{t}","pane":{pane},"cols":{cols},"rows":{rows}}}"#
    ))
}

fn frame(pane: PaneId, data: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(4 + data.len());
    v.extend_from_slice(&pane.to_le_bytes());
    v.extend_from_slice(data);
    v
}

impl Hub {
    pub fn open(&self, pane: PaneId, cols: u16, rows: u16) {
        self.inner.lock().unwrap().panes.insert(
            pane,
            PaneBuf {
                replay: Vec::new(),
                cols,
                rows,
            },
        );
    }

    pub fn output(&self, pane: PaneId, data: &[u8]) {
        let mut g = self.inner.lock().unwrap();
        if let Some(buf) = g.panes.get_mut(&pane) {
            buf.replay.extend_from_slice(data);
            if buf.replay.len() > REPLAY_MAX {
                let cut = buf.replay.len() - REPLAY_MAX;
                buf.replay.drain(..cut);
            }
        }
        let mut dead = vec![];
        for (id, (tx, attached)) in &g.clients {
            if attached.contains(&pane) && tx.try_send(Out::Bin(frame(pane, data))).is_err() {
                dead.push(*id);
            }
        }
        for id in dead {
            g.clients.remove(&id);
        }
    }

    pub fn resized(&self, pane: PaneId, cols: u16, rows: u16) {
        let mut g = self.inner.lock().unwrap();
        if let Some(buf) = g.panes.get_mut(&pane) {
            buf.cols = cols;
            buf.rows = rows;
        }
        for (tx, attached) in g.clients.values() {
            if attached.contains(&pane) {
                let _ = tx.try_send(size_msg("size", pane, cols, rows));
            }
        }
    }

    pub fn exited(&self, pane: PaneId, code: i32) {
        let g = self.inner.lock().unwrap();
        for (tx, attached) in g.clients.values() {
            if attached.contains(&pane) {
                let _ = tx.try_send(Out::Text(format!(
                    r#"{{"t":"exit","pane":{pane},"code":{code}}}"#
                )));
            }
        }
    }

    pub fn close(&self, pane: PaneId) {
        let mut g = self.inner.lock().unwrap();
        g.panes.remove(&pane);
        for (_, attached) in g.clients.values_mut() {
            attached.remove(&pane);
        }
    }

    fn set_layout(&self, layout: String) {
        let mut g = self.inner.lock().unwrap();
        let msg = format!(r#"{{"t":"layout","layout":{layout}}}"#);
        g.layout = layout;
        for (tx, _) in g.clients.values() {
            let _ = tx.try_send(Out::Text(msg.clone()));
        }
    }

    fn join(&self, tx: Outbox) -> u64 {
        let id = self.next_client.fetch_add(1, Ordering::Relaxed);
        let mut g = self.inner.lock().unwrap();
        if !g.layout.is_empty() {
            let _ = tx.try_send(Out::Text(format!(
                r#"{{"t":"layout","layout":{}}}"#,
                g.layout
            )));
        }
        g.clients.insert(id, (tx, HashSet::new()));
        id
    }

    fn send_to(&self, id: u64, out: Out) {
        if let Some((tx, _)) = self.inner.lock().unwrap().clients.get(&id) {
            let _ = tx.try_send(out);
        }
    }

    fn leave(&self, id: u64) {
        self.inner.lock().unwrap().clients.remove(&id);
    }

    fn disconnect_all(&self) {
        self.inner.lock().unwrap().clients.clear();
    }

    fn client_count(&self) -> usize {
        self.inner.lock().unwrap().clients.len()
    }

    /// 재생 데이터를 보낸 뒤 실시간 구독을 시작한다. 두 일이 한 락 안에서 일어나 빠지는 출력이 없다.
    fn attach(&self, id: u64, pane: PaneId) {
        let mut g = self.inner.lock().unwrap();
        let Some(buf) = g.panes.get(&pane) else {
            return;
        };
        let (cols, rows, replay) = (buf.cols, buf.rows, buf.replay.clone());
        if let Some((tx, attached)) = g.clients.get_mut(&id) {
            let _ = tx.try_send(size_msg("attached", pane, cols, rows));
            if !replay.is_empty() {
                let _ = tx.try_send(Out::Bin(frame(pane, &replay)));
            }
            attached.insert(pane);
        }
    }

    fn detach(&self, id: u64, pane: PaneId) {
        if let Some((_, attached)) = self.inner.lock().unwrap().clients.get_mut(&id) {
            attached.remove(&pane);
        }
    }
}

// ── 서버 ──────────────────────────────────────────

struct Server {
    stop: Arc<AtomicBool>,
    addr: String,
    /// HTTPS를 열었다면 접속 호스트 (`<pc>.<tailnet>.ts.net`)
    https_host: Option<String>,
}

#[derive(Default)]
pub struct Remote {
    cfg: Mutex<Option<Config>>,
    server: Mutex<Option<Server>>,
    error: Mutex<Option<String>>,
}

impl Remote {
    fn cfg(&self) -> Config {
        self.cfg
            .lock()
            .unwrap()
            .get_or_insert_with(load_config)
            .clone()
    }

    fn update_cfg(&self, f: impl FnOnce(&mut Config)) -> Result<Config, String> {
        let mut c = self.cfg();
        f(&mut c);
        save_config(&c)?;
        *self.cfg.lock().unwrap() = Some(c.clone());
        Ok(c)
    }

    fn stop_server(&self, hub: &Hub) {
        if let Some(s) = self.server.lock().unwrap().take() {
            s.stop.store(true, Ordering::Relaxed);
            if s.https_host.is_some() {
                https_off();
            }
        }
        hub.disconnect_all();
    }

    fn start_server(&self, app: &AppHandle) -> Result<(), String> {
        self.stop_server(&app.state::<Hub>());
        let cfg = self.cfg();
        let ip = tailscale_ip()?;
        let listener = TcpListener::bind((ip, cfg.port))
            .map_err(|e| format!("{ip}:{} 포트를 열지 못했습니다 ({e})", cfg.port))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        // `tailscale serve`가 붙을 루프백 listener. HTTPS일 때만 연다 (토큰이 없으면 WebSocket은 거부된다).
        let loopback = if cfg.https {
            let l = TcpListener::bind((Ipv4Addr::LOCALHOST, cfg.port))
                .map_err(|e| format!("127.0.0.1:{} 포트를 열지 못했습니다 ({e})", cfg.port))?;
            l.set_nonblocking(true).map_err(|e| e.to_string())?;
            Some(l)
        } else {
            None
        };
        let stop = Arc::new(AtomicBool::new(false));
        // HTTPS 실패는 서버를 멈추지 않는다 (HTTP 주소는 그대로 쓸 수 있다). 이유만 알린다.
        let (https_host, https_err) = if cfg.https {
            match https_on(cfg.port) {
                Ok(h) => (Some(h), None),
                Err(e) => (None, Some(e)),
            }
        } else {
            (None, None)
        };
        *self.server.lock().unwrap() = Some(Server {
            stop: stop.clone(),
            addr: format!("{ip}:{}", cfg.port),
            https_host,
        });
        if let Some(l) = loopback {
            let (stop, app, token) = (stop.clone(), app.clone(), cfg.token.clone());
            thread::spawn(move || accept_loop(l, stop, app, token));
        }
        let app = app.clone();
        thread::spawn(move || accept_loop(listener, stop, app, cfg.token));
        https_err.map_or(Ok(()), Err)
    }

    /// 설정이 켜져 있으면 서버를 맞춰 둔다. 실패 이유는 `error`에 남긴다.
    pub fn apply(&self, app: &AppHandle) {
        let result = if self.cfg().enabled {
            self.start_server(app)
        } else {
            self.stop_server(&app.state::<Hub>());
            Ok(())
        };
        *self.error.lock().unwrap() = result.err();
    }

    /// 앱 종료 때: 서버를 닫고 열어 둔 `tailscale serve` 설정을 걷는다.
    pub fn shutdown(&self, hub: &Hub) {
        self.stop_server(hub);
    }

    /// 앱 시작 때 호출. Tailscale이 아직 안 올라왔을 수 있어 실패하면 잠시 후 다시 시도한다.
    pub fn start_background(app: AppHandle) {
        thread::spawn(move || {
            let remote = app.state::<Remote>();
            for _ in 0..30 {
                if !remote.cfg().enabled {
                    return;
                }
                remote.apply(&app);
                if remote.error.lock().unwrap().is_none() {
                    return;
                }
                thread::sleep(Duration::from_secs(10));
            }
        });
    }
}

fn accept_loop(listener: TcpListener, stop: Arc<AtomicBool>, app: AppHandle, token: String) {
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let (app, token, stop) = (app.clone(), token.clone(), stop.clone());
                thread::spawn(move || {
                    let _ = handle_conn(stream, &app, &token, &stop);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(POLL),
            Err(_) => thread::sleep(Duration::from_millis(200)),
        }
    }
}

struct Head {
    path: String,
    query: String,
    is_ws: bool,
    len: usize,
}

/// 소켓에서 읽지 않고(peek) 요청 머리를 파싱한다. WebSocket 핸드셰이크가 처음부터 읽을 수 있게.
fn peek_head(stream: &TcpStream) -> Result<Head, String> {
    let mut buf = vec![0u8; HEAD_MAX];
    let start = Instant::now();
    loop {
        let n = stream.peek(&mut buf).map_err(|e| e.to_string())?;
        if let Some(end) = buf[..n].windows(4).position(|w| w == b"\r\n\r\n") {
            let text = String::from_utf8_lossy(&buf[..end]).to_string();
            let mut lines = text.lines();
            let first = lines.next().unwrap_or_default();
            let mut parts = first.split_whitespace();
            let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
            if method != "GET" {
                return Err("GET만 받습니다".into());
            }
            let (path, query) = target.split_once('?').unwrap_or((target, ""));
            let is_ws = lines.any(|l| {
                l.to_ascii_lowercase()
                    .replace(' ', "")
                    .starts_with("upgrade:websocket")
            });
            return Ok(Head {
                path: path.to_string(),
                query: query.to_string(),
                is_ws,
                len: end + 4,
            });
        }
        if n >= HEAD_MAX || start.elapsed() > Duration::from_secs(3) {
            return Err("요청 머리를 읽지 못했습니다".into());
        }
        thread::sleep(Duration::from_millis(5));
    }
}

fn query_get<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v)
}

fn handle_conn(
    stream: TcpStream,
    app: &AppHandle,
    token: &str,
    stop: &AtomicBool,
) -> Result<(), String> {
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    let _ = stream.set_nodelay(true);
    let head = peek_head(&stream)?;
    if head.is_ws {
        if head.path != "/ws" || !token_eq(query_get(&head.query, "t").unwrap_or(""), token) {
            return http(&stream, 401, "text/plain", b"unauthorized");
        }
        return ws_session(stream, app, stop);
    }
    // 머리를 소비한다
    let mut sink = vec![0u8; head.len];
    (&stream).read_exact(&mut sink).map_err(|e| e.to_string())?;
    serve_static(&stream, app, &head.path)
}

fn http(mut stream: &TcpStream, code: u16, mime: &str, body: &[u8]) -> Result<(), String> {
    let reason = match code {
        200 => "OK",
        401 => "Unauthorized",
        _ => "Not Found",
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|e| e.to_string())
}

/// 정적 파일은 인증 없이 내준다 (빌드된 모바일 페이지일 뿐). 접근 권한은 WebSocket 토큰이 가른다.
fn serve_static(stream: &TcpStream, app: &AppHandle, path: &str) -> Result<(), String> {
    let path = match path {
        "/" | "" => "/mobile.html",
        p => p,
    };
    if path.contains("..") {
        return http(stream, 404, "text/plain", b"not found");
    }
    match app
        .asset_resolver()
        .get(path.trim_start_matches('/').to_string())
    {
        Some(asset) => http(stream, 200, &asset.mime_type, &asset.bytes),
        None => http(stream, 404, "text/plain", b"not found"),
    }
}

#[derive(Deserialize)]
struct ClientMsg {
    t: String,
    pane: Option<PaneId>,
    data: Option<String>,
    /// rpc 요청 번호
    id: Option<u64>,
    cmd: Option<String>,
    args: Option<serde_json::Value>,
    /// 폰이 바꾼 앱 상태 전체 (PC 프론트가 받아 적용한다)
    state: Option<serde_json::Value>,
}

fn ws_session(stream: TcpStream, app: &AppHandle, stop: &AtomicBool) -> Result<(), String> {
    let config = WebSocketConfig::default().max_message_size(Some(MSG_MAX));
    let mut ws: WebSocket<TcpStream> =
        tungstenite::accept_with_config(stream, Some(config)).map_err(|e| e.to_string())?;
    // 읽기를 짧은 타임아웃으로 돌려 보낼 메시지도 같은 스레드에서 처리한다.
    ws.get_ref()
        .set_read_timeout(Some(POLL))
        .map_err(|e| e.to_string())?;
    let hub = app.state::<Hub>();
    let (tx, rx): (Outbox, Receiver<Out>) = mpsc::sync_channel(OUTBOX_MAX);
    let id = hub.join(tx);
    let result = ws_loop(&mut ws, &rx, app, &hub, id, stop);
    hub.leave(id);
    let _ = ws.close(None);
    result
}

fn ws_loop(
    ws: &mut WebSocket<TcpStream>,
    rx: &Receiver<Out>,
    app: &AppHandle,
    hub: &Hub,
    id: u64,
    stop: &AtomicBool,
) -> Result<(), String> {
    use std::io::ErrorKind::{TimedOut, WouldBlock};
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        loop {
            match rx.try_recv() {
                Ok(Out::Text(t)) => ws.send(Message::text(t)).map_err(|e| e.to_string())?,
                Ok(Out::Bin(b)) => ws.send(Message::binary(b)).map_err(|e| e.to_string())?,
                Err(TryRecvError::Empty) => break,
                // hub가 이 폰을 내보냈다 (느리거나 서버 종료)
                Err(TryRecvError::Disconnected) => return Ok(()),
            }
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                if let Ok(m) = serde_json::from_str::<ClientMsg>(&t) {
                    handle_client_msg(app, hub, id, m);
                }
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), WouldBlock | TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn handle_client_msg(app: &AppHandle, hub: &Hub, client: u64, m: ClientMsg) {
    match m.t.as_str() {
        "attach" | "detach" | "input" => {
            let Some(pane) = m.pane else { return };
            match m.t.as_str() {
                "attach" => hub.attach(client, pane),
                "detach" => hub.detach(client, pane),
                _ => {
                    if let Some(data) = m.data {
                        let reg = app.state::<crate::pty_ipc::PtyRegistry>();
                        let _ = reg.write(pane, data.as_bytes());
                    }
                }
            }
        }
        "state" => {
            if let Some(state) = m.state {
                let _ = app.emit("remote://state", state);
            }
        }
        "rpc" => {
            let (Some(id), Some(cmd)) = (m.id, m.cmd) else {
                return;
            };
            if !RPC_ALLOWED.contains(&cmd.as_str()) {
                hub.send_to(client, rpc_reply(id, false, "\"허용되지 않은 명령\""));
                return;
            }
            let _ = app.emit(
                "remote://rpc",
                serde_json::json!({ "client": client, "id": id, "cmd": cmd, "args": m.args }),
            );
        }
        _ => {}
    }
}

fn rpc_reply(id: u64, ok: bool, result_json: &str) -> Out {
    Out::Text(format!(
        r#"{{"t":"rpc","id":{id},"ok":{ok},"result":{result_json}}}"#
    ))
}

// ── IPC ───────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    enabled: bool,
    running: bool,
    /// 폰에서 열 주소 (토큰 포함). 실행 중일 때만.
    url: Option<String>,
    /// HTTPS 주소 (`tailscale serve`). 열렸을 때만.
    https_url: Option<String>,
    https: bool,
    error: Option<String>,
    clients: usize,
}

fn status_of(remote: &Remote, hub: &Hub) -> RemoteStatus {
    let cfg = remote.cfg();
    let server = remote.server.lock().unwrap();
    RemoteStatus {
        enabled: cfg.enabled,
        running: server.is_some(),
        url: server
            .as_ref()
            .map(|s| format!("http://{}/mobile.html#{}", s.addr, cfg.token)),
        https_url: server.as_ref().and_then(|s| {
            s.https_host
                .as_ref()
                .map(|h| format!("https://{h}:{HTTPS_PORT}/mobile.html#{}", cfg.token))
        }),
        https: cfg.https,
        error: remote.error.lock().unwrap().clone(),
        clients: hub.client_count(),
    }
}

#[tauri::command]
pub fn remote_status(remote: State<'_, Remote>, hub: State<'_, Hub>) -> RemoteStatus {
    status_of(&remote, &hub)
}

#[tauri::command]
pub fn remote_set_enabled(
    app: AppHandle,
    remote: State<'_, Remote>,
    hub: State<'_, Hub>,
    enabled: bool,
) -> Result<RemoteStatus, String> {
    remote.update_cfg(|c| c.enabled = enabled)?;
    remote.apply(&app);
    Ok(status_of(&remote, &hub))
}

#[tauri::command]
pub fn remote_set_https(
    app: AppHandle,
    remote: State<'_, Remote>,
    hub: State<'_, Hub>,
    enabled: bool,
) -> Result<RemoteStatus, String> {
    remote.update_cfg(|c| c.https = enabled)?;
    remote.apply(&app);
    Ok(status_of(&remote, &hub))
}

/// 토큰을 새로 만든다. 이미 붙어 있던 폰은 끊기고, 이전 주소는 더 이상 쓸 수 없다.
#[tauri::command]
pub fn remote_regenerate_token(
    app: AppHandle,
    remote: State<'_, Remote>,
    hub: State<'_, Hub>,
) -> Result<RemoteStatus, String> {
    remote.update_cfg(|c| c.token = new_token())?;
    remote.apply(&app);
    Ok(status_of(&remote, &hub))
}

/// 폰의 rpc 요청을 PC 프론트가 처리한 결과. `result`는 JSON 문자열.
#[tauri::command]
pub fn remote_rpc_reply(
    hub: State<'_, Hub>,
    client: u64,
    id: u64,
    ok: bool,
    result: String,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&result).map_err(|e| e.to_string())?;
    hub.send_to(client, rpc_reply(id, ok, &result));
    Ok(())
}

/// 프론트가 앱 상태와 pane ↔ PTY 대응(JSON)을 밀어 준다.
#[tauri::command]
pub fn remote_set_layout(hub: State<'_, Hub>, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    hub.set_layout(json);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_compare() {
        assert!(token_eq("abc", "abc"));
        assert!(!token_eq("abc", "abd"));
        assert!(!token_eq("abc", "ab"));
    }

    #[test]
    fn tokens_are_random_hex() {
        let (a, b) = (new_token(), new_token());
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn replay_is_capped_and_attach_replays() {
        let hub = Hub::default();
        hub.open(1, 80, 24);
        hub.output(1, &vec![b'x'; REPLAY_MAX + 10]);
        let (tx, rx) = mpsc::sync_channel(8);
        let id = hub.join(tx);
        hub.attach(id, 1);
        assert!(matches!(rx.try_recv(), Ok(Out::Text(t)) if t.contains("attached")));
        match rx.try_recv() {
            Ok(Out::Bin(b)) => assert_eq!(b.len(), 4 + REPLAY_MAX),
            _ => panic!("재생 데이터 없음"),
        }
        hub.output(1, b"hi");
        assert!(matches!(rx.try_recv(), Ok(Out::Bin(b)) if &b[4..] == b"hi"));
        hub.detach(id, 1);
        hub.output(1, b"no");
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn query_parsing() {
        assert_eq!(query_get("a=1&t=zz", "t"), Some("zz"));
        assert_eq!(query_get("a=1", "t"), None);
    }
}
