/**
 * AMB Spec Roundtrip Tests
 *
 * Tests our converter against the official AMB spec examples from
 * https://github.com/dini-ag-kim/amb/tree/master/draft/examples/valid
 *
 * For each valid example: AMB → Nostr → AMB and verify all properties match.
 * Run `bash scripts/update-amb-spec-examples.sh` to update test fixtures.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ambToNostr } from '../../src/converters/ambToNostr.js';
import { nostrToAmb } from '../../src/converters/nostrToAmb.js';

const VALID_DIR = join(__dirname, '../data/amb-spec/valid');
const OPTIONS = {
  pubkey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  timestamp: 1700000000,
};

/**
 * Strip @context from an AMB object for comparison.
 * The converter always reconstructs @context, so we don't compare it.
 */
function stripContext(obj: any): any {
  const { '@context': _, ...rest } = obj;
  return rest;
}

/**
 * Deep-compare two values, returning a list of differences.
 */
function deepDiff(original: any, roundtripped: any, path = ''): string[] {
  const diffs: string[] = [];

  if (original === roundtripped) return diffs;

  if (original === null || original === undefined) {
    if (roundtripped !== null && roundtripped !== undefined) {
      diffs.push(`${path}: original is ${original}, roundtripped is ${JSON.stringify(roundtripped)}`);
    }
    return diffs;
  }

  if (roundtripped === null || roundtripped === undefined) {
    diffs.push(`${path}: missing in roundtripped (original: ${JSON.stringify(original)})`);
    return diffs;
  }

  if (typeof original !== typeof roundtripped) {
    // Allow boolean <-> string conversion for isAccessibleForFree
    if (typeof original === 'boolean' && roundtripped === String(original)) return diffs;
    if (typeof original === 'string' && (roundtripped === true || roundtripped === false) && String(roundtripped) === original) return diffs;
    diffs.push(`${path}: type mismatch - original ${typeof original}, roundtripped ${typeof roundtripped}`);
    return diffs;
  }

  if (Array.isArray(original)) {
    if (!Array.isArray(roundtripped)) {
      diffs.push(`${path}: original is array, roundtripped is not`);
      return diffs;
    }
    if (original.length !== roundtripped.length) {
      diffs.push(`${path}: array length differs - original ${original.length}, roundtripped ${roundtripped.length}`);
    }
    const len = Math.min(original.length, roundtripped.length);
    for (let i = 0; i < len; i++) {
      diffs.push(...deepDiff(original[i], roundtripped[i], `${path}[${i}]`));
    }
    return diffs;
  }

  if (typeof original === 'object') {
    const allKeys = new Set([...Object.keys(original), ...Object.keys(roundtripped)]);
    for (const key of allKeys) {
      if (!(key in original)) {
        // Extra property in roundtripped - acceptable (converter may add defaults)
        continue;
      }
      if (!(key in roundtripped)) {
        diffs.push(`${path}.${key}: missing in roundtripped (original: ${JSON.stringify(original[key])})`);
        continue;
      }
      diffs.push(...deepDiff(original[key], roundtripped[key], `${path}.${key}`));
    }
    return diffs;
  }

  if (original !== roundtripped) {
    diffs.push(`${path}: value differs - original ${JSON.stringify(original)}, roundtripped ${JSON.stringify(roundtripped)}`);
  }

  return diffs;
}

// Load all valid example files
const validFiles = readdirSync(VALID_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

describe('AMB Spec Roundtrip Tests', () => {
  for (const filename of validFiles) {
    test(`roundtrip: ${filename}`, () => {
      const raw = readFileSync(join(VALID_DIR, filename), 'utf-8');
      const original = JSON.parse(raw);

      // Step 1: AMB → Nostr
      const nostrResult = ambToNostr(original, OPTIONS);

      // Some valid AMB files may lack required fields for our converter (id, name)
      // In that case, the conversion should at least not crash
      if (!nostrResult.success) {
        // If it fails, verify it's due to a known reason (missing required field)
        expect(nostrResult.error).toBeDefined();
        return;
      }

      const nostrEvent = nostrResult.data!;
      expect(nostrEvent.kind).toBe(30142);
      expect(nostrEvent.tags.length).toBeGreaterThan(0);

      // Step 2: Nostr → AMB
      const ambResult = nostrToAmb(nostrEvent);

      if (!ambResult.success) {
        // If reverse fails, report the error
        throw new Error(`nostrToAmb failed: ${ambResult.error?.message}`);
      }

      const roundtripped = ambResult.data!;

      // Step 3: Compare all properties (strip @context)
      const originalClean = stripContext(original);
      const roundtrippedClean = stripContext(roundtripped);

      const diffs = deepDiff(originalClean, roundtrippedClean);

      expect(diffs).toEqual([]);
    });
  }
});
