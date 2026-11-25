import { useCallback, useEffect, useRef, useState } from 'react';
import { playSfx, setScene, setTension } from '../audio.ts';
import type { Go } from '../screens/Journey.tsx';
import { liveNoise, missionNumber, onGameEvent, terminalBridge, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { useT } from '../ui.ts';
import { BrainSettings } from './BrainSettings.tsx';
import { Browser } from './Browser.tsx';
import { Debrief } from './Debrief.tsx';
import { Editor } from './Editor.tsx';
import { ImageViewer } from './ImageViewer.tsx';
import { Messenger } from './Messenger.tsx';
import { NetworkMap } from './NetworkMap.tsx';
import { Notebook } from './Notebook.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Terminal } from './Terminal.tsx';
import { type Rect, Window } from './Window.tsx';

type WinId = 'terminal' | 'ada' | 'notes' | 'browser' | 'editor' | 'viewer' | 'debrief' | 'brain';

function defaultLayout(): Record<WinId, Rect> {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const side = Math.min(380, Math.max(300, W * 0.27));
  const termW = Math.min(860, W - side - 28 * 3);
  const termH = Math.max(300, Math.min(520, H * 0.54));
  const adaH = Math.max(220, (H - 68 - 28 - 16) * 0.56);
  const dw = Math.min(820, W - 80);
  const dh = Math.min(760, H - 100);
  const bw = Math.min(900, W - side - 28 * 3 - 40);
  return {
    browser: { x: 68, y: 104, w: Math.max(420, bw), h: Math.max(360, H - 104 - 72) },
    editor: {
      x: 96,
      y: 132,
      w: Math.max(420, Math.min(760, bw)),
      h: Math.max(320, Math.min(520, H - 132 - 72)),
    },
    viewer: {
      x: Math.max(28, termW - 380),
      y: 96,
      w: Math.min(440, W - 56),
      h: Math.min(520, H - 96 - 72),
    },
    terminal: { x: 28, y: 68, w: termW, h: termH },
    ada: { x: W - side - 28, y: 68, w: side, h: adaH },
    notes: { x: W - side - 28, y: 68 + adaH + 16, w: side, h: H - 68 - adaH - 16 - 28 },
    debrief: { x: (W - dw) / 2, y: Math.max(56, (H - dh) / 2 + 10), w: dw, h: dh },
    brain: {
      x: (W - Math.min(620, W - 80)) / 2,
      y: Math.max(56, (H - Math.min(800, H - 76)) / 2 + 10),
      w: Math.min(620, W - 80),
      h: Math.min(800, H - 76),
    },
  };
}

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return `#${A.map((v, i) =>
    Math.round(v + (B[i]! - v) * t)
      .toString(16)
      .padStart(2, '0'),
  ).join('')}`;
};

