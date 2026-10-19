// 자동 업데이트용 latest.json을 만든다. `pnpm tauri build` 뒤에 실행한다.
// 사용: node scripts/make-latest-json.mjs [릴리스 노트]
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const dir = 'src-tauri/target/release/bundle/nsis';
const exe = `LaDock_${version}_x64-setup.exe`;
const signature = readFileSync(`${dir}/${exe}.sig`, 'utf8').trim();

const latest = {
  version,
  notes: process.argv[2] ?? '',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/pyjhoop/LaDock/releases/download/v${version}/${exe}`,
    },
  },
};
writeFileSync(`${dir}/latest.json`, JSON.stringify(latest, null, 2));
console.log(`${dir}/latest.json (v${version})`);
