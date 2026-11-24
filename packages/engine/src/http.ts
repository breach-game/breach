import type { Block, Host, Page, Route } from '@breach/pack-schema';

export interface Url {
  scheme: 'http' | 'https';
  hostname: string;
  port: number;
  path: string;
}

/** Parse a URL the way a command line tool does. `fallback` is the scheme assumed when none is given. */
export function parseUrl(raw: string, fallback: 'http' | 'https' = 'http'): Url | null {
  const m = /^(?:(https?):\/\/)?([^/:?#\s]+)(?::(\d+))?([^?#\s]*)/i.exec(raw.trim());
  if (!m) return null;
  const scheme = (m[1]?.toLowerCase() ?? fallback) as 'http' | 'https';
  return {
    scheme,
    hostname: m[2]!.toLowerCase(),
    port: Number(m[3] ?? (scheme === 'https' ? 443 : 80)),
    path: m[4] || '/',
  };
}

export function formatUrl(url: Url): string {
  const standard = url.port === (url.scheme === 'https' ? 443 : 80);
  return `${url.scheme}://${url.hostname}${standard ? '' : `:${url.port}`}${url.path}`;
}

export const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  301: 'Moved Permanently',
  302: 'Found',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  500: 'Internal Server Error',
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Escape a text and turn `code` spans into <code> elements. */
const inline = (s: string) =>
  s
    .trim()
    .split('`')
    .map((part, i) => (i % 2 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)))
    .join('');

function blockHtml(block: Block, host: Host, t: (key: string) => string): string {
  const link = (l: { href: string; label: string }) =>
    `<a href="${escapeHtml(l.href)}">${inline(t(l.label))}</a>`;
  if ('h1' in block) return `<h1>${inline(t(block.h1))}</h1>`;
  if ('h2' in block) return `<h2>${inline(t(block.h2))}</h2>`;
  if ('p' in block) return `<p>${inline(t(block.p))}</p>`;
  if ('list' in block)
    return `<ul>\n${block.list.map((item) => `    <li>${inline(t(item))}</li>`).join('\n')}\n  </ul>`;
  if ('code' in block) return `<pre>${escapeHtml(t(block.code).trimEnd())}</pre>`;
  if ('nav' in block) return `<nav>${block.nav.map(link).join(' ')}</nav>`;
  if ('link' in block) return `<p>${link(block.link)}</p>`;
  if ('comment' in block) return `<!-- ${t(block.comment).trim().replace(/--+/g, '-')} -->`;
  if ('form' in block) {
    const f = block.form;
    const endpoint = Object.entries(host.web ?? {}).find(([, r]) => r.chat === f.to)?.[0] ?? '';
    return `<form method="post" action="${escapeHtml(endpoint)}">\n    <label>${inline(t(f.label))} <input name="${f.name}"></label>\n    <button>${inline(t(f.button))}</button>\n  </form>`;
  }
  if ('table' in block) {
    const row = (cells: string[], tag: string) =>
      `    <tr>${cells.map((c) => `<${tag}>${inline(t(c))}</${tag}>`).join('')}</tr>`;
    return `<table>\n${[row(block.table.head, 'th'), ...block.table.rows.map((r) => row(r, 'td'))].join('\n')}\n  </table>`;
  }
  if ('chat' in block) {
    const endpoint = Object.entries(host.web ?? {}).find(([, r]) => r.chat === block.chat)?.[0];
    return `<div id="chat" data-agent="${escapeHtml(block.chat)}"${endpoint ? ` data-endpoint="${escapeHtml(endpoint)}"` : ''}></div>`;
  }
  if ('copy' in block) {
    // What a page script would write to the clipboard sits in the source, for whoever reads it.
    const note = block.copy.note ? `\n    <p>${inline(t(block.copy.note))}</p>` : '';
    return `<div class="verify">${note}\n    <button type="button" data-clipboard="${escapeHtml(t(block.copy.text)).replace(/"/g, '&quot;')}">${inline(t(block.copy.button))}</button>\n  </div>`;
  }
  return `<footer>${inline(t(block.footer))}</footer>`;
}

/** The HTML a page's blocks stand for: what `curl` and "view source" show. */
export function pageHtml(page: Page, host: Host, locale: string, t: (key: string) => string): string {
  const body = page.blocks.map((b) => `  ${blockHtml(b, host, t)}`).join('\n');
  return `<!doctype html>\n<html lang="${locale}">\n<head><title>${escapeHtml(t(page.title))}</title></head>\n<body>\n${body}\n</body>\n</html>\n`;
}

export function findRoute(host: Host, path: string): Route | undefined {
  return host.web?.[path] ?? host.web?.[path.replace(/\/+$/, '') || '/'];
}

/** What a request carries besides its address: the cookies and headers `curl -b` and `-H` add. */
export interface RequestExtras {
  cookie?: string;
  header?: string;
}

const cookiesOf = (raw: string) =>
  raw
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
const headerOf = (raw: string) => {
  const cut = raw.indexOf(':');
  return cut < 0 ? null : `${raw.slice(0, cut).trim().toLowerCase()}: ${raw.slice(cut + 1).trim()}`;
};

/** True when the request carries the cookie and the header a variant asks for. */
export function variantMatches(v: { cookie?: string; header?: string }, req: RequestExtras): boolean {
  if (v.cookie !== undefined && !cookiesOf(req.cookie ?? '').includes(v.cookie.trim())) return false;
  if (v.header !== undefined && (!req.header || headerOf(req.header) !== headerOf(v.header))) return false;
  return true;
}

export function errorHtml(status: number, product: string): string {
  const title = `${status} ${STATUS_TEXT[status] ?? ''}`.trim();
  return `<html>\n<head><title>${title}</title></head>\n<body>\n<center><h1>${title}</h1></center>\n<hr><center>${product.split(' ')[0]}</center>\n</body>\n</html>\n`;
}

/** The message carried by a request body: JSON `{"message": "..."}`, a form field, or plain text. */
export function chatMessage(data: string): string {
  const raw = data.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const value = o.message ?? o.msg ?? o.text ?? o.q ?? o.prompt;
      return typeof value === 'string' ? value.trim() : '';
    }
    if (typeof parsed === 'string') return parsed.trim();
  } catch {
    // Not JSON: fall through.
  }
  const form = /^[a-z][a-z0-9_]{0,19}=(.*)$/s.exec(raw);
  return (form ? form[1]!.replace(/\+/g, ' ') : raw).trim();
}
