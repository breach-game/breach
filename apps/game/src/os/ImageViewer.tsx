import { qrMatrix, readQr } from '@breach/engine';
import { useMemo } from 'react';
import { useGame } from '../session.ts';
import { useT } from '../ui.ts';

const QUIET = 4;

/**
 * The workstation's image viewer, opened by `qr show <file>`. A QR code is drawn module by module
 * in SVG, dark on light with its quiet zone, so that a phone can read it off the screen. Its
 * address is always a reserved name of the pack: reading it leads nowhere.
 */
export function ImageViewer({ path }: { path: string }) {
  const game = useGame();
  const t = useT();
  const code = useMemo(() => {
    const raw = game.readFile(path);
    const qr = raw ? readQr(raw) : null;
    const m = qr ? qrMatrix(qr.text) : null;
    if (!qr || !m) return null;
    let d = '';
    m.forEach((row, r) => {
      row.forEach((dark, c) => {
        if (dark) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      });
    });
    return { d, size: m.length + QUIET * 2, fancy: qr.style === 'fancy' };
  }, [game, path]);

  if (!code) return <p className="editor-msg">{t('viewer.unreadable')}</p>;
  return (
    <div className="viewer">
      <svg
        className={`viewer-code${code.fancy ? ' fancy' : ''}`}
        viewBox={`0 0 ${code.size} ${code.size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={t('viewer.alt', { file: path.split('/').pop() ?? path })}
      >
        <rect width={code.size} height={code.size} className="viewer-paper" />
        <path d={code.d} className="viewer-ink" />
      </svg>
      <p className="viewer-note">{t('viewer.note')}</p>
    </div>
  );
}
