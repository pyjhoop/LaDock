# M1-06 셸 프로필 감지

- 마일스톤: M1 세션·탭·pane · 의존: M0-02, M1-04
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델) (`ShellProfile`), `design-mvp.html`의 `SHELLS`, 사이드바 "셸 프로필"

## 목표
PC에 있는 셸을 자동으로 찾아서, 사이드바에서 골라 새 pane으로 띄운다.

## 할 일
- [x] `shells_detect` 명령
- [x] 감지 대상: `pwsh`(7.x), `powershell`(5.1), `cmd`, Git Bash, WSL 배포판
- [x] 사이드바 "셸 프로필" 목록 → 클릭하면 포커스된 pane 오른쪽에 그 셸로 새 pane (cwd 상속)
- [x] 기본 셸 표시 (기본값 pwsh, 바꾸는 UI는 M3-02)

## 명세 · 주의점
- 이 PC의 `pwsh`는 `%LOCALAPPDATA%\Microsoft\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe` (앱 실행 별칭) → ConPTY에서 이 경로로 정상 실행되는지 확인하고, 안 되면 실제 설치 경로를 찾는다
- Git Bash: `C:\Program Files\Git\bin\bash.exe` (없으면 레지스트리 · PATH로 찾기), 인자 `--login -i`
- WSL: `wsl -l -q` 출력은 **UTF-16LE** → 디코딩 주의, 배포판별 프로필 `wsl:<이름>`
- 감지 실패한 셸은 목록에서 빼고, 오류는 로그로만

## 완료 기준
- [x] 이 PC에서 설치된 셸이 빠짐없이 나옴
- [x] 각 셸로 pane을 띄워서 프롬프트가 정상 동작

## 작업 기록
- 2026-10-19: `src-tauri/src/shells.rs` 추가. 감지 결과는 `OnceLock`으로 캐시하고, `pty_spawn`이 `command`가 없을 때 `shells::resolve(profileId)`로 실행 파일·인자를 정한다 (기존 `resolve_shell` 대체, 목록에 없으면 `pwsh.exe` 폴백). 레지스트리 조회는 의존성을 늘리지 않으려고 생략하고 고정 경로 + PATH만 본다.
- 2026-10-19: 이 PC 감지 결과 — pwsh(앱 실행 별칭 경로 그대로), powershell, cmd, Git Bash(`--login -i`), `wsl:Ubuntu`(`wsl.exe -d Ubuntu`). `docker-desktop*` WSL 배포판은 쓸 수 없어 제외. WSL 출력은 UTF-16LE 디코딩 테스트 있음.
- 2026-10-19: `every_detected_shell_runs`(pty_tests)로 5개 셸 모두 ConPTY에서 실행·종료 코드 0 확인. pwsh 앱 실행 별칭도 정상.
- 2026-10-19: 사이드바 "셸 프로필" 클릭 → `splitFocused('row', profileId)` (cwd 상속). 코드·타입체크·lint·테스트는 통과했지만 **앱을 띄워 클릭해 본 확인은 아직 못 함** → 마지막 완료 기준은 미체크, 상태는 🟨 유지.
- 2026-10-19: 사용자가 앱에서 사이드바 셸 프로필 클릭·프롬프트 동작을 확인해 완료. 사이드바 항목에 시안(`design-mvp.html` SHELLS)과 같은 텍스트 글리프(`>_` `C:` `$` 🐧)와 "기본" 배지를 넣음.
