import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Strict Content Security Policy, added to the production build only (the dev server needs inline
 * scripts for hot reload). No third-party origin is allowed: no CDN, no analytics, no remote fonts.
 * The one outside address is api.anthropic.com, reached only when the player sets their own API key.
 * `style-src 'unsafe-inline'` is required by xterm.js, which positions its rows with inline styles.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Headers for hosts that read a `_headers` file (Cloudflare Pages, Netlify). The policy is the same
 * as the meta tag, plus what only a real header can say. GitHub Pages ignores the file: there, the
 * meta tag alone applies.
 */
const HEADERS = `/*
  Content-Security-Policy: ${CSP}; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/packs/index.json
  Cache-Control: no-cache
`;

const csp = (): Plugin => ({
  name: 'breach-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: '_headers', source: HEADERS });
  },
});

export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  build: { target: 'es2022' },
});
