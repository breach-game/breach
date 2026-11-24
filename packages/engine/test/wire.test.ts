import { parsePack } from '@breach/pack-schema';
import { describe, expect, it } from 'vitest';
import { readQr } from '../src/artifact.ts';
import { describe as fileKind } from '../src/commands/inspect.ts';
import { qrMeaning } from '../src/commands/personal.ts';
import { displayFilter, framesOf } from '../src/commands/wire.ts';
import { Game } from '../src/index.ts';
import { qrBlocks, qrMatrix } from '../src/qr.ts';
import { formatLine } from '../src/telemetry.ts';
import { run } from './fixture.ts';

const packets = [
  {
    proto: 'dns',
    t: 0.1,
    src: '10.40.0.23',
    dst: '10.40.0.1',
    query: 'mail.example',
    answer: '203.0.113.10',
  },
  {
    proto: 'tls',
    t: 0.2,
    src: '10.40.0.23',
    dst: '203.0.113.10',
    sni: 'mail.example',
    bytes: 9000,
    records: 3,
  },
  { proto: 'tls', t: 0.5, src: '10.40.0.23', dst: '203.0.113.20', sni: 'cdn.example', ech: true, records: 1 },
  {
    proto: 'http',
    t: 0.9,
    src: '10.40.0.31',
    dst: '198.51.100.7',
    method: 'POST',
    host: 'fidelite.cafe.test',
    path: '/login',
    body: 'card=4471-0021&pin=8812',
  },
  { proto: 'arp', t: 1.2, src: '10.40.0.31', dst: '10.40.0.1', info: 'Who has 10.40.0.1? Tell 10.40.0.31' },
];

function cafe() {
  const world = parsePack({
    format: 0,
    id: 'test.cafe',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'world',
    title: { en: 'Cafe' },
    authors: ['test'],
    locales: ['en'],
    world: {
      startTime: '2027-06-12T09:00:00+02:00',
      mandate: 'T-9',
      scope: { domains: ['*.cafe.test'], networks: ['10.40.0.0/24'] },
      player: { host: 'me', user: 'kestrel' },
      hosts: [
        {
          id: 'me',
          hostname: 'laptop.cafe.test',
          ip: '10.40.0.66',
          kind: 'player',
          map: { x: 0, z: 0 },
          users: [{ name: 'kestrel', home: '/home/kestrel' }],
          fs: {
            home: {
              kestrel: {
                'salle.pcap': { $capture: { iface: 'wlan0', packets } },
                'parcmetre.png': { $qr: { text: 'https://payer-stationnement.example/p/4471' } },
                'table.png': { $qr: { text: 'WIFI:S:Cafe-Invites;T:WPA;P:creme-2029;;', style: 'fancy' } },
                'notes.txt': 'nothing here',
              },
            },
            etc: {
              NetworkManager: {
                'system-connections': {
                  'Cafe-Invites.nmconnection':
                    '[connection]\nid=Cafe-Invites\ntype=wifi\nautoconnect=true\n\n[wifi]\nssid=Cafe-Invites\n',
                  'Gare-Gratuit.nmconnection':
                    '[connection]\nid=Gare-Gratuit\ntype=wifi\n\n[wifi]\nssid=Gare-Gratuit\n\n[wifi-security]\nkey-mgmt=none\n',
                },
              },
            },
          },
        },
      ],
      dns: {},
      wifi: [
        {
          ssid: 'Cafe-Invites',
          bssid: '02:11:22:33:44:55',
          channel: 6,
          signal: 80,
          security: 'WPA2',
          inUse: true,
        },
      ],
    },
    i18n: { en: {} },
  });
  const mission = parsePack({
    format: 0,
    id: 'test.cafe.m1',
    version: '1.0.0',
    engine: '>=0.1',
    kind: 'mission',
    requires: ['test.cafe'],
    title: { en: 'Cafe mission' },
    authors: ['test'],
    locales: ['en'],
    mission: {
      order: 1,
      stage: 'recon',
      briefing: 'brief',
      objectives: [
        { id: 'read', text: 'o.read' },
        { id: 'qr', text: 'o.qr' },
        { id: 'forget', text: 'o.forget' },
      ],
      flags: [],
      checks: [
        {
          id: 'gare',
          text: 'c.gare',
          objective: 'forget',
          if: { not: { file: '/etc/NetworkManager/system-connections/Gare-Gratuit.nmconnection' } },
        },
      ],
      rules: [
        { on: { event: 'CaptureRead', filter: 'http' }, do: [{ 'objective.complete': 'read' }] },
        { on: { event: 'QrDecoded', text: { contains: 'payer-' } }, do: [{ 'objective.complete': 'qr' }] },
      ],
      debrief: {
        title: 'd.t',
        lesson: 'd.l',
        points: ['d.p'],
        home: { points: ['d.h1'], kind: 'travel' },
      },
    },
    i18n: { en: { brief: 'Brief' } },
  });
  const game = new Game({ world, missions: [mission], locale: 'en' });
  game.startMission(mission.id);
  return game;
}

