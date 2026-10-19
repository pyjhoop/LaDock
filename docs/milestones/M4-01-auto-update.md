# M4-01 자동 업데이트

- 마일스톤: M4 배포 · 의존: M3-03
- 참고: Tauri v2 updater 플러그인 (`tauri-plugin-updater`, `tauri-plugin-process`)

## 목표
새 버전이 나오면 앱 안에서 알려주고, 확인을 누르면 받아서 설치하고 다시 시작한다. 설정에서도 직접 확인할 수 있다.

## 할 일
- [x] 서명 키 생성 (`pnpm tauri signer generate`), 공개키를 `tauri.conf.json`의 `plugins.updater.pubkey`에
- [x] updater · process 플러그인 등록, capability(`updater:default`, `process:allow-restart`)
- [x] `createUpdaterArtifacts` — 빌드 시 `.sig` 생성
- [x] 프론트 store `features/update/updater.ts` (확인 → 받기 → 설치 → 재시작)
- [x] 알림 배너 `UpdateBanner` (오른쪽 아래, [지금 업데이트] · [나중에]) — 릴리스 빌드에서 기동 3초 뒤 자동 확인(실패는 조용히 무시)
- [x] 설정 › 업데이트: 현재 버전, [업데이트 확인], 새 버전이 있으면 [업데이트하고 다시 시작]
- [x] `scripts/make-latest-json.mjs` — 배포용 `latest.json` 생성
- [x] 실제 업데이트 end-to-end 확인 — 사용자 지시로 완료 처리, 미검증 (v1.1.0 설치 후 다음 릴리스에서 확인)

## 완료 기준
- [x] 서명된 설치 파일 + `.sig` 생성
- [x] 설치된 이전 버전이 새 릴리스를 감지하고 업데이트 후 새 버전으로 재시작 (미검증, 위와 동일)

## 릴리스 절차 (로컬 빌드)
1. `package.json` · `src-tauri/Cargo.toml` · `src-tauri/tauri.conf.json`의 버전을 올린다.
2. 서명 키를 환경변수로 주고 빌드한다 (PowerShell):
   ```
   $env:TAURI_SIGNING_PRIVATE_KEY = "$HOME\.ladock-keys\ladock.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   pnpm tauri build
   node scripts/make-latest-json.mjs "릴리스 노트"
   ```
3. GitHub 릴리스 `vX.Y.Z`를 만들고 `bundle/nsis/`의 `LaDock_X.Y.Z_x64-setup.exe` · `latest.json`을 올린다.
   앱은 `https://github.com/pyjhoop/LaDock/releases/latest/download/latest.json`을 본다.

## 작업 기록
- 2026-10-19: 구현. 서명 키는 `C:\Users\YeonJun\.ladock-keys\ladock.key` (암호 없음, **저장소 밖**, 잃어버리면 기존 설치본에 업데이트를 못 보냄 → 백업 필요).
  - 기본안으로 진행: 배포처는 GitHub Releases (저장소가 `pyjhoop/LaDock`). 저장소가 비공개면 `latest.json`을 못 받으므로 공개이거나 다른 호스팅이 필요하다.
  - 설치 방식 `installMode: passive` (진행바만 보이고 묻지 않음), 이후 `relaunch`.
  - 개발 모드(`pnpm tauri dev`)에서는 자동 확인을 하지 않는다. 설정의 수동 확인은 동작하지만 개발 빌드는 설치형이 아니라 설치 단계가 의미 없다.
  - 로컬에서 `pnpm tauri build`로 서명 설치 파일 + `.sig`, `latest.json` 생성까지 확인. 업데이트 적용 자체는 v1.0.1 릴리스가 있어야 확인 가능해서 미확인.
