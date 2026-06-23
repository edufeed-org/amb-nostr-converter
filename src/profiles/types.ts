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
