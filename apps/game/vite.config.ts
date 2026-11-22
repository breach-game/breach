import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Strict Content Security Policy, added to the production build only (the dev server needs inline
 * scripts for hot reload). No third-party origin is allowed: no CDN, no analytics, no remote fonts.
 * `style-src 'unsafe-inline'` is required by xterm.js, which positions its rows with inline styles.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'breach-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
});

export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
