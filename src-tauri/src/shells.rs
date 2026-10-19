//! 셸 프로필 감지. 감지에 실패한 셸은 목록에서 빼고 로그(stderr)에만 남긴다.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub args: Vec<String>,
    pub is_default: bool,
}

const DEFAULT_ID: &str = "pwsh";

fn profile(id: &str, name: &str, path: &Path, args: &[&str]) -> ShellProfile {
    ShellProfile {
        id: id.into(),
        name: name.into(),
        path: path.to_string_lossy().into_owned(),
        args: args.iter().map(|s| s.to_string()).collect(),
        is_default: false,
    }
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

fn find_in_path(exe: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|d| d.join(exe))
        .find(|p| p.is_file())
}

fn detect_pwsh() -> Option<ShellProfile> {
    let alias = env_path("LOCALAPPDATA")
        .map(|d| d.join(r"Microsoft\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe"));
    let installed = env_path("ProgramFiles").map(|d| d.join(r"PowerShell\7\pwsh.exe"));
    let path = [alias, installed]
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .or_else(|| find_in_path("pwsh.exe"))?;
    Some(profile("pwsh", "PowerShell 7", &path, &[]))
}

fn system32(exe: &str) -> Option<PathBuf> {
    let p = env_path("SystemRoot")?.join("System32").join(exe);
    p.is_file().then_some(p)
}

fn detect_powershell() -> Option<ShellProfile> {
    let p = env_path("SystemRoot")?.join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    p.is_file()
        .then(|| profile("powershell", "Windows PowerShell 5.1", &p, &[]))
}

fn detect_cmd() -> Option<ShellProfile> {
    Some(profile("cmd", "명령 프롬프트", &system32("cmd.exe")?, &[]))
}

fn detect_git_bash() -> Option<ShellProfile> {
    let candidates = [
        env_path("ProgramFiles").map(|d| d.join(r"Git\bin\bash.exe")),
        env_path("LOCALAPPDATA").map(|d| d.join(r"Programs\Git\bin\bash.exe")),
    ];
    let path = candidates.into_iter().flatten().find(|p| p.is_file())?;
    Some(profile("bash", "Git Bash", &path, &["--login", "-i"]))
}

/// `wsl -l -q` 출력은 UTF-16LE (BOM 없음일 수도 있다).
fn decode_utf16le(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
        .trim_start_matches('\u{feff}')
        .to_string()
}

/// 배포판 이름 목록. docker-desktop 내부 배포판은 쓸 수 없어서 뺀다.
fn parse_wsl_list(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim().trim_matches('\0'))
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .map(String::from)
        .collect()
}

fn detect_wsl() -> Vec<ShellProfile> {
    let Some(wsl) = system32("wsl.exe") else {
        return vec![];
    };
    let mut cmd = Command::new(&wsl);
    cmd.args(["-l", "-q"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = match cmd.output() {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            eprintln!("[shells] wsl -l -q 실패: {}", o.status);
            return vec![];
        }
        Err(e) => {
            eprintln!("[shells] wsl 실행 실패: {e}");
            return vec![];
        }
    };
    parse_wsl_list(&decode_utf16le(&out.stdout))
        .into_iter()
        .map(|name| {
            profile(
                &format!("wsl:{name}"),
                &format!("WSL · {name}"),
                &wsl,
                &["-d", &name],
            )
        })
        .collect()
}

pub fn detect() -> Vec<ShellProfile> {
    let mut list: Vec<ShellProfile> = [
        detect_pwsh(),
        detect_powershell(),
        detect_cmd(),
        detect_git_bash(),
    ]
    .into_iter()
    .flatten()
    .chain(detect_wsl())
    .collect();
    let default = list.iter().position(|p| p.id == DEFAULT_ID).unwrap_or(0);
    if let Some(p) = list.get_mut(default) {
        p.is_default = true;
    }
    list
}

/// 감지 결과 캐시. 앱을 켜 둔 동안 셸을 새로 깔 일은 드물다.
fn cached() -> &'static Vec<ShellProfile> {
    static CACHE: OnceLock<Vec<ShellProfile>> = OnceLock::new();
    CACHE.get_or_init(detect)
}

/// profileId → (실행 파일, 인자). 감지 목록에 없으면 pwsh.exe로 폴백.
pub fn resolve(profile_id: &str) -> (String, Vec<String>) {
    match cached().iter().find(|p| p.id == profile_id) {
        Some(p) => (p.path.clone(), p.args.clone()),
        None => ("pwsh.exe".into(), vec![]),
    }
}

#[tauri::command]
pub fn shells_detect() -> Vec<ShellProfile> {
    cached().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16le_wsl_output() {
        let text = "Ubuntu\r\ndocker-desktop\r\nDebian\r\n";
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(text.encode_utf16().flat_map(|u| u.to_le_bytes()));
        let names = parse_wsl_list(&decode_utf16le(&bytes));
        assert_eq!(names, vec!["Ubuntu", "Debian"]);
    }

    #[test]
    fn empty_wsl_output_gives_no_distros() {
        assert!(parse_wsl_list(&decode_utf16le(&[])).is_empty());
    }

    #[test]
    fn resolve_unknown_falls_back_to_pwsh() {
        assert_eq!(resolve("nope-xyz").0, "pwsh.exe");
    }

    #[test]
    fn exactly_one_default() {
        let list = detect();
        assert!(list.iter().filter(|p| p.is_default).count() <= 1);
        if !list.is_empty() {
            assert!(list.iter().any(|p| p.is_default));
        }
    }
}
