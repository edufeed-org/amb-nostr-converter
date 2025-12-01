/**
 * Tests for AMB to Nostr converter
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ambToNostr } from '../../src/converters/ambToNostr';
import {
  AmbLearningResource,
  NostrEducationalKind,
  ConversionOptions,
} from '../../src/types';

// Test data directory
const TEST_DATA_DIR = join(__dirname, '../data/amb');

// Load test fixtures
let courseSample: AmbLearningResource;
let presentationSample: AmbLearningResource;
let imageSample: AmbLearningResource;
let worksheetSample: AmbLearningResource;

beforeAll(() => {
  courseSample = JSON.parse(
    readFileSync(join(TEST_DATA_DIR, 'example_1_course.json'), 'utf-8')
  );
  presentationSample = JSON.parse(
    readFileSync(join(TEST_DATA_DIR, 'example_2_presentation.json'), 'utf-8')
  );
  imageSample = JSON.parse(
    readFileSync(join(TEST_DATA_DIR, 'example_3_image.json'), 'utf-8')
  );
  worksheetSample = JSON.parse(
    readFileSync(join(TEST_DATA_DIR, 'example_4_worksheet.json'), 'utf-8')
  );
});

describe('ambToNostr', () => {
  const testPubkey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const options: ConversionOptions = {
    pubkey: testPubkey,
    timestamp: 1700000000,
  };

  describe('Course Conversion', () => {
    test('should convert course to Nostr event', () => {
      const result = ambToNostr(courseSample, options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const event = result.data!;
      expect(event.pubkey).toBe(testPubkey);
      expect(event.kind).toBe(NostrEducationalKind.AMB);
      expect(event.created_at).toBe(1700000000);
      expect(event.tags).toBeInstanceOf(Array);
      expect(event.content).toBeDefined();
    });

    test('should include correct tags for course', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      // Check for required tags
      const dTag = event.tags.find(t => t[0] === 'd');
      expect(dTag).toBeDefined();
      expect(dTag![1]).toBe('https://oer.gitlab.io/OS'); // d tag now uses AMB ID directly

      const nameTag = event.tags.find(t => t[0] === 'name');
      expect(nameTag).toBeDefined();
      expect(nameTag![1]).toBe('Computer Structures and Operating Systems');

      const typeTags = event.tags.filter(t => t[0] === 'type');
      expect(typeTags.length).toBeGreaterThan(0);
      expect(typeTags.map(t => t[1])).toContain('Course');
    });

    test('should include creator tags', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      const creatorNameTags = event.tags.filter(t => t[0] === 'creator:name');
      expect(creatorNameTags.length).toBeGreaterThan(0);
      expect(creatorNameTags[0][1]).toBe('Dr. Jens Lechtenbörger');

      const creatorIdTags = event.tags.filter(t => t[0] === 'creator:id');
      expect(creatorIdTags.length).toBeGreaterThan(0);
      expect(creatorIdTags[0][1]).toBe('https://orcid.org/0000-0002-3064-147X');
    });

    test('should include keywords as hashtags', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      const hashtagTags = event.tags.filter(t => t[0] === 't');
      expect(hashtagTags.length).toBe(3);
      expect(hashtagTags.map(t => t[1])).toContain('computer science');
      expect(hashtagTags.map(t => t[1])).toContain('operation systems');
      expect(hashtagTags.map(t => t[1])).toContain('computer structures');
    });

    test('should include license information', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      const licenseTag = event.tags.find(t => t[0] === 'license:id');
      expect(licenseTag).toBeDefined();
      expect(licenseTag![1]).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    });

    test('should include educational metadata with language tags', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      // about:prefLabel:de -> Informatik
      const subjectTags = event.tags.filter(t => t[0] === 'about:prefLabel:de');
      expect(subjectTags.length).toBeGreaterThan(0);
      expect(subjectTags[0][1]).toBe('Informatik');

      // educationalLevel has both de and en
      const levelTagsDe = event.tags.filter(t => t[0] === 'educationalLevel:prefLabel:de');
      expect(levelTagsDe.length).toBeGreaterThan(0);
      expect(levelTagsDe[0][1]).toBe('Bachelor oder äquivalent');
      
      const levelTagsEn = event.tags.filter(t => t[0] === 'educationalLevel:prefLabel:en');
      expect(levelTagsEn.length).toBeGreaterThan(0);
      expect(levelTagsEn[0][1]).toBe('Bachelor or equivalent');

      // audience:prefLabel:en -> student
      const audienceTags = event.tags.filter(t => t[0] === 'audience:prefLabel:en');
      expect(audienceTags.length).toBeGreaterThan(0);
      expect(audienceTags[0][1]).toBe('student');
    });

    test('should handle multi-language prefLabels correctly', () => {
      const multiLangResource = {
        ...courseSample,
        about: [
          {
            id: 'http://example.org/concept',
            type: 'Concept' as const,
            prefLabel: {
              en: 'Computer Science',
              de: 'Informatik',
              fr: 'Informatique'
            }
          }
        ]
      };

      const result = ambToNostr(multiLangResource, options);
      expect(result.success).toBe(true);
      const event = result.data!;

      const enTag = event.tags.find(t => t[0] === 'about:prefLabel:en');
      expect(enTag).toBeDefined();
      expect(enTag![1]).toBe('Computer Science');

      const deTag = event.tags.find(t => t[0] === 'about:prefLabel:de');
      expect(deTag).toBeDefined();
      expect(deTag![1]).toBe('Informatik');

      const frTag = event.tags.find(t => t[0] === 'about:prefLabel:fr');
      expect(frTag).toBeDefined();
      expect(frTag![1]).toBe('Informatique');
    });

    test('should include hierarchical relationships', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      const hasPartTags = event.tags.filter(t => t[0] === 'hasPart:id');
      expect(hasPartTags.length).toBe(5); // Course has 5 parts
      expect(hasPartTags[0][1]).toBe('https://oer.gitlab.io/OS/Operating-Systems-JiTT.html');
    });

    test('should include language tags', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      const languageTags = event.tags.filter(t => t[0] === 'inLanguage');
      expect(languageTags.length).toBe(1);
      expect(languageTags[0][1]).toBe('en');
    });

    test('should have empty content field per AMB spec', () => {
      const result = ambToNostr(courseSample, options);
      const event = result.data!;

      // Per AMB spec, content field must be empty - all data goes in tags
      expect(event.content).toBe('');
    });
  });

  describe('Presentation Conversion', () => {
    test('should convert presentation to Nostr event', () => {
      const result = ambToNostr(presentationSample, options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const event = result.data!;
      expect(event.kind).toBe(NostrEducationalKind.AMB);
    });

    test('should include image tag', () => {
      const result = ambToNostr(presentationSample, options);
      const event = result.data!;

      const imageTag = event.tags.find(t => t[0] === 'image');
      expect(imageTag).toBeDefined();
      expect(imageTag![1]).toBe('https://dini-ag-kim.github.io/amb/20231019/img/os08-image.png');
    });

    test('should include date tags', () => {
      const result = ambToNostr(presentationSample, options);
      const event = result.data!;

      const dateCreatedTag = event.tags.find(t => t[0] === 'dateCreated');
      expect(dateCreatedTag).toBeDefined();
      expect(dateCreatedTag![1]).toBe('2020-06-25');

      const publishedAtTag = event.tags.find(t => t[0] === 'datePublished');
      expect(publishedAtTag).toBeDefined();
    });

    test('should include parent and child relationships', () => {
      const result = ambToNostr(presentationSample, options);
      const event = result.data!;

      const partOfTags = event.tags.filter(t => t[0] === 'isPartOf:id');
      expect(partOfTags.length).toBe(1);
      expect(partOfTags[0][1]).toBe('https://oer.gitlab.io/OS');

      const hasPartTags = event.tags.filter(t => t[0] === 'hasPart:id');
      expect(hasPartTags.length).toBe(1);
    });
  });

  describe('Image Conversion', () => {
    test('should convert image to Nostr event', () => {
      const result = ambToNostr(imageSample, options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const event = result.data!;
      expect(event.kind).toBe(NostrEducationalKind.AMB);
    });

    test('should include isBasedOn attribution', () => {
      const result = ambToNostr(imageSample, options);
      const event = result.data!;

      const basedOnTags = event.tags.filter(t => t[0] === 'isBasedOn:id');
      expect(basedOnTags.length).toBe(1);
      
      // All metadata is now in tags, not content
      expect(event.content).toBe('');
    });
  });

  describe('Worksheet Conversion', () => {
    test('should convert worksheet to Nostr event', () => {
      const result = ambToNostr(worksheetSample, options);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const event = result.data!;
      expect(event.kind).toBe(NostrEducationalKind.AMB);
    });

    test('should include publisher information', () => {
      const result = ambToNostr(worksheetSample, options);
      const event = result.data!;

      const publisherTags = event.tags.filter(t => t[0] === 'publisher:name');
      expect(publisherTags.length).toBe(1);
      expect(publisherTags[0][1]).toBe('Tutory');
    });
  });

  describe('Error Handling', () => {
    test('should fail for resource without id', () => {
      const invalidResource = { ...courseSample };
      delete (invalidResource as any).id;

      const result = ambToNostr(invalidResource as any, options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('id');
    });

    test('should fail for resource without name', () => {
      const invalidResource = { ...courseSample };
      delete (invalidResource as any).name;

      const result = ambToNostr(invalidResource as any, options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('name');
    });
  });

  describe('Options', () => {
    test('should use default pubkey when not provided', () => {
      const result = ambToNostr(courseSample, { timestamp: 1700000000 });

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain('default pubkey');
    });

    test('should have empty content regardless of options', () => {
      const result = ambToNostr(courseSample, options);

      expect(result.success).toBe(true);
      // Content is always empty per AMB spec, regardless of options
      expect(result.data!.content).toBe('');
    });

    test('should exclude relationships when option is set', () => {
      const result = ambToNostr(courseSample, {
        ...options,
        includeRelationships: false,
      });

      expect(result.success).toBe(true);
      const event = result.data!;

      const hasPartTags = event.tags.filter(t => t[0] === 'hasPart:id');
      expect(hasPartTags.length).toBe(0);
    });
  });

  describe('Deterministic IDs', () => {
    test('should generate consistent d tags for same resource', () => {
      const result1 = ambToNostr(courseSample, options);
      const result2 = ambToNostr(courseSample, options);

      const dTag1 = result1.data!.tags.find(t => t[0] === 'd');
      const dTag2 = result2.data!.tags.find(t => t[0] === 'd');

      expect(dTag1![1]).toBe(dTag2![1]);
    });

    test('should generate different d tags for different resources', () => {
      const result1 = ambToNostr(courseSample, options);
      const result2 = ambToNostr(presentationSample, options);

      const dTag1 = result1.data!.tags.find(t => t[0] === 'd');
      const dTag2 = result2.data!.tags.find(t => t[0] === 'd');

      expect(dTag1![1]).not.toBe(dTag2![1]);
    });
  });
});
