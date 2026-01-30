/**
 * AMB Spec Invalid Examples Tests
 *
 * Tests our converter against the official AMB invalid examples from
 * https://github.com/dini-ag-kim/amb/tree/master/draft/examples/invalid
 *
 * For each invalid example: verify ambToNostr() doesn't crash.
 * Some invalid examples may still convert (they're invalid per JSON Schema
 * but may have enough structure for our converter), while others should fail.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ambToNostr } from '../../src/converters/ambToNostr.js';

const INVALID_DIR = join(__dirname, '../data/amb-spec/invalid');
const OPTIONS = {
  pubkey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  timestamp: 1700000000,
};

// Load all invalid example files
const invalidFiles = readdirSync(INVALID_DIR)
  .filter(f => f.endsWith('.json'))
  .sort();

describe('AMB Spec Invalid Examples Tests', () => {
  for (const filename of invalidFiles) {
    test(`does not crash: ${filename}`, () => {
      const raw = readFileSync(join(INVALID_DIR, filename), 'utf-8');
      const original = JSON.parse(raw);

      // Should not throw - either returns success or a structured error
      const result = ambToNostr(original, OPTIONS);

      // Result must be a valid ConversionResult (success or error)
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');

      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  }
});
