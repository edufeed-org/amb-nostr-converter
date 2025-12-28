/**
 * Type definitions for AMB-Nostr converter
 */

export * from './amb.js';
export * from './nostr.js';

/**
 * Conversion options
 */
export interface ConversionOptions {
  // Pubkey to use for Nostr events (required for AMB→Nostr)
  pubkey?: string;
  
  // Whether to include hierarchical relationships (hasPart, isPartOf)
  includeRelationships?: boolean;
  
  // Custom timestamp (defaults to current time)
  timestamp?: number;
  
  // Whether to generate deterministic event IDs based on AMB IDs
  deterministicIds?: boolean;
  
  // Relay hints to include in the event (NIP-65 style 'r' tags)
  relayHints?: string[];
}

/**
 * Conversion result with metadata
 */
export interface ConversionResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  warnings?: string[];
}

/**
 * Conversion error types
 */
export class ConversionError extends Error {
  constructor(
    message: string,
    public code: ConversionErrorCode,
    public details?: any
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}

export enum ConversionErrorCode {
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  CONVERSION_FAILED = 'CONVERSION_FAILED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
}
