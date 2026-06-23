# Profile Name Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in async `nostrToAmbWithProfiles` that fetches kind-0 profiles and fills in the `name` of `creator`/`contributor` entries carrying a `nostr:` identity, without touching the pure synchronous `nostrToAmb`.

**Architecture:** A new `src/profiles/` module with three units — a `ProfileFetcher` type, a dependency-free default WebSocket fetcher, and an orchestrator that runs `nostrToAmb` then enriches its result. The fetcher is injected into the orchestrator so the orchestrator is unit-tested with a mock and zero network. Exports are wired through both `src/index.ts` (npm) and `src/browser.ts` (browser bundle).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (globals enabled, `node` environment), `nostr-tools` 1.17 (`nip19`), global `WebSocket` (Node 20+ / browser).

## Global Constraints

- ESM only: every relative import uses a `.js` extension (e.g. `./types.js`), even from `.ts` source — matches the existing codebase.
- Do NOT modify `nostrToAmb` in `src/converters/nostrToAmb.ts`; it must stay synchronous and pure.
- No new runtime dependencies. The default fetcher uses the global `WebSocket` accessed via `globalThis`, never a static `WebSocket` type reference (the `node` TS lib does not declare it).
- Enrichment writes `name` only. Never overwrite an entry that already has a `name`.
- All failures are graceful: the returned `ConversionResult` stays `success: true`; problems are pushed onto `result.warnings`.
- Default relays, verbatim: `['wss://purplepag.es', 'wss://relay.edufeed.org', 'wss://relay.damus.io']`.
- Default `timeoutMs`: `4000`.
- Tests are offline and deterministic — no real relay connections in committed tests.
- Run all commands from the repo root: `/home/laoc/coding/edufeed/amb-nostr-converter`.

---

### Task 1: ProfileFetcher type + default WebSocket fetcher

**Files:**
- Create: `src/profiles/types.ts`
- Create: `src/profiles/websocketFetcher.ts`
- Test: `tests/profiles/websocketFetcher.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `ProfileInfo` = `{ name?: string }`
  - `ProfileFetcher` = `(pubkeys: string[], relays: string[], timeoutMs: number) => Promise<Map<string, ProfileInfo>>`
  - `websocketFetcher: ProfileFetcher` (default implementation)
  - `DEFAULT_PROFILE_RELAYS: string[]`

- [ ] **Step 1: Write the type module**

Create `src/profiles/types.ts`:

```ts
/**
 * Profile metadata resolved from a Nostr kind-0 event. Only `name` is used today.
 */
export interface ProfileInfo {
  name?: string;
}

/**
 * Fetches kind-0 profile metadata for a set of pubkeys. Implementations resolve
 * with a Map keyed by hex pubkey; pubkeys with no usable profile are simply absent.
 * Must never reject for "not found" — only for hard transport errors.
 */
export type ProfileFetcher = (
  pubkeys: string[],
  relays: string[],
  timeoutMs: number
) => Promise<Map<string, ProfileInfo>>;
```

- [ ] **Step 2: Write the failing fetcher test**

Create `tests/profiles/websocketFetcher.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/profiles/websocketFetcher.test.ts`
Expected: FAIL — cannot resolve `../../src/profiles/websocketFetcher` (module not yet created).

- [ ] **Step 4: Implement the fetcher**

Create `src/profiles/websocketFetcher.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/profiles/websocketFetcher.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/profiles/types.ts src/profiles/websocketFetcher.ts tests/profiles/websocketFetcher.test.ts
git commit -m "feat: default websocket kind-0 profile fetcher"
```

---

### Task 2: `nostrToAmbWithProfiles` orchestrator

**Files:**
- Create: `src/profiles/resolveNames.ts`
- Test: `tests/profiles/resolveNames.test.ts`

**Interfaces:**
- Consumes:
  - `ProfileFetcher` from `src/profiles/types.ts`
  - `websocketFetcher`, `DEFAULT_PROFILE_RELAYS` from `src/profiles/websocketFetcher.ts`
  - `nostrToAmb` from `src/converters/nostrToAmb.ts`
  - `NostrEvent`, `AmbLearningResource`, `ConversionResult` from `src/types/index.ts`
- Produces:
  - `nostrToAmbWithProfiles(event: NostrEvent, options?: ProfileResolutionOptions): Promise<ConversionResult<AmbLearningResource>>`
  - `ProfileResolutionOptions` = `{ defaultLanguage?: string; relays?: string[]; fetchProfile?: ProfileFetcher; timeoutMs?: number }`

- [ ] **Step 1: Write the failing orchestrator test**

Create `tests/profiles/resolveNames.test.ts`:

```ts
import { vi, describe, test, expect } from 'vitest';
import { nostrToAmbWithProfiles } from '../../src/profiles/resolveNames';
import { DEFAULT_PROFILE_RELAYS } from '../../src/profiles/websocketFetcher';
import type { ProfileInfo } from '../../src/profiles/types';
import { NostrEvent } from '../../src/types';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