/** The LR-OS desktop: the whole screen is the pentester's workstation. */
export function Desktop({ onQuit }: { onQuit(to?: Go): void }) {
  const game = useGame();
  const t = useT();
  const { effects, locale, guidance } = useSettings();
  const [layout, setLayout] = useState(defaultLayout);
  const [order, setOrder] = useState<WinId[]>(['notes', 'ada', 'terminal']);
  const [noise, setNoise] = useState(() => liveNoise(game));
  const [card, setCard] = useState<string | null>(game.state.missionDone ? null : game.state.mission);
  const [debrief, setDebrief] = useState(false);
  const [brain, setBrain] = useState(false);
  const [stamp, setStamp] = useState(0);
  const [detect, setDetect] = useState(false);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(false);
  const [mapView, setMapView] = useState(false);
  const [mapNew, setMapNew] = useState(false);
  const mapViewRef = useRef(mapView);
  mapViewRef.current = mapView;
  const [browser, setBrowser] = useState<{
    url: string;
    nonce: number;
    kind: 'ai' | 'web';
    open: boolean;
  } | null>(null);
  const [editor, setEditor] = useState<{ path: string; nonce: number; open: boolean } | null>(null);
  const [viewer, setViewer] = useState<{ path: string; nonce: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const active = debrief ? 'debrief' : order[order.length - 1]!;

  const focus = useCallback(
    (id: WinId) => setOrder((o) => (o[o.length - 1] === id ? o : [...o.filter((x) => x !== id), id])),
    [],
  );

  const openBrowser = useCallback(
    (url?: string) => {
      setBrowser((b) => ({
        url: url ?? b?.url ?? '',
        nonce: url === undefined ? (b?.nonce ?? 0) : (b?.nonce ?? 0) + 1,
        kind: b?.kind ?? 'web',
        open: true,
      }));
      focus('browser');
    },
    [focus],
  );
  const onNavigate = useCallback(
    (url: string, kind: 'ai' | 'web') => setBrowser((b) => (b ? { ...b, url, kind } : b)),
    [],
  );

  // The game speaks the interface language.
  useEffect(() => game.setLocale(locale), [game, locale]);
  useEffect(() => {
    if (game.guidance !== guidance) game.setGuidance(guidance);
  }, [game, guidance]);

  // Live gauge: noise decays between commands.
  useEffect(() => {
    const timer = setInterval(() => setNoise(liveNoise(game)), 400);
    return () => clearInterval(timer);
  }, [game]);
  useEffect(() => setNoise(liveNoise(game)), [game, game.state.noise]);

  // Ambient light follows the tension.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const k = noise / 100;
    el.style.setProperty('--tension', k.toFixed(2));
    setTension(k);
    if (debrief) return;
    const amb =
      k < 0.4
        ? mix('#3b2a7a', '#4a3a6a', k / 0.4)
        : k < 0.7
          ? mix('#4a3a6a', '#8a5a10', (k - 0.4) / 0.3)
          : mix('#8a5a10', '#a01a2e', (k - 0.7) / 0.3);
    el.style.setProperty('--amb', amb);
    el.style.setProperty('--edge', k < 0.7 ? '0' : (((k - 0.7) / 0.3) * 0.6).toFixed(2));
  }, [noise, debrief]);

  // Engine events drive the big moments. Glitch is an event, never a permanent state.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const off = onGameEvent((e) => {
      if (e.type === 'FlagSubmitted') {
        if (e.correct) setStamp((s) => s + 1);
        playSfx(e.correct ? 'flag' : 'wrong');
      } else if (e.type === 'NpcMessage') {
        setUnread(true);
        playSfx('message');
      } else if (e.type === 'AppOpened' && e.app === 'editor') {
        setEditor((ed) => ({ path: e.url, nonce: (ed?.nonce ?? 0) + 1, open: true }));
        focus('editor');
        playSfx('open');
      } else if (e.type === 'AppOpened' && e.app === 'image') {
        setViewer((v) => ({ path: e.url, nonce: (v?.nonce ?? 0) + 1 }));
        focus('viewer');
        playSfx('open');
      } else if (e.type === 'AppOpened') {
        openBrowser(e.url);
        playSfx('open');
      } else if (e.type === 'HostDiscovered') {
        if (!mapViewRef.current) setMapNew(true);
      } else if (e.type === 'ChatReply') playSfx('reply');
      else if (e.type === 'ObjectiveCompleted') playSfx('objective');
      else if (e.type === 'OutOfScope') playSfx('wrong');
      else if (e.type === 'MissionStarted') {
        setDebrief(false);
        setCard(e.mission);
      } else if (e.type === 'Detected') {
        setDetect(true);
        playSfx('detect');
        for (const el of document.querySelectorAll('.win')) {
          el.classList.remove('glitch');
          void (el as HTMLElement).offsetWidth;
          el.classList.add('glitch');
        }
        later(() => setDetect(false), 4200);
      }
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, [openBrowser, focus]);

  // Music: the desk loop during a mission, a calmer one behind the debrief, silence on leaving.
  useEffect(() => {
    setScene(debrief ? 'debrief' : 'desk');
    return () => setScene('off');
  }, [debrief]);

  useEffect(() => {
    if (!card) return;
    const timer = setTimeout(
      () => {
        setCard(null);
        terminalBridge.focus?.();
      },
      effects ? 2400 : 900,
    );
    return () => clearTimeout(timer);
  }, [card, effects]);

  useEffect(() => {
    if (active === 'ada') setUnread(false);
  }, [active]);

  // Map view: the windows step aside and the network map takes the whole screen.
  const leaveMap = useCallback(() => {
    setMapView(false);
    terminalBridge.focus?.();
  }, []);
  useEffect(() => {
    if (!mapView) return;
    setMapNew(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') leaveMap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapView, leaveMap]);
  useEffect(() => {
    if (debrief || card) setMapView(false);
  }, [debrief, card]);

  const pack = card ? game.missions.get(card) : undefined;
  const rect = (id: WinId) => layout[id];
  const change = (id: WinId) => (r: Rect) => setLayout((l) => ({ ...l, [id]: r }));
  const z = (id: WinId) => 10 + order.indexOf(id);

  return (
    <div
      className={`stage${debrief ? ' blue' : ''}${detect ? ' detect' : ''}${mapView ? ' mapview' : ''}`}
      ref={stage}
    >
      <NetworkMap blue={debrief} focus={mapView} />
      <div className="ambient" />
      <StatusBar
        noise={noise}
        onResetLayout={() => setLayout(defaultLayout())}
        onQuit={() => onQuit()}
        onBrain={() => setBrain(true)}
      />

      <Window
        id="terminal"
        name={t('win.terminal')}
        subtitle={`${game.currentUser}@${game.currentHost.hostname.split('.')[0]}`}
        meta="lrsh"
        tint={game.mission?.side === 'defense' ? 'defense' : 'attack'}
        rect={rect('terminal')}
        z={z('terminal')}
        active={active === 'terminal'}
        onFocus={() => focus('terminal')}
        onChange={change('terminal')}
      >
        <Terminal active={active === 'terminal' && !card} />
      </Window>

      <Window
        id="ada"
        name={t('win.ada')}
        subtitle="Ada"
        meta={
          <>
            {unread && active !== 'ada' && <i className="unread" />}
            <span style={{ color: typing ? 'var(--text)' : 'var(--dim)' }}>
              ● {t(typing ? 'win.ada.typing' : 'win.ada.online')}
            </span>
          </>
        }
        tint="human"
        rect={rect('ada')}
        z={z('ada')}
        active={active === 'ada'}
        onFocus={() => focus('ada')}
        onChange={change('ada')}
      >
        <Messenger paused={card !== null} onTyping={setTyping} />
      </Window>

      <Window
        id="notes"
        name={t('win.notes')}
        subtitle={t('win.notes.objectives')}
        meta={game.mission ? `${t('notes.stage')} · ${game.stageName()}` : undefined}
        tint="human"
        rect={rect('notes')}
        z={z('notes')}
        active={active === 'notes'}
        onFocus={() => focus('notes')}
        onChange={change('notes')}
      >
        <Notebook onDebrief={() => setDebrief(true)} />
      </Window>

      {browser && (
        <Window
          id="browser"
          name={t('win.browser')}
          subtitle={/^https?:\/\/([^/]+)/.exec(browser.url)?.[1]}
          tint={browser.kind === 'ai' ? 'ai' : 'attack'}
          rect={rect('browser')}
          z={z('browser')}
          active={active === 'browser'}
          onFocus={() => focus('browser')}
          onChange={change('browser')}
          onClose={() => {
            setBrowser((b) => (b ? { ...b, open: false } : b));
            setOrder((o) => (o.length > 1 ? o.filter((x) => x !== 'browser') : o));
            terminalBridge.focus?.();
          }}
          closeLabel={t('win.close')}
          hidden={!browser.open}
        >
          <Browser
            url={browser.url}
            nonce={browser.nonce}
            active={active === 'browser' && browser.open && !card}
            onNavigate={onNavigate}
          />
        </Window>
      )}

      {editor && (
        <Window
          id="editor"
          name={t('win.editor')}
          subtitle={editor.path.split('/').pop()}
          meta={editor.path}
          tint="defense"
          rect={rect('editor')}
          z={z('editor')}
          active={active === 'editor'}
          onFocus={() => focus('editor')}
          onChange={change('editor')}
          onClose={() => {
            setEditor((ed) => (ed ? { ...ed, open: false } : ed));
            setOrder((o) => (o.length > 1 ? o.filter((x) => x !== 'editor') : o));
            terminalBridge.focus?.();
          }}
          closeLabel={t('win.close')}
          hidden={!editor.open}
        >
          <Editor
            path={editor.path}
            nonce={editor.nonce}
            active={active === 'editor' && editor.open && !card}
            onVerify={() => {
              focus('terminal');
              terminalBridge.focus?.();
              terminalBridge.run?.('verify');
            }}
          />
        </Window>
      )}

      {viewer && (
        <Window
          id="viewer"
          name={t('win.viewer')}
          subtitle={viewer.path.split('/').pop()}
          meta={viewer.path}
          tint="defense"
          rect={rect('viewer')}
          z={z('viewer')}
          active={active === 'viewer'}
          onFocus={() => focus('viewer')}
          onChange={change('viewer')}
          onClose={() => {
            setViewer(null);
            setOrder((o) => (o.length > 1 ? o.filter((x) => x !== 'viewer') : o));
            terminalBridge.focus?.();
          }}
          closeLabel={t('win.close')}
        >
          <ImageViewer key={viewer.nonce} path={viewer.path} />
        </Window>
      )}

      <nav className="dock" aria-label={t('dock.label')}>
        {(
          [
            ['terminal', '>_'],
            ['browser', '◎'],
            ['ada', 'A'],
            ['notes', '☰'],
          ] as const
        ).map(([id, glyph]) => (
          <button
            key={id}
            type="button"
            aria-pressed={!mapView && active === id}
            data-open={id !== 'browser' || browser?.open === true}
            onClick={() => {
              setMapView(false);
              if (id === 'browser') openBrowser();
              else focus(id);
              if (id === 'terminal') terminalBridge.focus?.();
            }}
          >
            <i aria-hidden="true">{glyph}</i>
            {t(`win.${id}`)}
          </button>
        ))}
        {editor && (
          // Once a file was opened, the editor stays one click away, on the last file.
          <button
            type="button"
            aria-pressed={!mapView && active === 'editor' && editor.open}
            data-open={editor.open}
            title={editor.path}
            onClick={() => {
              setMapView(false);
              setEditor((ed) => (ed ? { ...ed, open: true } : ed));
              focus('editor');
            }}
          >
            <i aria-hidden="true">✎</i>
            {t('win.editor')}
          </button>
        )}
        <button
          type="button"
          aria-pressed={mapView}
          data-open="true"
          data-new={mapNew}
          title={t('map.toggle')}
          onClick={() => (mapView ? leaveMap() : setMapView(true))}
        >
          <i aria-hidden="true">◇</i>
          {t('win.map')}
        </button>
      </nav>

      {mapView && (
        <div className="map-legend" role="status">
          <b>{t('map.title')}</b>
          <ul>
            <li>
              <i className="k-player" aria-hidden="true" />
              {t('map.legend.player')}
            </li>
            <li>
              <i className="k-host" aria-hidden="true" />
              {t('map.legend.host')}
            </li>
            <li>
              <i className="k-ai" aria-hidden="true" />
              {t('map.legend.ai')}
            </li>
            <li>
              <i className="k-hit" aria-hidden="true" />
              {t('map.legend.contacted')}
            </li>
          </ul>
          <button type="button" className="btn" onClick={leaveMap}>
            {t('map.back')}
          </button>
        </div>
      )}

      {debrief && (
        <>
          <div className="veil" />
          <Window
            id="debrief"
            className="pop"
            name={t('win.debrief')}
            subtitle="Blue Team"
            tint="defense"
            rect={rect('debrief')}
            z={45}
            active
            onFocus={() => {}}
            onChange={change('debrief')}
          >
            <Debrief
              onLeave={onQuit}
              onClose={() => setDebrief(false)}
              onNext={() => {
                const next = game.nextMission();
                if (next) game.startMission(next.id);
              }}
            />
          </Window>
        </>
      )}

      {brain && (
        <>
          <div className="veil" />
          <Window
            id="brain"
            className="pop"
            name={t('win.brain')}
            subtitle="BYOK"
            tint="ai"
            rect={rect('brain')}
            z={46}
            active
            onFocus={() => {}}
            onChange={change('brain')}
            onClose={() => setBrain(false)}
            closeLabel={t('win.close')}
          >
            <BrainSettings onClose={() => setBrain(false)} />
          </Window>
        </>
      )}

      {game.state.missionDone && !debrief && !card && (
        <div className="ready" role="status">
          <span>
            <b>{t('debrief.complete')}</b>
            {t('ready.body')}
          </span>
          <button type="button" className="btn defense" onClick={() => setDebrief(true)}>
            {t('ready.open')} →
          </button>
        </div>
      )}

      {stamp > 0 && (
        <div className="stamp" key={stamp} role="status">
          {t('flag.stamp')}
        </div>
      )}
      {detect && (
        <div className="banner" role="alert">
          <div>
            <b>{t('detect.title')}</b>
            <br />
            {t('detect.body')}
          </div>
        </div>
      )}
      <div className="scan" />
      <div className="grain" />
      <div className="vignette" />

      {pack && (
        <div className={`card${effects ? '' : ' static'}`} key={card} aria-live="polite">
          <div className="card-inner">
            <div className="num">
              {t(pack.track === 'training' ? 'card.training' : 'card.mission')} {missionNumber(game)}
            </div>
            <h1>{pack.title[locale] ?? pack.title.fr ?? pack.title.en}</h1>
            <div className="rule" />
          </div>
        </div>
      )}
    </div>
  );
}
