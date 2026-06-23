import type { ProfileFetcher, ProfileInfo } from './types.js';

export const DEFAULT_PROFILE_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.edufeed.org',
  'wss://relay.damus.io',
];

// Minimal structural type so we never reference a global `WebSocket` type
// (the node TS lib does not declare one). The instance is obtained at runtime
// from globalThis, which works in the browser and in Node 20+.
interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}
type WebSocketCtor = new (url: string) => MinimalWebSocket;

function getWebSocketCtor(): WebSocketCtor | null {
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  return typeof ctor === 'function' ? (ctor as WebSocketCtor) : null;
}

function parseName(content: unknown): ProfileInfo | null {
  if (typeof content !== 'string') return null;
  try {
    const meta = JSON.parse(content) as { name?: unknown; display_name?: unknown };
    const name = typeof meta.name === 'string' && meta.name ? meta.name
      : typeof meta.display_name === 'string' && meta.display_name ? meta.display_name
      : null;
    return name ? { name } : null;
  } catch {
    return null;
  }
}

export const websocketFetcher: ProfileFetcher = (pubkeys, relays, timeoutMs) =>
  new Promise<Map<string, ProfileInfo>>((resolve) => {
    const Ctor = getWebSocketCtor();
    if (pubkeys.length === 0 || relays.length === 0 || !Ctor) {
      resolve(new Map());
      return;
    }

    const subId = 'p' + Math.random().toString(36).slice(2, 10);
    const filter = { kinds: [0], authors: pubkeys };
    const best = new Map<string, { created_at: number; info: ProfileInfo }>();
    const sockets: MinimalWebSocket[] = [];
    let settled = false;
    let doneSockets = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try { ws.close(); } catch { /* noop */ }
      }
      const out = new Map<string, ProfileInfo>();
      for (const [pubkey, entry] of best) out.set(pubkey, entry.info);
      resolve(out);
    };

    const markDone = () => {
      doneSockets += 1;
      if (doneSockets >= relays.length) finish();
    };

    const timer = setTimeout(finish, timeoutMs);

    const handleEvent = (ev: { kind?: number; pubkey?: unknown; created_at?: number; content?: unknown }) => {
      if (!ev || ev.kind !== 0 || typeof ev.pubkey !== 'string' || typeof ev.created_at !== 'number') return;
      const prev = best.get(ev.pubkey);
      if (prev && prev.created_at >= ev.created_at) return;
      const info = parseName(ev.content);
      if (info) best.set(ev.pubkey, { created_at: ev.created_at, info });
    };

    for (const url of relays) {
      let ws: MinimalWebSocket;
      try {
        ws = new Ctor(url);
      } catch {
        markDone();
        continue;
      }
      sockets.push(ws);
      let counted = false;
      const once = () => {
        if (!counted) { counted = true; markDone(); }
      };
      ws.onopen = () => {
        try { ws.send(JSON.stringify(['REQ', subId, filter])); } catch { once(); }
      };
      ws.onmessage = (e) => {
        let msg: unknown;
        try { msg = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === subId) handleEvent(msg[2]);
        else if (msg[0] === 'EOSE' && msg[1] === subId) once();
      };
      ws.onerror = () => once();
      ws.onclose = () => once();
    }
  });
