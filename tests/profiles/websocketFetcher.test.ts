import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { websocketFetcher, DEFAULT_PROFILE_RELAYS } from '../../src/profiles/websocketFetcher';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

// Minimal fake WebSocket: records instances, lets tests drive lifecycle events.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  // test drivers
  open() {
    this.onopen && this.onopen();
  }
  emit(arr: unknown) {
    this.onmessage && this.onmessage({ data: JSON.stringify(arr) });
  }
  error() {
    this.onerror && this.onerror();
  }
}

function profileEvent(pubkey: string, name: string, created_at: number) {
  return { kind: 0, pubkey, created_at, content: JSON.stringify({ name }) };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('websocketFetcher', () => {
  test('sends a kind-0 REQ and returns the parsed name', async () => {
    const promise = websocketFetcher([PK_A], ['wss://relay.test'], 4000);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(JSON.parse(ws.sent[0])).toEqual(['REQ', expect.any(String), { kinds: [0], authors: [PK_A] }]);
    const subId = JSON.parse(ws.sent[0])[1];
    ws.emit(['EVENT', subId, profileEvent(PK_A, 'Alice', 100)]);
    ws.emit(['EOSE', subId]);
    const result = await promise;
    expect(result.get(PK_A)).toEqual({ name: 'Alice' });
  });

  test('newest created_at wins for the same pubkey', async () => {
    const promise = websocketFetcher([PK_A], ['wss://relay.test'], 4000);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const subId = JSON.parse(ws.sent[0])[1];
    ws.emit(['EVENT', subId, profileEvent(PK_A, 'Old', 100)]);
    ws.emit(['EVENT', subId, profileEvent(PK_A, 'New', 200)]);
    ws.emit(['EOSE', subId]);
    const result = await promise;
    expect(result.get(PK_A)).toEqual({ name: 'New' });
  });

  test('EOSE with no events resolves an empty map', async () => {
    const promise = websocketFetcher([PK_A], ['wss://relay.test'], 4000);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const subId = JSON.parse(ws.sent[0])[1];
    ws.emit(['EOSE', subId]);
    const result = await promise;
    expect(result.size).toBe(0);
  });

  test('times out to an empty map and closes the socket', async () => {
    vi.useFakeTimers();
    const promise = websocketFetcher([PK_A], ['wss://relay.test'], 1000);
    const ws = FakeWebSocket.instances[0];
    ws.open(); // no events, no EOSE
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.size).toBe(0);
    expect(ws.closed).toBe(true);
  });

  test('malformed content omits that pubkey without throwing', async () => {
    const promise = websocketFetcher([PK_A, PK_B], ['wss://relay.test'], 4000);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const subId = JSON.parse(ws.sent[0])[1];
    ws.emit(['EVENT', subId, { kind: 0, pubkey: PK_A, created_at: 100, content: '{not json' }]);
    ws.emit(['EVENT', subId, profileEvent(PK_B, 'Bob', 100)]);
    ws.emit(['EOSE', subId]);
    const result = await promise;
    expect(result.has(PK_A)).toBe(false);
    expect(result.get(PK_B)).toEqual({ name: 'Bob' });
  });

  test('exposes the agreed default relays', () => {
    expect(DEFAULT_PROFILE_RELAYS).toEqual([
      'wss://purplepag.es',
      'wss://relay.edufeed.org',
      'wss://relay.damus.io',
    ]);
  });

  test('empty pubkey list resolves immediately without opening a socket', async () => {
    const result = await websocketFetcher([], ['wss://relay.test'], 4000);
    expect(result.size).toBe(0);
    expect(FakeWebSocket.instances.length).toBe(0);
  });
});
