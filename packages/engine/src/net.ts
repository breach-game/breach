import type { Host, World } from '@breach/pack-schema';
import { globMatch } from './vfs.ts';

export function parseIp(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

export function parseCidr(cidr: string): { base: number; bits: number; size: number } | null {
  const [addr, bitsStr] = cidr.split('/');
  const ip = parseIp(addr ?? '');
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (ip === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, bits, size: 2 ** (32 - bits) };
}

export function inCidr(ip: string, cidr: string): boolean {
  const n = parseIp(ip);
  const c = parseCidr(cidr);
  if (n === null || !c) return false;
  const mask = c.bits === 0 ? 0 : (0xffffffff << (32 - c.bits)) >>> 0;
  return ((n & mask) >>> 0) === c.base;
}

export type Target =
  | { kind: 'host'; host: Host; name: string }
  | { kind: 'range'; cidr: string; hosts: Host[]; size: number }
  | { kind: 'unknown'; name: string }
  | { kind: 'out-of-scope'; name: string };

function domainInScope(world: World, name: string): boolean {
  const n = name.toLowerCase().replace(/\.$/, '');
  return world.scope.domains.some((d) => {
    const bare = d.replace(/^\*\./, '');
    return n === bare || globMatch(d.toLowerCase(), n);
  });
}

function ipInScope(world: World, ip: string): boolean {
  return world.scope.networks.some((n) => inCidr(ip, n));
}

/** Resolve a name through the world's DNS (A and CNAME records). */
export function resolveName(world: World, name: string): string | null {
  let n = name.toLowerCase().replace(/\.$/, '');
  for (let i = 0; i < 5; i++) {
    const rec = world.dns[n];
    if (rec?.A?.[0]) return rec.A[0];
    if (rec?.CNAME?.[0]) n = rec.CNAME[0].replace(/\.$/, '');
    else break;
  }
  return world.hosts.find((h) => h.hostname === n)?.ip ?? null;
}

/**
 * The single gate every network command goes through. Anything outside the mandate's scope is
 * refused before any simulated packet leaves the player's machine.
 */
export function resolveTarget(world: World, raw: string): Target {
  const name = raw.trim();
  if (name.includes('/')) {
    const cidr = parseCidr(name);
    if (!cidr) return { kind: 'unknown', name };
    const first = name.split('/')[0]!;
    if (!ipInScope(world, first) || !world.scope.networks.some((n) => (parseCidr(n)?.bits ?? 33) <= cidr.bits))
      return { kind: 'out-of-scope', name };
    return { kind: 'range', cidr: name, hosts: world.hosts.filter((h) => inCidr(h.ip, name)), size: cidr.size };
  }
  if (parseIp(name) !== null) {
    if (!ipInScope(world, name)) return { kind: 'out-of-scope', name };
    const host = world.hosts.find((h) => h.ip === name);
    return host ? { kind: 'host', host, name } : { kind: 'unknown', name };
  }
  if (name === 'localhost') {
    const host = world.hosts.find((h) => h.id === world.player.host)!;
    return { kind: 'host', host, name };
  }
  if (!domainInScope(world, name)) return { kind: 'out-of-scope', name };
  const ip = resolveName(world, name);
  const host = ip ? world.hosts.find((h) => h.ip === ip) : undefined;
  return host ? { kind: 'host', host, name } : { kind: 'unknown', name };
}

export function isInScope(world: World, name: string): boolean {
  return resolveTarget(world, name).kind !== 'out-of-scope';
}
