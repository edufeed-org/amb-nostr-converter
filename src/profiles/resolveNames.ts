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
  const base =
    options.defaultLanguage !== undefined
      ? nostrToAmb(event, { defaultLanguage: options.defaultLanguage })
      : nostrToAmb(event);
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
