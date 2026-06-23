/**
 * Tests for Nostr to AMB converter
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { nip19 } from 'nostr-tools';
import { nostrToAmb } from '../../src/converters/nostrToAmb';
import { NostrEvent, AmbLearningResource } from '../../src/types';

// Test data directory
const TEST_DATA_DIR = join(__dirname, '../data/nostr-amb');

// Load test fixtures
let event1: NostrEvent;
let expectedAmb1: AmbLearningResource;

beforeAll(() => {
  event1 = JSON.parse(
    readFileSync(join(TEST_DATA_DIR, 'event_1.json'), 'utf-8')
  );
  expectedAmb1 = JSON.parse(
    readFileSync(join(TEST_DATA_DIR, 'event_1_converted_amb.json'), 'utf-8')
  );
});

describe('nostrToAmb', () => {
  describe('Basic Conversion', () => {
    test('should convert Nostr event to AMB', () => {
      const result = nostrToAmb(event1);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const amb = result.data!;
      expect(amb.id).toBeDefined();
      expect(amb.name).toBeDefined();
      expect(amb.type).toBeDefined();
      expect(Array.isArray(amb.type)).toBe(true);
    });

    test('should include correct @context', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      expect(amb['@context']).toBeDefined();
      expect(Array.isArray(amb['@context'])).toBe(true);
      expect(amb['@context']).toContain('https://w3id.org/kim/amb/context.jsonld');
    });

    test('should use default language in context', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const context = amb['@context'] as any[];
      const langObj = context.find((item) => typeof item === 'object' && item['@language']);
      expect(langObj).toBeDefined();
      expect(langObj['@language']).toBe('de');
    });

    test('should allow custom default language', () => {
      const result = nostrToAmb(event1, { defaultLanguage: 'en' });
      const amb = result.data!;

      const context = amb['@context'] as any[];
      const langObj = context.find((item) => typeof item === 'object' && item['@language']);
      expect(langObj).toBeDefined();
      expect(langObj['@language']).toBe('en');
    });
  });

  describe('Required Fields', () => {
    test('should fail without d tag (id)', () => {
      const invalidEvent = {
        ...event1,
        tags: event1.tags.filter((t) => t[0] !== 'd'),
      };

      const result = nostrToAmb(invalidEvent);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('id');
    });

    test('should fail without name tag', () => {
      const invalidEvent = {
        ...event1,
        tags: event1.tags.filter((t) => t[0] !== 'name'),
      };

      const result = nostrToAmb(invalidEvent);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('name');
    });

    test('should fail without type tag', () => {
      const invalidEvent = {
        ...event1,
        tags: event1.tags.filter((t) => t[0] !== 'type'),
      };

      const result = nostrToAmb(invalidEvent);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('type');
    });

    test('should fail with wrong event kind', () => {
      const invalidEvent = {
        ...event1,
        kind: 1,
      };

      const result = nostrToAmb(invalidEvent);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('kind');
    });
  });

  describe('Field Mapping', () => {
    test('d tag should map to id', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const dTag = event1.tags.find((t) => t[0] === 'd');
      expect(amb.id).toBe(dTag![1]);
    });

    test('name tag should map to name', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const nameTag = event1.tags.find((t) => t[0] === 'name');
      expect(amb.name).toBe(nameTag![1]);
    });

    test('type tags should map to type array', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const typeTags = event1.tags.filter((t) => t[0] === 'type');
      expect(amb.type).toEqual(typeTags.map((t) => t[1]));
    });

    test('description tag should map to description', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const descTag = event1.tags.find((t) => t[0] === 'description');
      expect(amb.description).toBe(descTag![1]);
    });

    test('t tags should map to keywords array', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const tTags = event1.tags.filter((t) => t[0] === 't');
      expect(amb.keywords).toEqual(tTags.map((t) => t[1]));
    });

    test('inLanguage tags should map to inLanguage array', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const langTags = event1.tags.filter((t) => t[0] === 'inLanguage');
      expect(amb.inLanguage).toEqual(langTags.map((t) => t[1]));
    });
  });

  describe('Nested Objects', () => {
    test('license:id should map to license object', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const licenseTag = event1.tags.find((t) => t[0] === 'license:id');
      expect(amb.license).toBeDefined();
      expect(amb.license!.id).toBe(licenseTag![1]);
    });

    test('about tags should reconstruct about array', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      expect(amb.about).toBeDefined();
      expect(Array.isArray(amb.about)).toBe(true);
      expect(amb.about!.length).toBeGreaterThan(0);

      const firstAbout = amb.about![0];
      expect(firstAbout.id).toBeDefined();
      expect(firstAbout.type).toBe('Concept');
    });

    test('about prefLabel should be multi-language object', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const firstAbout = amb.about![0];
      expect(firstAbout.prefLabel).toBeDefined();
      
      // prefLabel should be an object with language code as key
      if (typeof firstAbout.prefLabel === 'object') {
        expect(firstAbout.prefLabel.de).toBeDefined();
      }
    });
  });

  describe('Array Reconstruction', () => {
    test('should handle multiple about objects', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      expect(amb.about).toBeDefined();
      expect(Array.isArray(amb.about)).toBe(true);
      
      // Each about object should have an id
      amb.about!.forEach((aboutItem) => {
        expect(aboutItem.id).toBeDefined();
      });
    });

    test('should preserve keywords order', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      const tTags = event1.tags.filter((t) => t[0] === 't');
      const expectedKeywords = tTags.map((t) => t[1]);

      expect(amb.keywords).toEqual(expectedKeywords);
    });
  });

  describe('Optional Fields', () => {
    test('should handle missing optional fields gracefully', () => {
      const minimalEvent: NostrEvent = {
        kind: 30142,
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: 123456,
        tags: [
          ['d', 'test-resource-id'],
          ['name', 'Test Resource'],
          ['type', 'LearningResource'],
        ],
        content: '',
        sig: 'test-sig',
      };

      const result = nostrToAmb(minimalEvent);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toBe('test-resource-id');
      expect(result.data!.name).toBe('Test Resource');
      expect(result.data!.type).toEqual(['LearningResource']);
    });
  });

  describe('Complex Nested Structures', () => {
    test('should handle deeply nested objects', () => {
      const complexEvent: NostrEvent = {
        kind: 30142,
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: 123456,
        tags: [
          ['d', 'complex-resource'],
          ['name', 'Complex Resource'],
          ['type', 'LearningResource'],
          ['creator:name', 'John Doe'],
          ['creator:type', 'Person'],
          ['creator:affiliation:name', 'MIT'],
          ['creator:affiliation:type', 'Organization'],
        ],
        content: '',
        sig: 'test-sig',
      };

      const result = nostrToAmb(complexEvent);

      expect(result.success).toBe(true);
      const amb = result.data!;

      expect(amb.creator).toBeDefined();
      const creator = amb.creator![0] as any;
      expect(creator.affiliation).toBeDefined();
      expect(creator.affiliation.name).toBe('MIT');
      expect(creator.affiliation.type).toBe('Organization');
    });

    test('should handle multiple creators', () => {
      const multiCreatorEvent: NostrEvent = {
        kind: 30142,
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: 123456,
        tags: [
          ['d', 'multi-creator-resource'],
          ['name', 'Multi Creator Resource'],
          ['type', 'LearningResource'],
          ['creator:name', 'John Doe'],
          ['creator:type', 'Person'],
          ['creator:name', 'Jane Smith'],
          ['creator:type', 'Person'],
        ],
        content: '',
        sig: 'test-sig',
      };

      const result = nostrToAmb(multiCreatorEvent);

      expect(result.success).toBe(true);
      const amb = result.data!;

      expect(amb.creator).toBeDefined();
      expect(Array.isArray(amb.creator)).toBe(true);
      expect(amb.creator!.length).toBe(2);
      expect(amb.creator![0].name).toBe('John Doe');
      expect(amb.creator![1].name).toBe('Jane Smith');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty tags array', () => {
      const emptyEvent: NostrEvent = {
        kind: 30142,
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: 123456,
        tags: [],
        content: '',
        sig: 'test-sig',
      };

      const result = nostrToAmb(emptyEvent);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle malformed tags', () => {
      const malformedEvent: NostrEvent = {
        kind: 30142,
        id: 'test-id',
        pubkey: 'test-pubkey',
        created_at: 123456,
        tags: [
          ['d', 'test-id'],
          ['name', 'Test'],
          ['type', 'LearningResource'],
          ['invalid'], // Malformed tag - no value
          ['also:invalid'], // Will be ignored if malformed
        ],
        content: '',
        sig: 'test-sig',
      };

      const result = nostrToAmb(malformedEvent);

      // Should still succeed, just ignore malformed tags
      expect(result.success).toBe(true);
    });
  });

  describe('Validation Against Test Fixtures', () => {
    test('should match expected AMB structure for event_1', () => {
      const result = nostrToAmb(event1);

      expect(result.success).toBe(true);
      const amb = result.data!;

      // Check core fields
      expect(amb.name).toBe(expectedAmb1.name);
      expect(amb.description).toBe(expectedAmb1.description);
      expect(amb.type).toEqual(expectedAmb1.type);

      // Check keywords
      expect(amb.keywords).toEqual(expectedAmb1.keywords);

      // Check inLanguage
      expect(amb.inLanguage).toEqual(expectedAmb1.inLanguage);

      // Check license
      expect(amb.license?.id).toBe(expectedAmb1.license?.id);
    });

    test('should reconstruct about array correctly', () => {
      const result = nostrToAmb(event1);
      const amb = result.data!;

      expect(amb.about).toBeDefined();
      expect(Array.isArray(amb.about)).toBe(true);

      // Check first about item matches expected structure
      if (expectedAmb1.about && expectedAmb1.about.length > 0) {
        expect(amb.about![0].id).toBe(expectedAmb1.about[0].id);
        expect(amb.about![0].type).toBe(expectedAmb1.about[0].type);
      }
    });
  });
});

describe('ext namespace reconstruction', () => {
  function baseEvent(tags: string[][]) {
    return { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '', tags: [['d', 'https://example.org/r1'], ['name', 'T'], ['type', 'LearningResource'], ...tags] };
  }

  test('reconstructs prefixed concept ext facet', () => {
    const ev = baseEvent([
      ['ext:ekw:gradeLevel:id', 'https://example.org/grade/5'],
      ['ext:ekw:gradeLevel:prefLabel:de', 'Klasse 5'],
      ['ext:ekw:gradeLevel:type', 'Concept'],
    ]);
    const result = nostrToAmb(ev);
    expect(result.success).toBe(true);
    expect(result.data!.ext!.ekw.gradeLevel).toEqual([
      { id: 'https://example.org/grade/5', type: 'Concept', prefLabel: { de: 'Klasse 5' } },
    ]);
  });

  test('form-emitted ns keeps the 30168 coordinate', () => {
    const ev = baseEvent([['ext:30168:pub1:formd:fach:id', 'https://example.org/fach/reli']]);
    const result = nostrToAmb(ev);
    expect(result.data!.ext!['30168:pub1:formd'].fach).toEqual([
      { id: 'https://example.org/fach/reli', type: 'Concept' },
    ]);
  });

  test('legacy unprefixed ekw lands in ext.ekw with a warning', () => {
    const ev = baseEvent([['ekw:gradeLevel:id', 'https://example.org/grade/5']]);
    const result = nostrToAmb(ev);
    expect(result.data!.ext!.ekw.gradeLevel).toEqual([{ id: 'https://example.org/grade/5', type: 'Concept' }]);
    expect(result.warnings?.some((w) => w.includes("legacy unprefixed ext namespace 'ekw'"))).toBe(true);
  });

  test('r tags are excluded from AMB output', () => {
    const ev = baseEvent([['r', 'https://oersi.org/x']]);
    const result = nostrToAmb(ev);
    expect((result.data as any).r).toBeUndefined();
  });
});

describe('p tag reverse mapping', () => {
  test('maps p tag with creator role to nostr nprofile id', () => {
    const pub = 'b'.repeat(64);
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'],
             ['p', pub, 'wss://relay.example', 'creator']] };
    const result = nostrToAmb(ev);
    expect(result.success).toBe(true);
    const creators = result.data!.creator!;
    expect(creators).toHaveLength(1);
    expect((creators[0] as any).type).toBe('Person');
    const decoded = nip19.decode((creators[0] as any).id.replace('nostr:', ''));
    expect(decoded.type).toBe('nprofile');
    expect((decoded.data as any).pubkey).toBe(pub);
  });

  test('ignores p tags without creator/contributor role', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'], ['p', 'c'.repeat(64)]] };
    const result = nostrToAmb(ev);
    expect(result.data!.creator).toBeUndefined();
    expect(result.data!.contributor).toBeUndefined();
  });
});

describe('a tag reverse mapping', () => {
  test('maps a tag with hasPart role to nostr naddr id', () => {
    const pub = 'd'.repeat(64);
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'],
             ['a', `30142:${pub}:child-d`, 'wss://relay.example', 'hasPart']] };
    const result = nostrToAmb(ev);
    const parts = (result.data as any).hasPart;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('LearningResource');
    const decoded = nip19.decode(parts[0].id.replace('nostr:', ''));
    expect(decoded.type).toBe('naddr');
    expect((decoded.data as any).identifier).toBe('child-d');
    expect((decoded.data as any).pubkey).toBe(pub);
    expect((decoded.data as any).kind).toBe(30142);
  });

  test('ignores a tags with form role', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'],
             ['a', '30168:e'.repeat(1) + '0'.repeat(63) + ':formd', 'wss://r', 'form']] };
    const result = nostrToAmb(ev);
    expect((result.data as any).isBasedOn).toBeUndefined();
    expect((result.data as any).isPartOf).toBeUndefined();
    expect((result.data as any).hasPart).toBeUndefined();
  });
});

describe('content to description', () => {
  test('non-empty content overrides description tag', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: 'From content field',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'], ['description', 'From tag']] };
    const result = nostrToAmb(ev);
    expect(result.data!.description).toBe('From content field');
  });

  test('empty content falls back to description tag', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'], ['description', 'From tag']] };
    const result = nostrToAmb(ev);
    expect(result.data!.description).toBe('From tag');
  });
});
