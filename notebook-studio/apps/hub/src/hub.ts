import { createSocket } from 'node:dgram';
import { WebSocket } from 'ws';
import { type CtlFrame } from '@ns/protocol';

/**
 * Zobúdzač v domácej sieti. Beží na malom vždy zapnutom zariadení (Raspberry Pi,
 * NAS, starý PC). Pripojí sa na relay a keď mobil požiada o zapnutie, pošle
 * notebooku magický paket Wake-on-LAN do lokálnej siete.
 *
 * Konfigurácia cez premenné prostredia:
 *   NS_RELAY   napr. wss://relay.priklad.sk
 *   NS_DEVICE  deviceId (z párovania notebooku)
 *   NS_HUB_TOKEN  token hubu (z /v1/hub/register)
 *   NS_MAC     MAC adresa notebooku, napr. 8c-16-45-aa-bb-cc
 *   NS_BROADCAST  broadcast adresa siete (predvolene 255.255.255.255)
 */

function need(k: string): string { const v = process.env[k]; if (!v) { console.error(`Chýba premenná ${k}`); process.exit(1); } return v; }

export function magicPacket(mac: string): Buffer {
  const bytes = mac.split(/[:-]/).map(h => parseInt(h, 16));
  if (bytes.length !== 6 || bytes.some(b => Number.isNaN(b))) throw new Error(`Neplatná MAC adresa: ${mac}`);
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let i = 1; i <= 16; i++) Buffer.from(bytes).copy(packet, i * 6);
  return packet;
}

export function sendWol(mac: string, broadcast: string, ports = [9, 7]): Promise<void> {
  return new Promise((resolve, reject) => {
    const packet = magicPacket(mac);
    const sock = createSocket('udp4');
    sock.once('error', reject);
    sock.bind(() => {
      sock.setBroadcast(true);
      let left = ports.length;
      for (const port of ports) {
        sock.send(packet, port, broadcast, (err) => {
          if (err) { sock.close(); return reject(err); }
          if (--left === 0) { sock.close(); resolve(); }
        });
      }
    });
  });
}

function connect() {
  const RELAY = need('NS_RELAY');
  const DEVICE = need('NS_DEVICE');
  const TOKEN = need('NS_HUB_TOKEN');
  const MAC = need('NS_MAC');
  const BROADCAST = process.env.NS_BROADCAST ?? '255.255.255.255';
  const ws = new WebSocket(`${RELAY}/v1/ws?role=hub&device=${encodeURIComponent(DEVICE)}`, [`bearer.${TOKEN}`]);
  ws.on('open', () => console.log('[hub] pripojený na relay'));
  ws.on('message', async (raw) => {
    let frame: CtlFrame;
    try { const p = JSON.parse(String(raw)); if (p.t !== 'ctl') return; frame = p; } catch { return; }
    if (frame.op === 'wake') {
      try {
        await sendWol(MAC, BROADCAST);
        console.log('[hub] odoslaný Wake-on-LAN paket pre', MAC);
        ws.send(JSON.stringify({ v: 1, t: 'ctl', op: 'wake.result', body: { ok: true } } satisfies CtlFrame));
      } catch (e) {
        ws.send(JSON.stringify({ v: 1, t: 'ctl', op: 'wake.result', body: { ok: false, error: (e as Error).message } } satisfies CtlFrame));
      }
    }
  });
  ws.on('close', () => { console.log('[hub] spojenie zatvorené, skúšam o 5 s'); setTimeout(connect, 5000); });
  ws.on('error', (e) => console.error('[hub] chyba:', (e as Error).message));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  connect();
}