describe('tshark', () => {
  it('lists a capture: names in clear, encrypted records as their size only', async () => {
    const g = cafe();
    const r = await run(g, 'tshark -r salle.pcap');
    const lines = r.out.split('\n');
    expect(lines[0]).toMatch(
      /^ {4}1 {4}0\.100000 {6}10\.40\.0\.23 → 10\.40\.0\.1 {7}DNS \d+ Standard query 0x[0-9a-f]{4} A mail\.example$/,
    );
    expect(r.out).toContain('Standard query response');
    expect(r.out).toContain('Client Hello (SNI=mail.example)');
    expect(r.out).toContain('Application Data');
    expect(r.out).toContain('POST /login HTTP/1.1');
    expect(r.out).toContain('Who has 10.40.0.1? Tell 10.40.0.31');
    // Nothing encrypted is ever spelled out.
    expect(r.out).not.toContain('card=');
  });

  it('filters, and unfolds what an onlooker can read', async () => {
    const g = cafe();
    const http = await run(g, 'tshark -r salle.pcap -Y http -V');
    expect(http.out).toContain('Form item: "card" = "4471-0021"');
    expect(http.out).toContain('Host: fidelite.cafe.test');
    expect(http.out).not.toContain('TLSv1.3');
    expect(g.state.objectives.read).toBeTruthy();
    const tls = await run(
      g,
      'tshark -r salle.pcap -Y "tls.handshake.extensions_server_name contains cdn" -V',
    );
    expect(tls.out).toContain('Server Name: cdn.example');
    expect(tls.out).toContain('Extension: encrypted_client_hello');
    expect(
      (await run(g, 'tshark -r salle.pcap -Y "ip.addr==10.40.0.31 && !arp"')).out.trim().split('\n'),
    ).toHaveLength(2);
    const data = await run(g, 'tshark -r salle.pcap -Y tls -V');
    expect(data.out).toMatch(/Encrypted Application Data: [0-9a-f]{40}…/);
  });

  it('sums the conversations', async () => {
    const g = cafe();
    const r = await run(g, 'tshark -r salle.pcap -q -z conv,ip');
    expect(r.out).toContain('IPv4 Conversations');
    expect(r.out).toMatch(/10\.40\.0\.23\s+<-> 203\.0\.113\.10/);
    expect(r.out).not.toContain('Standard query');
  });

  it('never captures live, and refuses files that are not captures', async () => {
    const g = cafe();
    expect((await run(g, 'tshark -i wlan0')).err).toContain('live capture is not part of this game');
    expect((await run(g, 'tshark')).err).toContain('tshark -r');
    expect((await run(g, 'tshark -r notes.txt')).err).toContain("isn't a capture file");
    expect((await run(g, 'tshark -r salle.pcap -Y "frame[0:4]"')).err).toContain('neither a field');
  });

  it('describes captures and pictures with `file`, and `strings` sees only what is in clear', async () => {
    const g = cafe();
    expect((await run(g, 'file salle.pcap')).out).toContain('pcap capture file');
    expect((await run(g, 'file salle.pcap')).out).toContain('802.11');
    expect((await run(g, 'file parcmetre.png')).out).toContain('PNG image data, 290 x 290');
    expect((await run(g, 'file table.png')).out).toContain('RGBA');
    const s = await run(g, 'strings salle.pcap');
    expect(s.out).toContain('mail.example');
    expect(s.out).toContain('card=4471-0021');
    expect((await run(g, 'strings parcmetre.png')).out).not.toContain('payer-stationnement');
    expect(fileKind('plain')).toBe('ASCII text');
  });

  it('parses display filters the way the missions use them', () => {
    const frames = framesOf(packets as never);
    const count = (f: string) => frames.filter(displayFilter(f)!).length;
    expect(count('dns')).toBe(2);
    expect(count('http.request')).toBe(1);
    expect(count('dns || http')).toBe(4);
    expect(count('tcp and not tls')).toBe(2);
    expect(count('dns.qry.name == "mail.example"')).toBe(2);
    expect(displayFilter('frame[0:4] == 1')).toBeNull();
  });
});

