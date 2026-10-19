# M1-06 셸 프로필 감지

- 마일스톤: M1 세션·탭·pane · 의존: M0-02, M1-04
- 참고: [architecture.md › 데이터 모델](../architecture.md#데이터-모델) (`ShellProfile`), `design-mvp.html`의 `SHELLS`, 사이드바 "셸 프로필"

## 목표
PC에 있는 셸을 자동으로 찾아서, 사이드바에서 골라 새 pane으로 띄운다.

## 할 일
- [ ] `shells_detect` 명령
- [ ] 감지 대상: `pwsh`(7.x), `powershell`(5.1), `cmd`, Git Bash, WSL 배포판
- [ ] 사이드바 "셸 프로필" 목록 → 클릭하면 포커스된 pane 오른쪽에 그 셸로 새 pane (cwd 상속)
- [ ] 기본 셸 표시 (기본값 pwsh, 바꾸는 UI는 M3-02)

## 명세 · 주의점
- 이 PC의 `pwsh`는 `%LOCALAPPDATA%\Microsoft\WindowsApps\Microsoft.PowerShell_8wekyb3d8bbwe\pwsh.exe` (앱 실행 별칭) → ConPTY에서 이 경로로 정상 실행되는지 확인하고, 안 되면 실제 설치 경로를 찾는다
- Git Bash: `C:\Program Files\Git\bin\bash.exe` (없으면 레지스트리 · PATH로 찾기), 인자 `--login -i`
- WSL: `wsl -l -q` 출력은 **UTF-16LE** → 디코딩 주의, 배포판별 프로필 `wsl:<이름>`
- 감지 실패한 셸은 목록에서 빼고, 오류는 로그로만

## 완료 기준
- [ ] 이 PC에서 설치된 셸이 빠짐없이 나옴
- [ ] 각 셸로 pane을 띄워서 프롬프트가 정상 동작

## 작업 기록
