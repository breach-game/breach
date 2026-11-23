import { type BrowseResult, pageHtml } from '@breach/engine';
import type { Block } from '@breach/pack-schema';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { elapsed, touch, useGame } from '../session.ts';
import { type UiKey, useT } from '../ui.ts';
import { NpcChat } from './NpcChat.tsx';
import { PageForm } from './PageForm.tsx';

/** Render `code` spans. Anything else is plain text: content never becomes HTML. */
function rich(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

interface Props {
  /** Address to show. Changing `nonce` loads it again (the `open` command, the dock). */
  url: string;
  nonce: number;
  active: boolean;
  onNavigate(url: string, kind: 'ai' | 'web'): void;
}

/**
 * The workstation's browser. It draws pages from the world pack and never loads anything from the
 * real network: an address is resolved by the engine, through the same scope gate as `curl`.
 */
export function Browser({ url, nonce, active, onNavigate }: Props) {
  const game = useGame();
  const t = useT();
  const [address, setAddress] = useState(url);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [source, setSource] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const locale = game.state.locale;

  const load = useCallback(
    (raw: string, push = true) => {
      const target = raw.trim();
      if (!target) return;
      const res = game.browse(target, elapsed());
      touch();
      setResult(res);
      setAddress(res.url);
      setSource(false);
      if (push) setHistory((h) => (h[h.length - 1] === res.url ? h : [...h, res.url]));
      const ai =
        res.ok &&
        (res.host.kind === 'ai' ||
          (res.page?.blocks ?? []).some((b) => 'chat' in b && game.npc(b.chat)?.kind === 'ai'));
      onNavigate(res.url, ai ? 'ai' : 'web');
      view.current?.scrollTo({ top: 0 });
    },
    [game, onNavigate],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load when asked from outside, not on every render
  useEffect(() => {
    if (url) load(url);
    else input.current?.focus();
  }, [nonce]);

  useEffect(() => {
    if (active && !result) input.current?.focus();
  }, [active, result]);

  const go = (href: string) => {
    if (/^https?:\/\//i.test(href)) return load(href);
    const base = /^(https?:\/\/[^/]+)/.exec(result?.url ?? '')?.[1];
    if (base) load(`${base}${href.startsWith('/') ? href : `/${href}`}`);
  };
  const back = () => {
    if (history.length < 2) return;
    const previous = history[history.length - 2]!;
    setHistory((h) => h.slice(0, -1));
    load(previous, false);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    load(address);
  };

  const link = (l: { href: string; label: string }, key?: number) => (
    <button type="button" className="page-link" key={key} onClick={() => go(l.href)}>
      {rich(game.t(l.label))}
    </button>
  );
  const block = (b: Block, i: number): ReactNode => {
    if ('h1' in b) return <h1 key={i}>{rich(game.t(b.h1))}</h1>;
    if ('h2' in b) return <h2 key={i}>{rich(game.t(b.h2))}</h2>;
    if ('p' in b) return <p key={i}>{rich(game.t(b.p))}</p>;
    if ('list' in b)
      return (
        <ul key={i}>
          {b.list.map((item, j) => (
            <li key={j}>{rich(game.t(item))}</li>
          ))}
        </ul>
      );
    if ('code' in b) return <pre key={i}>{game.t(b.code)}</pre>;
    if ('nav' in b) return <nav key={i}>{b.nav.map((l, j) => link(l, j))}</nav>;
    if ('link' in b) return <p key={i}>{link(b.link)}</p>;
    if ('chat' in b) return <NpcChat key={i} npcId={b.chat} active={active} />;
    if ('form' in b) return <PageForm key={i} form={b.form} />;
    if ('table' in b)
      return (
        <table key={i}>
          <thead>
            <tr>
              {b.table.head.map((cell, j) => (
                <th key={j}>{rich(game.t(cell))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((row, j) => (
              <tr key={j}>
                {row.map((cell, k) => (
                  <td key={k}>{rich(game.t(cell))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    if ('footer' in b) return <footer key={i}>{rich(game.t(b.footer))}</footer>;
    return null; // A comment only exists in the source.
  };

  const host = /^https?:\/\/([^/:]+)/.exec(result?.url ?? '')?.[1] ?? address;
  return (
    <div className="browser">
      <form className="browser-bar" onSubmit={submit}>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('browser.back')}
          title={t('browser.back')}
          disabled={history.length < 2}
          onClick={back}
        >
          ←
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('browser.reload')}
          title={t('browser.reload')}
          disabled={!result}
          onClick={() => result && load(result.url, false)}
        >
          ↻
        </button>
        <input
          ref={input}
          className="browser-url"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          aria-label={t('browser.address')}
          placeholder={t('browser.placeholder')}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
        {result?.ok && (
          <button
            type="button"
            className="browser-src"
            aria-pressed={source}
            onClick={() => setSource((s) => !s)}
          >
            {'</>'} {t(source ? 'browser.page' : 'browser.source')}
          </button>
        )}
      </form>
      <div className="browser-view scroll" ref={view}>
        {!result && (
          <div className="page-msg">
            <b>{t('browser.blank.title')}</b>
            <p>{t('browser.blank.body')}</p>
          </div>
        )}
        {result && !result.ok && (
          <div className="page-msg error" role="alert">
            <b>{t(`browser.err.${result.error}` as UiKey)}</b>
            <p>{t(`browser.err.${result.error}.body` as UiKey, { host })}</p>
          </div>
        )}
        {result?.ok && (source || !result.page) && (
          <pre className="page-source">
            {source && (
              <span className="src-note">
                {t('browser.source.note')}
                {'\n\n'}
              </span>
            )}
            {result.page ? pageHtml(result.page, result.host, locale, (k) => game.t(k)) : result.source}
          </pre>
        )}
        {result?.ok && !source && result.page && (
          <article className="page" data-status={result.status}>
            {result.page.blocks.map(block)}
          </article>
        )}
      </div>
      <div className="browser-status">
        {result?.ok ? `${result.status} · ${result.page ? game.t(result.page.title) : host}` : ' '}
      </div>
    </div>
  );
}
