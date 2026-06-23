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