// Event whose creator is a p-tag person (id = nostr:nprofile…, no name).
function eventWithCreator(pubkey: string, role = 'creator'): NostrEvent {
  return {
    kind: 30142,
    pubkey: '0'.repeat(64),
    created_at: 1,
    content: '',
    tags: [
      ['d', 'https://example.org/x'],
      ['name', 'A resource'],
      ['type', 'LearningResource'],
      ['p', pubkey, 'wss://relay.test', role],
    ],
  } as NostrEvent;
}

function mockFetcher(map: Record<string, ProfileInfo>) {
  return vi.fn(async () => new Map(Object.entries(map)));
}

describe('nostrToAmbWithProfiles', () => {
  test('fills name on a p-tag creator from the fetched profile', async () => {
    const fetchProfile = mockFetcher({ [PK_A]: { name: 'Alice' } });
    const result = await nostrToAmbWithProfiles(eventWithCreator(PK_A), { fetchProfile });
    expect(result.success).toBe(true);
    expect(result.data!.creator![0].name).toBe('Alice');
  });

  test('fills name on a contributor too', async () => {
    const fetchProfile = mockFetcher({ [PK_A]: { name: 'Alice' } });
    const result = await nostrToAmbWithProfiles(eventWithCreator(PK_A, 'contributor'), { fetchProfile });
    expect((result.data as any).contributor[0].name).toBe('Alice');
  });

  test('calls the fetcher once with the deduped pubkey set and default options', async () => {
    const event = eventWithCreator(PK_A);
    // add a second, different p-tag contributor and a duplicate of PK_A
    event.tags.push(['p', PK_B, 'wss://relay.test', 'contributor']);
    event.tags.push(['p', PK_A, 'wss://relay.test', 'contributor']);
    const fetchProfile = mockFetcher({ [PK_A]: { name: 'Alice' }, [PK_B]: { name: 'Bob' } });
    await nostrToAmbWithProfiles(event, { fetchProfile });
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    const [pubkeys, relays, timeoutMs] = fetchProfile.mock.calls[0];
    expect([...pubkeys].sort()).toEqual([PK_A, PK_B].sort());
    expect(relays).toEqual(DEFAULT_PROFILE_RELAYS);
    expect(timeoutMs).toBe(4000);
  });

  test('no nostr-id persons → fetcher never called, equals plain conversion', async () => {
    const event: NostrEvent = {
      kind: 30142, pubkey: '0'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'x'], ['name', 'N'], ['type', 'LearningResource'], ['creator:name', 'Plain'], ['creator:type', 'Person']],
    } as NostrEvent;
    const fetchProfile = vi.fn();
    const result = await nostrToAmbWithProfiles(event, { fetchProfile });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect((result.data as any).creator[0].name).toBe('Plain');
  });

  test('unsuccessful base conversion is returned unchanged, fetcher never called', async () => {
    const bad: NostrEvent = { kind: 1, pubkey: '0'.repeat(64), created_at: 1, content: '', tags: [] } as NostrEvent;
    const fetchProfile = vi.fn();
    const result = await nostrToAmbWithProfiles(bad, { fetchProfile });
    expect(result.success).toBe(false);
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  test('fetcher rejection → still success, person unnamed, warning present', async () => {
    const fetchProfile = vi.fn(async () => { throw new Error('boom'); });
    const result = await nostrToAmbWithProfiles(eventWithCreator(PK_A), { fetchProfile });
    expect(result.success).toBe(true);
    expect(result.data!.creator![0].name).toBeUndefined();
    expect(result.warnings).toContain('profile fetch failed: boom');
  });

  test('pubkey absent from map → unnamed with a per-pubkey warning', async () => {
    const fetchProfile = mockFetcher({}); // empty
    const result = await nostrToAmbWithProfiles(eventWithCreator(PK_A), { fetchProfile });
    expect(result.success).toBe(true);
    expect(result.data!.creator![0].name).toBeUndefined();
    expect(result.warnings!.some((w) => w.startsWith('no profile name for'))).toBe(true);
  });

  test('does not overwrite a person that already has a name', async () => {
    const fetchProfile = mockFetcher({ [PK_A]: { name: 'Fetched' } });
    // core-tag creator (has name) + p-tag creator (nostr id, no name) → double entry
    const event = eventWithCreator(PK_A);
    event.tags.push(['creator:name', 'Original'], ['creator:type', 'Person']);
    const result = await nostrToAmbWithProfiles(event, { fetchProfile });
    const creators = (result.data as any).creator as Array<{ name?: string; id?: string }>;
    const named = creators.find((c) => c.name === 'Original');
    const enriched = creators.find((c) => typeof c.id === 'string' && c.id.startsWith('nostr:'));
    expect(named).toBeDefined();                 // original untouched
    expect(enriched!.name).toBe('Fetched');      // p-tag entry gained the fetched name
    expect(creators.length).toBe(2);             // no dedup
  });

  test('forwards custom relays and timeoutMs to the fetcher', async () => {
    const fetchProfile = mockFetcher({ [PK_A]: { name: 'Alice' } });
    await nostrToAmbWithProfiles(eventWithCreator(PK_A), {
      fetchProfile, relays: ['wss://custom.relay'], timeoutMs: 1234,
    });
    const [, relays, timeoutMs] = fetchProfile.mock.calls[0];
    expect(relays).toEqual(['wss://custom.relay']);
    expect(timeoutMs).toBe(1234);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/profiles/resolveNames.test.ts`
Expected: FAIL — cannot resolve `../../src/profiles/resolveNames`.

- [ ] **Step 3: Implement the orchestrator**

Create `src/profiles/resolveNames.ts`:

```ts
import { nip19 } from 'nostr-tools';
import { nostrToAmb } from '../converters/nostrToAmb.js';
import { websocketFetcher, DEFAULT_PROFILE_RELAYS } from './websocketFetcher.js';
import type { ProfileFetcher, ProfileInfo } from './types.js';
import {
  NostrEvent,
  AmbLearningResource,
  ConversionResult,
} from '../types/index.js';

export interface ProfileResolutionOptions {
  defaultLanguage?: string;
  relays?: string[];
  fetchProfile?: ProfileFetcher;
  timeoutMs?: number;
}

const PERSON_FIELDS = ['creator', 'contributor'] as const;

/** Decode a `nostr:nprofile…`/`nostr:npub…` id to a hex pubkey, else null. */
function decodePubkey(id: unknown): string | null {
  if (typeof id !== 'string' || !id.startsWith('nostr:')) return null;
  const bech = id.slice('nostr:'.length);
  try {
    const decoded = nip19.decode(bech);
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey;
  } catch {
    return null;
  }
  return null;
}

function shortNpub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey).slice(0, 12) + '…';
  } catch {
    return pubkey.slice(0, 8) + '…';
  }
}

/**
 * Like `nostrToAmb`, but additionally fetches kind-0 profiles and fills the
 * `name` of creator/contributor entries whose id is a `nostr:` URI. Always
 * resolves; failures degrade gracefully into `result.warnings`.
 */
export async function nostrToAmbWithProfiles(
  event: NostrEvent,
  options: ProfileResolutionOptions = {}
): Promise<ConversionResult<AmbLearningResource>> {
  const base = nostrToAmb(event, { defaultLanguage: options.defaultLanguage });
  if (!base.success || !base.data) return base;

  const amb = base.data as AmbLearningResource & Record<string, unknown>;

  // Collect person entries that have a nostr id but no name yet.
  const targets: Array<{ entry: { name?: string }; pubkey: string }> = [];
  for (const field of PERSON_FIELDS) {
    const list = (amb as Record<string, unknown>)[field];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || (entry as { name?: string }).name) continue;
      const pubkey = decodePubkey((entry as { id?: unknown }).id);
      if (pubkey) targets.push({ entry: entry as { name?: string }, pubkey });
    }
  }

  if (targets.length === 0) return base;

  const uniquePubkeys = [...new Set(targets.map((t) => t.pubkey))];
  const relays = options.relays ?? DEFAULT_PROFILE_RELAYS;
  const fetchProfile = options.fetchProfile ?? websocketFetcher;
  const timeoutMs = options.timeoutMs ?? 4000;
  const warnings = base.warnings ? [...base.warnings] : [];

  let names: Map<string, ProfileInfo>;
  try {
    names = await fetchProfile(uniquePubkeys, relays, timeoutMs);
  } catch (err) {
    warnings.push(`profile fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ...base, warnings };
  }

  for (const { entry, pubkey } of targets) {
    const name = names.get(pubkey)?.name;
    if (name) entry.name = name;
    else warnings.push(`no profile name for ${shortNpub(pubkey)}`);
  }

  const result: ConversionResult<AmbLearningResource> = { ...base, data: amb };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/profiles/resolveNames.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/profiles/resolveNames.ts tests/profiles/resolveNames.test.ts
git commit -m "feat: nostrToAmbWithProfiles orchestrator with name enrichment"
```

---

### Task 3: Export wiring + browser bundle + build smoke test

**Files:**
- Create: `src/profiles/index.ts`
- Modify: `src/index.ts`
- Modify: `src/browser.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1 and 2.
- Produces: `nostrToAmbWithProfiles`, `websocketFetcher`, `DEFAULT_PROFILE_RELAYS`, and the `ProfileFetcher`/`ProfileInfo`/`ProfileResolutionOptions` types reachable from the package root (`amb-nostr-converter`) and the browser bundle.

- [ ] **Step 1: Create the profiles barrel**

Create `src/profiles/index.ts`:

```ts
export { nostrToAmbWithProfiles } from './resolveNames.js';
export type { ProfileResolutionOptions } from './resolveNames.js';
export { websocketFetcher, DEFAULT_PROFILE_RELAYS } from './websocketFetcher.js';
export type { ProfileFetcher, ProfileInfo } from './types.js';
```

- [ ] **Step 2: Wire into the package entry**

In `src/index.ts`, add after the existing `export * from './validators/index.js';` line:

```ts
export * from './profiles/index.js';
```

- [ ] **Step 3: Wire into the browser entry**

In `src/browser.ts`, add a third export so the bundle exposes the new function:

```ts
export { nostrToAmbWithProfiles } from './profiles/resolveNames.js';
```

The full `src/browser.ts` is now:

```ts
export { ambToNostr } from './converters/ambToNostr.js';
export { nostrToAmb } from './converters/nostrToAmb.js';
export { nostrToAmbWithProfiles } from './profiles/resolveNames.js';
```

- [ ] **Step 4: Run the whole unit suite**

Run: `npm test`
Expected: PASS — all pre-existing tests plus the 16 new ones (7 fetcher + 9 orchestrator). Zero failures.

- [ ] **Step 5: Build and type-check the package**

Run: `npm run build`
Expected: build completes with no `tsc` errors (confirms the `globalThis.WebSocket` access and all `.js` import specifiers type-check under the `node` lib).

- [ ] **Step 6: Smoke-test the built package in Node with an injected fetcher**

Run:
```bash
node --input-type=module -e "import('./dist/index.js').then(async m => { const r = await m.nostrToAmbWithProfiles({kind:30142,pubkey:'0'.repeat(64),created_at:1,content:'',tags:[['d','x'],['name','N'],['type','LearningResource'],['p','a'.repeat(64),'wss://r','creator']]}, { fetchProfile: async () => new Map([['a'.repeat(64), { name: 'Alice' }]]) }); console.log(r.data.creator[0].name); })"
```
Expected: prints `Alice`.

- [ ] **Step 7: Build the browser bundle and confirm the symbol is present**

Run:
```bash
npm run build:browser
grep -c "nostrToAmbWithProfiles" dist/browser/amb-nostr-converter.esm.js
```
Expected: build succeeds; grep prints a count ≥ 1.

- [ ] **Step 8: Commit**

```bash
git add src/profiles/index.ts src/index.ts src/browser.ts
git commit -m "feat: export nostrToAmbWithProfiles from package and browser entries"
```

---

## Manual Verification (post-merge, not a committed test)

Per the project's "verify against a live relay" preference, after the branch is merged run a one-off Node check against a real relay to confirm the default fetcher resolves a genuine name. Pick a known edufeed author pubkey, then:

```bash
node --input-type=module -e "
import { nip19 } from 'nostr-tools';
import { nostrToAmbWithProfiles } from './dist/index.js';
const pubkey = '<KNOWN_AUTHOR_HEX_PUBKEY>';
const ev = { kind:30142, pubkey:'0'.repeat(64), created_at:1, content:'',
  tags:[['d','x'],['name','N'],['type','LearningResource'],['p', pubkey, 'wss://relay.edufeed.org', 'creator']] };
const r = await nostrToAmbWithProfiles(ev);
console.log('name:', r.data.creator[0].name, '| warnings:', r.warnings);
"
```
Expected: a real display name printed (or, if the relay/profile is unavailable, `undefined` plus a graceful warning — never a thrown error).
