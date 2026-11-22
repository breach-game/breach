import { useEffect, useRef, useState } from 'react';
import type { PackProgress } from '../packs.ts';
import { type StartMode, start } from '../session.ts';
import { getSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

interface Line {
  id: number;
  text: string;
  ok: boolean;
}

const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, getSettings().effects ? ms : Math.min(ms, 30)));

/** Boot sequence of LR-OS. The log lines are real: packs are downloaded and verified here. */
export function Boot({
  mode,
  onReady,
  onFail,
}: {
  mode: StartMode;
  onReady: () => void;
  onFail: () => void;
}) {
  const t = useT();
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the boot sequence runs once
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let next = 0;
    const add = (key: UiKey, vars?: Record<string, string | number>) => {
      const id = next++;
      setLines((l) => [...l, { id, text: t(key, vars), ok: false }]);
      return () => setLines((l) => l.map((x) => (x.id === id ? { ...x, ok: true } : x)));
    };
    (async () => {
      try {
        let done = add('boot.disk');
        await sleep(380);
        done();
        done = add('boot.vpn');
        await sleep(420);
        done();
        done = add('boot.catalog');
        const pending = new Map<string, () => void>();
        const onProgress = (p: PackProgress) => {
          const vars = { id: p.entry.id, version: p.entry.version };
          done();
          if (p.state === 'verified') pending.get(p.entry.id)?.();
          else
            pending.set(
              p.entry.id,
              add(p.state === 'cached' ? 'boot.pack.cached' : 'boot.pack.downloading', vars),
            );
        };
        const game = await start(mode, onProgress);
        done();
        await sleep(250);
        done = add('boot.mandate', { mandate: game.world.mandate });
        await sleep(350);
        done();
        done = add('boot.scope', { scope: game.world.scope.domains.join(', ') });
        await sleep(450);
        done();
        await sleep(350);
        onReady();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div className="boot">
      <div className="boot-log" role="status">
        {lines.map((l) => (
          <div className="line" key={l.id}>
            {l.text} {l.ok ? <span className="ok">{t('boot.ok')}</span> : '…'}
          </div>
        ))}
        {error && (
          <div className="line" style={{ marginTop: 18 }}>
            <div className="title-error">
              {t('title.error')} {error}
            </div>
            <button type="button" className="btn" style={{ marginTop: 14 }} onClick={onFail}>
              {t('title.retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
