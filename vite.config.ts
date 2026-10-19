import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import process from 'node:process';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  // Tauri 개발용 설정: Rust 에러를 가리지 않고, 포트를 고정한다.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },

  build: {
    // 데스크톱 앱(index)과 모바일 원격 페이지(mobile)를 같이 빌드한다
    rollupOptions: { input: { main: 'index.html', mobile: 'mobile.html' } },
  },

  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