describe('QR codes', () => {
  it('reads what a code holds, and where it leads', async () => {
    const g = cafe();
    const z = await run(g, 'zbarimg parcmetre.png');
    expect(z.out).toBe('QR-Code:https://payer-stationnement.example/p/4471\n');
    expect(z.err).toContain('scanned 1 barcode symbols from 1 images');
    expect(g.state.objectives.qr).toBeTruthy();
    expect((await run(g, 'zbarimg notes.txt')).err).toContain('barcode data was not detected');
    const d = await run(g, 'qr decode table.png');
    expect(d.out).toContain('Type:      Wi-Fi network');
    expect(d.out).toContain('SSID:      Cafe-Invites');
    expect(d.out).toContain('Password:  creme-2029');
    expect((await run(g, 'qr decode parcmetre.png')).out).toContain('Opens:     payer-stationnement.example');
    expect(qrMeaning('WIFI:S:Gare;T:nopass;;')).toContain('Security:  open (no password)');
    expect(qrMeaning('http://menu.cafe.test/')[0]).toContain('plain http');
    expect(qrMeaning('hello')).toEqual(['Type:      text']);
    expect((await run(g, 'qr decode notes.txt')).err).toContain('no QR code found');
  });

  it('draws a real code: right size, finder patterns in the corners, quiet zone around', async () => {
    const m = qrMatrix('https://payer-stationnement.example/p/4471')!;
    expect(m.length).toBe(29); // version 3
    for (const [r, c] of [
      [0, 0],
      [0, 22],
      [22, 0],
    ] as const) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 1]![c + 1]).toBe(false);
      expect(m[r + 3]![c + 3]).toBe(true);
    }
    expect(qrMatrix('x'.repeat(300))).toBeNull();
    expect(qrMatrix('a'.repeat(200))!.length).toBe(57); // version 10
    const lines = qrBlocks(m);
    expect(lines).toHaveLength(17);
    expect(lines[0]).toBe('█'.repeat(33));
    const g = cafe();
    const shown = await run(g, 'qr show parcmetre.png');
    expect(shown.out).toContain('image viewer: parcmetre.png');
    expect(shown.out).toContain('leads nowhere');
    expect(g.log.find((e) => e.type === 'AppOpened')).toMatchObject({ app: 'image' });
    expect((await run(g, 'qr show parcmetre.png | cat')).out).toContain('▀');
    expect(readQr('not a picture')).toBeNull();
  });
});

describe('saved Wi-Fi connections', () => {
  it('lists, stops joining by itself, and forgets', async () => {
    const g = cafe();
    const show = await run(g, 'nmcli -f NAME,TYPE,DEVICE,AUTOCONNECT connection show');
    expect(show.out).toBe(
      [
        'NAME          TYPE  DEVICE  AUTOCONNECT',
        'Cafe-Invites  wifi  wlan0   yes',
        'Gare-Gratuit  wifi  --      yes',
        '',
      ].join('\n'),
    );
    expect((await run(g, 'nmcli con show')).out).toMatch(/^NAME {10}UUID {34}TYPE {2}DEVICE/);
    await run(g, 'nmcli connection modify Cafe-Invites connection.autoconnect no');
    expect((await run(g, 'nmcli -f NAME,AUTOCONNECT c show')).out).toContain('Cafe-Invites  no');
    expect(
      (await run(g, 'cat /etc/NetworkManager/system-connections/Cafe-Invites.nmconnection')).out,
    ).toContain('autoconnect=false');
    await run(g, 'nmcli connection modify Gare-Gratuit autoconnect no');
    expect(
      (await run(g, 'cat /etc/NetworkManager/system-connections/Gare-Gratuit.nmconnection')).out,
    ).toContain('[connection]\nautoconnect=false\nid=Gare-Gratuit');
    const del = await run(g, 'nmcli connection delete Gare-Gratuit');
    expect(del.out).toMatch(/^Connection 'Gare-Gratuit' \([0-9a-f-]{36}\) successfully deleted\.$/m);
    expect((await run(g, 'nmcli connection show')).out).not.toContain('Gare-Gratuit');
    await run(g, 'verify');
    expect(g.state.objectives.forget).toBeTruthy();
    expect((await run(g, 'nmcli connection delete Nowhere')).err).toContain("unknown connection 'Nowhere'");
    expect((await run(g, 'nmcli connection up Cafe-Invites')).err).toContain('usage');
  });
});

describe('wireless controller log and debrief card', () => {
  it('writes beacons and associations, managed or not', () => {
    const t = { clf: '', syslog: 'Jun 12 09:00:00', iso: '2027-06-12T09:00:00+02:00', gitea: '', epoch: 0 };
    expect(
      formatLine(
        'wlan',
        'wlc01.cafe.test',
        t as never,
        { event: 'beacon', ssid: 'Cafe-Invites', bssid: '06:AA:BB:CC:DD:01', managed: 'no', channel: 6 },
        'k',
      ),
    ).toBe(
      '2027-06-12T09:00:00+02:00 wlc01 wlc: event=beacon ssid="Cafe-Invites" bssid=06:AA:BB:CC:DD:01 channel=6 security=open rssi=-60 managed=no',
    );
    expect(
      formatLine(
        'wlan',
        'wlc01',
        t as never,
        { event: 'assoc', ssid: 'X', bssid: 'b', sta: 's', src: '10.40.0.2' },
        'k',
      ),
    ).toContain('event=assoc ssid="X" bssid=b sta=s src=10.40.0.2');
    expect(
      formatLine('mail', 'mx', t as never, { from: 'a@b.example', to: 'c@d.test', attach: 'scan.png' }, 'k'),
    ).toContain('link=- attach=scan.png verdict=delivered');
  });

  it('keeps the kind of the debrief card', () => {
    expect(cafe().mission?.debrief.home?.kind).toBe('travel');
  });
});
