import { useCallback, useEffect, useRef, useState } from 'react';
import { liveNoise, onGameEvent, terminalBridge, useGame } from '../session.ts';
import { useSettings } from '../settings.ts';
import { useT } from '../ui.ts';
import { Debrief } from './Debrief.tsx';
import { Messenger } from './Messenger.tsx';
import { NetworkMap } from './NetworkMap.tsx';
import { Notebook } from './Notebook.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Terminal } from './Terminal.tsx';
import { type Rect, Window } from './Window.tsx';

type WinId = 'terminal' | 'ada' | 'notes' | 'debrief';

function defaultLayout(): Record<WinId, Rect> {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const side = Math.min(380, Math.max(300, W * 0.27));
  const termW = Math.min(860, W - side - 28 * 3);
  const termH = Math.max(300, Math.min(520, H * 0.54));
  const adaH = Math.max(220, (H - 68 - 28 - 16) * 0.56);
  const dw = Math.min(820, W - 80);
  const dh = Math.min(760, H - 100);
  return {
    terminal: { x: 28, y: 68, w: termW, h: termH },
    ada: { x: W - side - 28, y: 68, w: side, h: adaH },
    notes: { x: W - side - 28, y: 68 + adaH + 16, w: side, h: H - 68 - adaH - 16 - 28 },
    debrief: { x: (W - dw) / 2, y: Math.max(56, (H - dh) / 2 + 10), w: dw, h: dh },
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
export function Desktop({ onQuit }: { onQuit(): void }) {
  const game = useGame();
  const t = useT();
  const { effects, locale, guidance } = useSettings();
  const [layout, setLayout] = useState(defaultLayout);
  const [order, setOrder] = useState<WinId[]>(['notes', 'ada', 'terminal']);
  const [noise, setNoise] = useState(() => liveNoise(game));
  const [card, setCard] = useState<string | null>(game.state.missionDone ? null : game.state.mission);
  const [debrief, setDebrief] = useState(false);
  const [stamp, setStamp] = useState(0);
  const [detect, setDetect] = useState(false);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const active = debrief ? 'debrief' : order[order.length - 1]!;

  const focus = useCallback(
    (id: WinId) => setOrder((o) => (o[o.length - 1] === id ? o : [...o.filter((x) => x !== id), id])),
    [],
  );

  // The game speaks the interface language.
  useEffect(() => game.setLocale(locale), [game, locale]);
  useEffect(() => {
    game.guidance = guidance;
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
      if (e.type === 'FlagSubmitted' && e.correct) setStamp((s) => s + 1);
      else if (e.type === 'NpcMessage') setUnread(true);
      else if (e.type === 'MissionStarted') {
        setDebrief(false);
        setCard(e.mission);
      } else if (e.type === 'Detected') {
        setDetect(true);
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
  }, []);

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

  const pack = card ? game.missions.get(card) : undefined;
  const rect = (id: WinId) => layout[id];
  const change = (id: WinId) => (r: Rect) => setLayout((l) => ({ ...l, [id]: r }));
  const z = (id: WinId) => 10 + order.indexOf(id);

  return (
    <div className={`stage${debrief ? ' blue' : ''}${detect ? ' detect' : ''}`} ref={stage}>
      <NetworkMap blue={debrief} />
      <div className="ambient" />
      <StatusBar noise={noise} onResetLayout={() => setLayout(defaultLayout())} onQuit={onQuit} />

      <Window
        id="terminal"
        name={t('win.terminal')}
        subtitle={`${game.user}@${game.playerHost.hostname.split('.')[0]}`}
        meta="lrsh"
        tint="attack"
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
        meta={game.mission ? `${t('notes.stage')} · ${game.mission.stage}` : undefined}
        tint="human"
        rect={rect('notes')}
        z={z('notes')}
        active={active === 'notes'}
        onFocus={() => focus('notes')}
        onChange={change('notes')}
      >
        <Notebook onDebrief={() => setDebrief(true)} />
      </Window>

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
              onClose={() => setDebrief(false)}
              onNext={() => {
                const next = game.nextMission();
                if (next) game.startMission(next.id);
              }}
            />
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
              {t('card.mission')} {String(pack.mission?.order ?? 0).padStart(2, '0')}
            </div>
            <h1>{pack.title[locale] ?? pack.title.fr ?? pack.title.en}</h1>
            <div className="rule" />
          </div>
        </div>
      )}
    </div>
  );
}
