import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Unity 6.3 WebGL 프로젝트에서 마이그레이션한 HomePlanner3 웹 버전 빌드 설정.
// 같은 React 호스트 안에 임베드해서 부모와 props/콜백으로 통신한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // MuTracer 는 OIDN 가중치(.tza)를 패키지 상대 경로로 읽는다 — 사전 번들(.vite/deps)로 옮기면
  // 경로가 깨져 jsDelivr 로 우회 다운로드한다. 패키지 원래 위치에서 서빙되도록 제외.
  optimizeDeps: {
    exclude: ['@meimu/mutracer'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5190,
    host: '0.0.0.0',   // LAN/외부 PC 접속 허용 (admin iframe이 :5190으로 로드)
    strictPort: true,
    allowedHosts: true,   // 터널(trycloudflare.com 등) 도메인 허용
    // Homvue(언리얼) 이식 에셋 — 변환 결과 폴더(D:\HP3_assets\homvue)를 로컬 정적 서버(8791)로 띄워 두고
    // /homvue/** 를 그쪽으로 넘긴다. 배포 때는 CDN 주소로 바꾼다 (features/homvue/homvueAssets.ts).
    proxy: {
      '/homvue': {
        target: 'http://127.0.0.1:8791',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/homvue/, ''),
      },
    },
  },
  preview: {
    port: 5190,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});