import type { Game } from '@breach/engine';
import { useEffect, useRef } from 'react';
import { currentGame, liveNoise, onGameEvent } from '../session.ts';
import { getSettings } from '../settings.ts';

const KIND: Record<string, string> = {
  player: '#EEF2FF',
  host: '#8FA0C4',
  ai: '#9B5CFF',
  unknown: '#7D8BAA',
};

interface Node {
  id: string;
  label: string;
  ip: string;
  kind: string;
  x: number;
  z: number;
  h: number;
  links: string[];
  vis: number;
  wave: number;
}

interface Label {
  n: Node;
  /** Top of the pillar: the label's first choice is just above it. */
  ax: number;
  ay: number;
  /** The node's disc on the ground. */
  px: number;
  py: number;
  rx: number;
  ry: number;
  ring: string | null;
  fill: string;
  depth: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

const LABEL_H = 30;
const GAP = 4;
const overlap = (a: Box, b: Box) => a.l < b.r + GAP && a.r + GAP > b.l && a.t < b.b + GAP && a.b + GAP > b.t;

/**
 * Labels are laid out after every node is drawn, so a pillar never covers a name.
 * Nearest hosts choose first. Each label tries above its pillar, then below, right and left of
 * its disc, and takes the first spot that covers neither another label nor another host's disc.
 * If none is free, it climbs above whatever is in the way. A dotted leader ties a moved label
 * back to its host.
 */
function drawLabels(cx: CanvasRenderingContext2D, labels: Label[], fk: number) {
  const big = fk > 0.5;
  const nameFont = `600 ${big ? 13 : 12}px "JetBrains Mono", monospace`;
  const ipFont = `400 ${big ? 11 : 10}px "JetBrains Mono", monospace`;
  cx.font = nameFont;
  const discs: Box[] = labels.map((l) => ({
    l: l.px - l.rx * 1.5,
    r: l.px + l.rx * 1.5,
    t: l.py - l.ry * 1.5,
    b: l.py + l.ry * 1.5,
  }));
  const placed: { l: Label; box: Box; from: [number, number] | null; to: [number, number] }[] = [];
  const free = (box: Box) => !discs.some((d) => overlap(box, d)) && !placed.some((o) => overlap(box, o.box));
  const boxAt = (x: number, top: number, w: number): Box => ({
    l: x - w / 2,
    r: x + w / 2,
    t: top,
    b: top + LABEL_H,
  });
  for (const l of [...labels].sort((a, b) => b.depth - a.depth)) {
    const w = Math.max(cx.measureText(l.n.label).width, 70) + 16;
    const side = l.rx * 1.5 + 10;
    const mid = l.py - LABEL_H / 2;
    const candidates: { box: Box; from: [number, number] | null }[] = [
      { box: boxAt(l.ax, l.ay - 4 - LABEL_H, w), from: null },
      { box: boxAt(l.px, l.py + l.ry * 1.5 + 8, w), from: [l.px, l.py + l.ry * 1.5] },
      { box: boxAt(l.px + side + w / 2, mid, w), from: [l.px + l.rx * 1.5, l.py] },
      { box: boxAt(l.px - side - w / 2, mid, w), from: [l.px - l.rx * 1.5, l.py] },
    ];
    let pick = candidates.find((c) => free(c.box));
    if (!pick) {
      const box = { ...candidates[0]!.box };
      for (let k = 0; k <= labels.length * 2; k++) {
        const hit = placed.find((o) => overlap(box, o.box))?.box ?? discs.find((d) => overlap(box, d));
        if (!hit) break;
        box.b = hit.t - GAP;
        box.t = box.b - LABEL_H;
      }
      pick = { box, from: box.b < l.ay - 8 ? [l.ax, l.ay - 2] : null };
    }
    const b = pick.box;
    const to: [number, number] =
      pick.from === null || pick.from[1] > b.b
        ? [(b.l + b.r) / 2, b.b]
        : pick.from[1] < b.t
          ? [(b.l + b.r) / 2, b.t]
          : pick.from[0] < b.l
            ? [b.l, (b.t + b.b) / 2]
            : [b.r, (b.t + b.b) / 2];
    placed.push({ l, box: b, from: pick.from, to });
  }
  cx.textAlign = 'center';
  for (const { l, box, from, to } of [...placed].reverse()) {
    cx.globalAlpha = l.n.vis;
    const edge = `${l.ring ?? l.fill}aa`;
    if (from) {
      cx.beginPath();
      cx.moveTo(from[0], from[1]);
      cx.lineTo(to[0], to[1]);
      cx.strokeStyle = edge;
      cx.lineWidth = 1;
      cx.setLineDash([2, 3]);
      cx.stroke();
      cx.setLineDash([]);
    }
    const x = (box.l + box.r) / 2;
    cx.fillStyle = 'rgba(7,9,15,0.86)';
    cx.fillRect(box.l, box.t, box.r - box.l, LABEL_H);
    cx.strokeStyle = edge;
    cx.lineWidth = 1;
    cx.strokeRect(box.l + 0.5, box.t + 0.5, box.r - box.l - 1, LABEL_H - 1);
    cx.font = nameFont;
    cx.fillStyle = '#fff';
    cx.fillText(l.n.label, x, box.t + 14);
    cx.font = ipFont;
    cx.fillStyle = '#8FA0C4';
    cx.fillText(l.n.ip, x, box.t + 26);
  }
  cx.globalAlpha = 1;
}

/**
 * The network map, drawn as the desktop wallpaper. Hosts appear when the player discovers them,
 * at the moment the engine emits `HostDiscovered`, in step with the terminal output.
 * Lot 0 uses a light canvas projection; the react-three-fiber version comes with lot 2.
 */
/**
 * A host is drawn once the player has found it. A defender is handed the network he protects: the
 * hosts a defence mission reveals are on the map from the start.
 */
function onMap(game: Game, id: string, kind: string | undefined): boolean {
  if (kind === 'player' || id in game.state.discovered) return true;
  const mission = game.mission;
  return mission?.side === 'defense' && mission.reveal.includes(id);
}

export function NetworkMap({ blue, focus = false }: { blue: boolean; focus?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const blueRef = useRef(blue);
  blueRef.current = blue;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext('2d')!;
    const game: Game = currentGame();
    const nodes: Node[] = game.world.hosts.map((h) => ({
      id: h.id,
      label: h.kind === 'player' ? game.user : h.kind === 'unknown' ? '???' : h.hostname.split('.')[0]!,
      ip: h.ip,
      kind: h.kind,
      x: h.map.x,
      z: h.map.z,
      h: h.map.h,
      links: h.links,
      vis: onMap(game, h.id, h.kind) ? 1 : 0,
      wave: 0,
    }));
    const by = new Map(nodes.map((n) => [n.id, n]));
    const contacted = new Set<string>();
    const playerId = game.world.player.host;
    for (const e of game.log) if (e.type === 'HttpRequest' || e.type === 'RepoCloned') contacted.add(e.host);
    const off = onGameEvent((e) => {
      if (e.type === 'HostDiscovered') {
        const n = by.get(e.host);
        if (n && n.vis < 1) n.wave = 1;
      } else if (e.type === 'HttpRequest' || e.type === 'RepoCloned') {
        const n = by.get(e.host);
        if (n && n.vis < 1 && !contacted.has(e.host)) n.wave = 1;
        contacted.add(e.host);
      } else if (e.type === 'Restored') {
        contacted.clear();
        for (const x of currentGame().log)
          if (x.type === 'HttpRequest' || x.type === 'RepoCloned') contacted.add(x.host);
      }
    });

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let ang = -0.35;
    let last = performance.now();
    let frame = 0;
    // 0 = wallpaper under the windows, 1 = map view (windows set aside, map centred and larger).
    let fk = focusRef.current ? 1 : 0;
    const proj = (x: number, y: number, z: number) => {
      const wall = Math.min(1.15, Math.max(0.55, (W - 380) / 1150));
      const full = Math.min(1.5, Math.max(0.7, Math.min(W / 1250, H / 760)));
      const scale = wall + (full - wall) * fk;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const rx = x * ca - z * sa;
      const rz = x * sa + z * ca;
      const tilt = 0.52;
      const yy = y * Math.cos(tilt) - rz * Math.sin(tilt);
      const zz = y * Math.sin(tilt) + rz * Math.cos(tilt);
      const f = (900 / (900 + zz + 300)) * scale;
      const ox = (W - 380) * 0.5 + 10 + (W * 0.5 - ((W - 380) * 0.5 + 10)) * fk;
      const oy = H * (0.74 - 0.12 * fk);
      return { x: ox + rx * f, y: oy - yy * f, s: f };
    };

    const draw = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const g = currentGame();
      const effects = getSettings().effects;
      const isBlue = blueRef.current;
      if (effects) ang += dt * 0.00004;
      const target = focusRef.current ? 1 : 0;
      fk = effects ? fk + (target - fk) * Math.min(1, dt / 160) : target;
      if (Math.abs(target - fk) < 0.001) fk = target;
      cx.clearRect(0, 0, W, H);
      const t = liveNoise(g) / 100;
      for (const n of nodes) {
        // A machine the player has talked to is found, even without a scan.
        const shown = onMap(g, n.id, n.kind) || contacted.has(n.id);
        n.vis = shown ? Math.min(1, n.vis + dt / (effects ? 700 : 1)) : 0;
      }
      cx.lineWidth = 1;
      for (let r = 120; r <= 600; r += 120) {
        cx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          const p = proj(Math.cos(a) * r, 0, Math.sin(a) * r);
          if (i) cx.lineTo(p.x, p.y);
          else cx.moveTo(p.x, p.y);
        }
        cx.strokeStyle = isBlue ? 'rgba(45,226,255,0.10)' : 'rgba(125,139,170,0.08)';
        cx.stroke();
      }
      cx.strokeStyle = 'rgba(125,139,170,0.045)';
      for (let k = -600; k <= 600; k += 100) {
        let a = proj(k, 0, -600);
        let b = proj(k, 0, 600);
        cx.beginPath();
        cx.moveTo(a.x, a.y);
        cx.lineTo(b.x, b.y);
        cx.stroke();
        a = proj(-600, 0, k);
        b = proj(600, 0, k);
        cx.beginPath();
        cx.moveTo(a.x, a.y);
        cx.lineTo(b.x, b.y);
        cx.stroke();
      }
      // Radar sweep: its colour follows the noise gauge.
      const sw = (effects ? (now / 4000) % 1 : 0.1) * Math.PI * 2;
      const c0 = proj(0, 0, 0);
      const c1 = proj(Math.cos(sw) * 600, 0, Math.sin(sw) * 600);
      const grd = cx.createLinearGradient(c0.x, c0.y, c1.x, c1.y);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(
        1,
        isBlue ? 'rgba(45,226,255,0.25)' : `rgba(255,61,90,${(0.08 + t * 0.2).toFixed(2)})`,
      );
      cx.beginPath();
      cx.moveTo(c0.x, c0.y);
      cx.lineTo(c1.x, c1.y);
      cx.strokeStyle = grd;
      cx.lineWidth = 2;
      cx.stroke();

      let li = 0;
      for (const A of nodes) {
        for (const id of A.links) {
          const B = by.get(id);
          if (!B) continue;
          li++;
          const vis = Math.min(A.vis, B.vis);
          if (vis <= 0.01) continue;
          const hot =
            (A.id === playerId && contacted.has(B.id)) || (B.id === playerId && contacted.has(A.id));
          const pa = proj(A.x, 0, A.z);
          const pb = proj(B.x, 0, B.z);
          const col = isBlue
            ? hot
              ? '#FFB020'
              : 'rgba(45,226,255,0.35)'
            : hot
              ? '#FF3D5A'
              : 'rgba(143,160,196,0.28)';
          cx.globalAlpha = vis;
          cx.beginPath();
          cx.moveTo(pa.x, pa.y);
          cx.lineTo(pb.x, pb.y);
          cx.strokeStyle = col;
          cx.lineWidth = hot ? 2 : 1;
          if (hot) {
            cx.shadowColor = col;
            cx.shadowBlur = 14;
          }
          cx.stroke();
          cx.shadowBlur = 0;
          if (hot && effects)
            for (let k = 0; k < 2; k++) {
              const u = (now / 1600 + li * 0.17 + k * 0.5) % 1;
              cx.beginPath();
              cx.arc(pa.x + (pb.x - pa.x) * u, pa.y + (pb.y - pa.y) * u, 2.5, 0, 7);
              cx.fillStyle = isBlue ? '#FFD27A' : '#FF8FA0';
              cx.shadowColor = cx.fillStyle;
              cx.shadowBlur = 10;
              cx.fill();
              cx.shadowBlur = 0;
            }
          cx.globalAlpha = 1;
        }
      }

      const order = nodes.map((n) => ({ n, p: proj(n.x, 0, n.z) })).sort((a, b) => a.p.s - b.p.s);
      const labels: Label[] = [];
      for (const { n, p } of order) {
        if (n.vis <= 0.01) continue;
        let fill = KIND[n.kind] ?? KIND.host!;
        if (isBlue && n.kind === 'player') fill = '#FF3D5A';
        const ring = n.id !== playerId && contacted.has(n.id) ? (isBlue ? '#FFB020' : '#FF3D5A') : null;
        const top = proj(n.x, n.h * n.vis, n.z);
        const pg = cx.createLinearGradient(p.x, p.y, top.x, top.y);
        pg.addColorStop(0, fill);
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        cx.globalAlpha = n.vis;
        cx.strokeStyle = pg;
        cx.lineWidth = 3;
        cx.shadowColor = fill;
        cx.shadowBlur = 16;
        cx.beginPath();
        cx.moveTo(p.x, p.y);
        cx.lineTo(top.x, top.y);
        cx.stroke();
        cx.shadowBlur = 0;
        const rx = 26 * p.s;
        const ry = 10 * p.s;
        cx.beginPath();
        cx.ellipse(p.x, p.y, rx, ry, 0, 0, 7);
        cx.fillStyle = `${fill}33`;
        cx.fill();
        cx.lineWidth = 2;
        cx.strokeStyle = fill;
        cx.stroke();
        if (ring) {
          cx.beginPath();
          cx.ellipse(p.x, p.y, rx * 1.45, ry * 1.45, 0, 0, 7);
          cx.strokeStyle = ring;
          cx.shadowColor = ring;
          cx.shadowBlur = 18;
          cx.stroke();
          cx.shadowBlur = 0;
        }
        if (n.wave > 0) {
          const k = 1 - n.wave;
          cx.beginPath();
          cx.ellipse(p.x, p.y, rx * (1.5 + k * 6), ry * (1.5 + k * 6), 0, 0, 7);
          cx.strokeStyle = `rgba(238,242,255,${(n.wave * 0.8).toFixed(2)})`;
          cx.lineWidth = 2;
          cx.stroke();
          n.wave = Math.max(0, n.wave - dt / 1400);
        }
        const ly = Math.min(top.y, p.y - ry * 1.45 - 2);
        labels.push({ n, ax: top.x, ay: ly, px: p.x, py: p.y, rx, ry, ring, fill, depth: p.s });
        cx.globalAlpha = 1;
      }
      drawLabels(cx, labels, fk);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      off();
    };
  }, []);

  return <canvas ref={ref} className="map" role="img" aria-label="Network map" />;
}
