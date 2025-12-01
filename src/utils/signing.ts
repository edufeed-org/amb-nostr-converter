/**
 * Nostr event signing utilities
 */

import { getEventHash, getPublicKey, getSignature } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { NostrEducationalEvent } from '../types/nostr.js';

/**
 * Parse private key from various formats
 */
export function parsePrivateKey(key: string): string {
  // Check if it's an nsec (bech32 format)
  if (key.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(key);
      if (decoded.type !== 'nsec') {
        throw new Error('Invalid nsec format');
      }
      // decoded.data is the private key (could be string or Uint8Array depending on version)
      const data = decoded.data;
      if (typeof data === 'string') {
        return data.toLowerCase();
      }
      // If it's Uint8Array, convert to hex
      const bytes = data as unknown as Uint8Array;
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (error) {
      throw new Error(`Failed to decode nsec: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Otherwise treat as hex string
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('Private key must be 64 hex characters or nsec1... format');
  }
  
  return key.toLowerCase();
}

/**
 * Get public key from private key
 */
export function derivePublicKey(privateKeyHex: string): string {
  return getPublicKey(privateKeyHex);
}

/**
 * Sign a Nostr event
 */
export function signNostrEvent(
  event: NostrEducationalEvent,
  privateKeyHex: string
): NostrEducationalEvent & { id: string; sig: string } {
  // Calculate event ID
  const id = getEventHash(event);
  
  // Sign the event
  const sig = getSignature(event, privateKeyHex);
  
  return {
    ...event,
    id,
    sig,
  };
}

/**
 * Validate private key format
 */
export function isValidPrivateKey(key: string): boolean {
  try {
    parsePrivateKey(key);
    return true;
  } catch {
    return false;
  }
}
