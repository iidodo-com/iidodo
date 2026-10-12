import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 本番ビルドにのみ厳格なCSPを付与する（外部への通信・外部スクリプトを禁止）。
// 開発サーバー(HMR)はインラインスクリプトとWebSocketを使うため対象外。
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "worker-src 'self' blob:", "connect-src 'self'", "frame-src blob: about:", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml: (html) => html.replace('<title>', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  <title>`),
    },
  ],
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
