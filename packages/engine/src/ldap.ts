import type { Directory } from '@breach/pack-schema';

/**
 * A small LDAP search filter (RFC 4515) evaluated over a directory declared as data. Nothing here
 * talks to a server: `ldapsearch` reads the pack.
 */

export type Filter =
  | { op: 'and' | 'or'; items: Filter[] }
  | { op: 'not'; item: Filter }
  | { op: 'present'; attr: string }
  | { op: 'eq'; attr: string; value: string }
  | { op: 'sub'; attr: string; parts: string[] };

export class FilterError extends Error {}

/** Parse a filter such as `(&(objectClass=user)(memberOf=cn=admins,*))`. Bare `a=b` is accepted too. */
export function parseFilter(raw: string): Filter {
  const text = raw.trim();
  const src = text.startsWith('(') ? text : `(${text})`;
  let i = 0;
  const parse = (depth: number): Filter => {
    if (depth > 12) throw new FilterError('filter too deep');
    if (src[i] !== '(') throw new FilterError(`expected ( at ${i}`);
    i++;
    const c = src[i];
    let f: Filter;
    if (c === '&' || c === '|') {
      i++;
      const items: Filter[] = [];
      while (src[i] === '(') items.push(parse(depth + 1));
      if (!items.length) throw new FilterError('empty list');
      f = { op: c === '&' ? 'and' : 'or', items };
    } else if (c === '!') {
      i++;
      f = { op: 'not', item: parse(depth + 1) };
    } else {
      const end = src.indexOf(')', i);
      if (end < 0) throw new FilterError('missing )');
      const item = src.slice(i, end);
      const eq = item.indexOf('=');
      if (eq < 1) throw new FilterError(`bad item ${item}`);
      const attr = item.slice(0, eq).replace(/[~<>:]$/, '');
      if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(attr)) throw new FilterError(`bad attribute ${attr}`);
      const value = item.slice(eq + 1);
      if (value === '*') f = { op: 'present', attr };
      else if (value.includes('*')) f = { op: 'sub', attr, parts: value.split('*') };
      else f = { op: 'eq', attr, value };
      i = end;
    }
    if (src[i] !== ')') throw new FilterError(`expected ) at ${i}`);
    i++;
    return f;
  };
  const f = parse(0);
  if (i !== src.length) throw new FilterError('trailing characters');
  return f;
}

type Entry = Directory['entries'][number];

/** Values of an attribute, the DN's own first component included, case-insensitive on the name. */
function valuesOf(entry: Entry, attr: string): string[] {
  const out: string[] = [];
  const name = attr.toLowerCase();
  for (const [k, v] of Object.entries(entry.attrs))
    if (k.toLowerCase() === name) out.push(...(Array.isArray(v) ? v : [v]));
  if (name === 'dn' || name === 'distinguishedname') out.push(entry.dn);
  return out;
}

const fold = (s: string) => s.toLowerCase();

function subMatch(value: string, parts: string[]): boolean {
  const v = fold(value);
  let pos = 0;
  for (let k = 0; k < parts.length; k++) {
    const p = fold(parts[k]!);
    if (!p) continue;
    if (k === 0) {
      if (!v.startsWith(p)) return false;
      pos = p.length;
    } else if (k === parts.length - 1) {
      if (!v.endsWith(p) || v.length - p.length < pos) return false;
    } else {
      const at = v.indexOf(p, pos);
      if (at < 0) return false;
      pos = at + p.length;
    }
  }
  return true;
}

export function filterMatches(entry: Entry, f: Filter): boolean {
  switch (f.op) {
    case 'and':
      return f.items.every((x) => filterMatches(entry, x));
    case 'or':
      return f.items.some((x) => filterMatches(entry, x));
    case 'not':
      return !filterMatches(entry, f.item);
    case 'present':
      return f.attr.toLowerCase() === 'objectclass' || valuesOf(entry, f.attr).length > 0;
    case 'eq':
      return valuesOf(entry, f.attr).some((v) => fold(v) === fold(f.value));
    case 'sub':
      return valuesOf(entry, f.attr).some((v) => subMatch(v, f.parts));
  }
}

/** True when `dn` lies under `base` (or is it). */
export function underBase(dn: string, base: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s*,\s*/g, ',')
      .trim();
  const d = norm(dn);
  const b = norm(base);
  return d === b || d.endsWith(`,${b}`);
}

/** The entry as LDIF, with only the attributes asked for (all when none). */
export function ldif(entry: Entry, attrs: string[]): string {
  const want = attrs.map((a) => a.toLowerCase()).filter((a) => a !== '*');
  const lines = [`dn: ${entry.dn}`];
  for (const [k, v] of Object.entries(entry.attrs)) {
    if (want.length && !want.includes(k.toLowerCase())) continue;
    for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
  }
  return lines.join('\n');
}
