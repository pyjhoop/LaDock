//! AI 에이전트용 스킬 설치. LaDock을 설치 · 업데이트하고 처음 켤 때 자동으로 한다.
//!
//! 스킬 원본(`skills/ladock-panes/SKILL.md`)은 실행 파일에 내장돼 있다. 설치된 AI 플랫폼마다 그 플랫폼의
//! 스킬 폴더에 같은 파일을 놓는다. 우리가 놓은 파일(`managed-by: ladock` 표시)만 갱신하고,
//! 같은 이름의 남의 파일은 건드리지 않는다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const NAME: &str = "ladock-panes";
const SKILL: &str = include_str!("../../skills/ladock-panes/SKILL.md");
const MARK: &str = "managed-by: ladock";

/// (플랫폼, 감지 기준 폴더들, 스킬 폴더). 기준 폴더가 하나라도 있으면 그 플랫폼이 설치된 것으로 본다.
fn targets(home: &Path) -> Vec<(&'static str, Vec<PathBuf>, PathBuf)> {
    let gemini_skills = home.join(".gemini").join("config").join("skills");
    let mut v = vec![
        (
            "Claude Code",
            vec![home.join(".claude")],
            home.join(".claude").join("skills"),
        ),
        (
            "Codex",
            vec![home.join(".codex")],
            home.join(".codex").join("skills"),
        ),
        // Antigravity(agy) · Gemini CLI는 공통 `~/.agents/skills`를 읽는다.
        (
            "Antigravity · Gemini",
            vec![home.join(".agents"), home.join(".gemini")],
            home.join(".agents").join("skills"),
        ),
    ];
    // agy의 스킬 폴더가 공통 폴더로 연결돼 있지 않고 따로 있는 경우
    if gemini_skills.is_dir() && !is_link(&gemini_skills) {
        v.push((
            "Antigravity (config)",
            vec![gemini_skills.clone()],
            gemini_skills,
        ));
    }
    v
}

fn is_link(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillResult {
    pub platform: String,
    pub path: String,
    /// installed(새로 설치) · updated(갱신) · current(이미 최신) · skipped(미설치 플랫폼) ·
    /// foreign(남의 파일이라 건드리지 않음) · error
    pub state: String,
    pub detail: Option<String>,
}

fn result(platform: &str, path: &Path, state: &str, detail: Option<String>) -> SkillResult {
    SkillResult {
        platform: platform.into(),
        path: path.display().to_string(),
        state: state.into(),
        detail,
    }
}

fn install_one(platform: &str, detect: &[PathBuf], skills_dir: &Path) -> SkillResult {
    let file = skills_dir.join(NAME).join("SKILL.md");
    if !detect.iter().any(|d| d.exists()) {
        return result(platform, &file, "skipped", None);
    }
    let existing = fs::read_to_string(&file).ok();
    match existing.as_deref() {
        Some(t) if t == SKILL => return result(platform, &file, "current", None),
        Some(t) if !t.contains(MARK) => {
            return result(
                platform,
                &file,
                "foreign",
                Some("같은 이름의 다른 스킬이 있어 건드리지 않음".into()),
            );
        }
        _ => {}
    }
    let state = if existing.is_some() {
        "updated"
    } else {
        "installed"
    };
    let write = || -> std::io::Result<()> {
        fs::create_dir_all(file.parent().unwrap())?;
        let tmp = file.with_extension("md.tmp");
        fs::write(&tmp, SKILL)?;
        fs::rename(&tmp, &file)
    };
    match write() {
        Ok(()) => result(platform, &file, state, None),
        Err(e) => result(platform, &file, "error", Some(e.to_string())),
    }
}

fn install_in(home: &Path) -> Vec<SkillResult> {
    targets(home)
        .iter()
        .map(|(p, detect, dir)| install_one(p, detect, dir))
        .collect()
}

/// 설치된 AI 플랫폼에 스킬을 설치 · 갱신한다. 이미 최신이면 아무것도 쓰지 않는다.
pub fn install_all() -> Vec<SkillResult> {
    match std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        Some(home) => install_in(Path::new(&home)),
        None => Vec::new(),
    }
}

/// 앱을 켤 때 백그라운드로 한 번 (업데이트 후 첫 실행에서도 새 스킬이 반영된다).
pub fn install_background() {
    std::thread::spawn(|| {
        for r in install_all() {
            if matches!(
                r.state.as_str(),
                "installed" | "updated" | "error" | "foreign"
            ) {
                eprintln!("스킬 {}: {} ({})", r.platform, r.state, r.path);
            }
        }
    });
}

/// 설정에서 [다시 설치]
#[tauri::command]
pub fn skills_install() -> Vec<SkillResult> {
    install_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ladock-skills-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn state_of(r: &[SkillResult], platform: &str) -> String {
        r.iter()
            .find(|x| x.platform == platform)
            .unwrap()
            .state
            .clone()
    }

    #[test]
    fn skill_text_is_marked_and_named() {
        assert!(SKILL.contains(MARK));
        assert!(
            SKILL
                .replace("\r\n", "\n")
                .starts_with("---\nname: ladock-panes\n")
        );
    }

    #[test]
    fn installs_only_where_platform_exists() {
        let home = temp_home("only");
        fs::create_dir_all(home.join(".claude")).unwrap();
        let r = install_in(&home);
        assert_eq!(state_of(&r, "Claude Code"), "installed");
        assert_eq!(state_of(&r, "Codex"), "skipped");
        assert!(home.join(".claude/skills/ladock-panes/SKILL.md").exists());
        assert!(!home.join(".codex").exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn second_run_is_current_and_old_version_updates() {
        let home = temp_home("again");
        fs::create_dir_all(home.join(".codex")).unwrap();
        assert_eq!(state_of(&install_in(&home), "Codex"), "installed");
        assert_eq!(state_of(&install_in(&home), "Codex"), "current");
        let f = home.join(".codex/skills/ladock-panes/SKILL.md");
        fs::write(&f, format!("옛 버전 <!-- {MARK} -->")).unwrap();
        assert_eq!(state_of(&install_in(&home), "Codex"), "updated");
        assert_eq!(fs::read_to_string(&f).unwrap(), SKILL);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn never_overwrites_foreign_skill() {
        let home = temp_home("foreign");
        let f = home.join(".claude/skills/ladock-panes/SKILL.md");
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(&f, "내가 쓴 스킬").unwrap();
        assert_eq!(state_of(&install_in(&home), "Claude Code"), "foreign");
        assert_eq!(fs::read_to_string(&f).unwrap(), "내가 쓴 스킬");
        let _ = fs::remove_dir_all(&home);
    }
}
