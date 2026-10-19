//! pane 셸의 자식 프로세스에서 실행 중인 AI CLI를 찾는다 (일반 셸에서 `claude`를 직접 친 경우).

use std::collections::HashMap;

/// 실행 파일 이름 → provider id. 프론트 `ProviderId`와 같다.
fn provider_of(exe: &str) -> Option<&'static str> {
    match exe {
        "claude.exe" => Some("claude"),
        "codex.exe" => Some("codex"),
        "agy.exe" => Some("antigravity"),
        _ => None,
    }
}

/// (pid, 부모 pid, 소문자 실행 파일 이름) 목록.
#[cfg(windows)]
fn snapshot() -> Vec<(u32, u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    let mut out = Vec::new();
    // SAFETY: 스냅샷 핸들은 이 함수 안에서만 쓰고 닫는다. 엔트리는 dwSize를 채워 넘긴다.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e);
        while ok != 0 {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
            let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
            out.push((e.th32ProcessID, e.th32ParentProcessID, name));
            ok = Process32NextW(snap, &mut e);
        }
        CloseHandle(snap);
    }
    out
}

#[cfg(not(windows))]
fn snapshot() -> Vec<(u32, u32, String)> {
    Vec::new()
}

/// `roots`: (pane id, 셸 pid). 각 셸의 후손 중 AI CLI가 있으면 pane id → provider.
pub fn running_agents(roots: &[(u32, u32)]) -> HashMap<u32, &'static str> {
    find(&snapshot(), roots)
}

fn find(procs: &[(u32, u32, String)], roots: &[(u32, u32)]) -> HashMap<u32, &'static str> {
    let mut children: HashMap<u32, Vec<usize>> = HashMap::new();
    for (i, (_, ppid, _)) in procs.iter().enumerate() {
        children.entry(*ppid).or_default().push(i);
    }
    let mut found = HashMap::new();
    for &(pane, root) in roots {
        let mut stack = vec![root];
        let mut seen = std::collections::HashSet::new();
        while let Some(pid) = stack.pop() {
            if !seen.insert(pid) {
                continue;
            }
            for &i in children.get(&pid).into_iter().flatten() {
                if let Some(p) = provider_of(&procs[i].2) {
                    found.insert(pane, p);
                }
                stack.push(procs[i].0);
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_agent_among_descendants() {
        let procs = vec![
            (10, 1, "pwsh.exe".to_string()),
            (11, 10, "node.exe".to_string()),
            (12, 11, "claude.exe".to_string()),
            (20, 1, "pwsh.exe".to_string()),
            (30, 1, "claude.exe".to_string()),
        ];
        let found = find(&procs, &[(1, 10), (2, 20)]);
        assert_eq!(found.get(&1), Some(&"claude"));
        assert_eq!(found.get(&2), None);
    }
}
