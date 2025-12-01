/**
 * Basic integration tests for the AMB-Nostr converter library
 */

import { ambToNostr, AmbLearningResource, NostrEducationalKind } from '../src';

describe('AMB-Nostr Converter Library', () => {
  describe('Module Exports', () => {
    test('should export ambToNostr function', () => {
      expect(typeof ambToNostr).toBe('function');
    });

    test('should export NostrEducationalKind enum', () => {
      expect(NostrEducationalKind).toBeDefined();
      expect(NostrEducationalKind.AMB).toBe(30142);
    });
  });

  describe('Basic Conversion', () => {
    test('should convert simple AMB resource to Nostr', () => {
      const ambResource: AmbLearningResource = {
        '@context': ['https://w3id.org/kim/amb/context.jsonld'],
        id: 'https://example.org/test',
        type: ['LearningResource'],
        name: 'Test Resource',
      };

      const result = ambToNostr(ambResource, {
        pubkey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timestamp: 1700000000,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.kind).toBe(NostrEducationalKind.AMB);
      expect(result.data?.pubkey).toBe('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    });

    test('should handle missing required fields', () => {
      const invalidResource = {
        '@context': ['https://w3id.org/kim/amb/context.jsonld'],
        type: ['LearningResource'],
        // missing id and name
      };

      const result = ambToNostr(invalidResource as any);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
