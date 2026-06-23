# Profile Name Resolution for `nostrToAmb` — Design

**Date:** 2026-06-23
**Status:** Approved (pending implementation plan)

## Problem

`nostrToAmb` maps `p` tags to AMB person objects via `applyPersonTags`
(`src/converters/nostrToAmb.ts:502`), producing `{ id: "nostr:<nprofile>", type:
"Person" }` with **no `name`**. The human-readable name of a Nostr person lives
in a separate kind 0 (metadata) event, which an offline converter cannot reach.
This was documented as known lossiness in the C2 compliance audit. Consumers
that reconstruct AMB JSON from Nostr events therefore get nameless creators and
contributors.

## Goal

Offer an **opt-in, async** convenience entry point that enriches the converted
AMB output by fetching kind 0 profiles and filling in the `name` of
creator/contributor entries that carry a `nostr:` identity — without touching
the pure, synchronous `nostrToAmb`.

## Scope

- **In scope:** populate `person.name` only, for `creator` and `contributor`
  entries whose `id` is a `nostr:nprofile…` or `nostr:npub…` URI.
- **Out of scope:** richer profile fields (picture, about, nip05), enriching
  organizations/publishers, deduplicating the documented double-entry case,
  changing `nostrToAmb` itself.

## Approach

Add a **separate async sibling** function rather than overloading `nostrToAmb`.
A single function that is sometimes sync and sometimes returns a Promise
(depending on an option) is a typing footgun for consumers. Keeping two
functions gives a clean contract: `nostrToAmb` is always sync; the new function
is always async. The new function calls `nostrToAmb` internally and enriches its
result, so the pure converter and the C2 mirror-the-producer contract are
untouched.

Rejected alternatives:
- **Overload `nostrToAmb(event, { resolveProfiles })`** — sometimes-sync/
  sometimes-async signature; bad TS ergonomics.
- **Standalone `enrichPersonNames(amb, options)` post-processor** — more
  composable but pushes orchestration onto every caller and adds a third
  concept to document; more flexibility than needed (YAGNI).

## Architecture & Module Layout

Three small, independently testable units:

1. **`src/profiles/resolveNames.ts`** — orchestration. Exposes
   `nostrToAmbWithProfiles`. Runs sync `nostrToAmb`; on success, walks
   `creator`/`contributor`, collects entries whose `id` is a `nostr:` URI
   (decoded to a hex pubkey via `nip19.decode`), invokes the fetcher once for
   the unique pubkey set, and writes `name` onto each matching entry. Returns
   the same `ConversionResult<AmbLearningResource>` shape, enriched.

2. **`src/profiles/websocketFetcher.ts`** — the default `ProfileFetcher`. Opens
   a raw `WebSocket` REQ for `{ kinds:[0], authors:[…] }` across the default
   relays, parses each kind-0 `content` as JSON, and returns
   `Map<pubkey, { name?: string }>` (newest `created_at` wins per pubkey). No
   new dependency; works in the browser and Node 20+ (global `WebSocket`).

3. **Exports** — wire `nostrToAmbWithProfiles` (and the `ProfileFetcher` type)
   through `src/profiles/index.ts` → `src/index.ts` and `src/browser.ts`, so
   both the npm entry and the browser bundle expose it.

The fetcher is **injected** into the orchestrator, so the orchestrator is
unit-tested with a mock fetcher and zero network.

## Public API

```ts
nostrToAmbWithProfiles(
  event: NostrEvent,
  options?: {
    defaultLanguage?: string;   // forwarded to nostrToAmb
    relays?: string[];          // default below
    fetchProfile?: ProfileFetcher; // DI; default = websocketFetcher
    timeoutMs?: number;         // default 4000
  }
): Promise<ConversionResult<AmbLearningResource>>;

type ProfileFetcher = (
  pubkeys: string[],
  relays: string[],
  timeoutMs: number
) => Promise<Map<string, { name?: string }>>;
```

**Default relays:**
`['wss://purplepag.es', 'wss://relay.edufeed.org', 'wss://relay.damus.io']`
(`purplepag.es` is a kind-0 aggregator, so a strong default for profile
lookups; edufeed + damus broaden coverage).

## Data Flow

1. `const base = nostrToAmb(event, { defaultLanguage })`. If `!base.success`,
   return it unchanged (no fetch).
2. Walk `data.creator` + `data.contributor`; for each entry with a `nostr:` id,
   `nip19.decode` → hex pubkey. Build a **unique** pubkey set. If empty, return
   `base` untouched (zero network).
3. `const names = await fetchProfile([...set], relays, timeoutMs)`.
4. For each person entry, if `names.get(pubkey)?.name` exists **and the entry
   has no `name`**, set it. Mutate in place on the result object.
5. Return the enriched `ConversionResult`.

## Error / Failure Handling

All failures are graceful; the result stays `success: true` (mirrors today's
nameless-but-valid behavior). Warnings accumulate into the existing
`result.warnings` array.

- Fetcher throws / connection fails / times out → catch, enrich nothing, push
  warning `"profile fetch failed: <msg>"`.
- A pubkey not found, or kind-0 `content` has no `name` / is unparseable →
  leave that entry unnamed, push a per-pubkey warning
  `"no profile name for <npub-short>"`.
- An entry's `id` fails to decode → skip silently (not a resolvable nostr ref).
- **Double-entry stays as documented:** when the producer emitted both
  name-described `creator:*` core tags *and* a `p` tag for the same person, the
  output carries two person objects; enrichment fills `name` only on the
  `nostr:`-id one and does **not** dedup/merge (merging would diverge from the
  producer the converter mirrors — consistent with the C2 audit decision).

## Testing Strategy (TDD)

All unit tests, Vitest, no real network. New files under `tests/profiles/`.

**`resolveNames.test.ts`** (orchestrator, mock fetcher injected):
- Fills `name` on a `creator` whose id is `nostr:nprofile…`.
- Same for `contributor`.
- Multiple persons across creator+contributor → fetcher called **once** with
  the deduped pubkey set (assert call args).
- No `nostr:`-id persons → fetcher **never called**; result deep-equals plain
  `nostrToAmb`.
- `!success` base (e.g. wrong kind) → returned unchanged; fetcher never called.
- Fetcher rejects → result still `success:true`, persons unnamed, warning
  present.
- Pubkey absent from returned Map → entry stays unnamed, per-pubkey warning.
- Person that already has a `name` → not overwritten.
- Double-entry case → core entry untouched, p-tag entry gains its fetched name,
  no dedup (array length unchanged).
- Custom `relays`/`timeoutMs` forwarded to the injected fetcher.

**`websocketFetcher.test.ts`** (default fetcher, mock `WebSocket`):
- Inject a fake `WebSocket` that emits an `EVENT` kind-0 then `EOSE`; assert REQ
  filter is `{kinds:[0],authors:[…]}` and parsed name returned.
- Two kind-0 events for one pubkey → newest `created_at` wins.
- `EOSE` with no events → empty Map.
- Timeout (no EOSE) → resolves empty Map after `timeoutMs`, socket closed.
- Malformed `content` JSON → that pubkey omitted, no throw.

**Manual (not committed):** verify the round-trip against a real relay from
Node — generate the npub for a known edufeed author, run
`nostrToAmbWithProfiles`, confirm a real name returns. Keeps the committed suite
offline and deterministic.
