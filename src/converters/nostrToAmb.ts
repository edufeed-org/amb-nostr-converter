/**
 * Converter for Nostr events to AMB metadata
 */

import {
  NostrEvent,
  AmbLearningResource,
  ConversionResult,
  ConversionError,
  ConversionErrorCode,
} from '../types/index.js';

/**
 * Convert a Nostr event to AMB metadata
 */
export function nostrToAmb(
  event: NostrEvent,
  options?: { defaultLanguage?: string }
): ConversionResult<AmbLearningResource> {
  try {
    // Validate event structure
    if (!event.kind || event.kind !== 30142) {
      return {
        success: false,
        error: new ConversionError(
          'Invalid event kind. Expected 30142 for AMB events.',
          ConversionErrorCode.INVALID_FORMAT
        ),
      };
    }

    if (!event.tags || !Array.isArray(event.tags)) {
      return {
        success: false,
        error: new ConversionError(
          'Event must have a tags array',
          ConversionErrorCode.INVALID_FORMAT
        ),
      };
    }

    const warnings: string[] = [];
    const defaultLanguage = options?.defaultLanguage || 'de';

    // Partition tags: r dropped (C5), p/a held for native mapping, ext routed out,
    // everything else is AMB-core for the generic unflattener.
    const coreTags: string[][] = [];
    const extTags: string[][] = [];
    const pTags: string[][] = [];
    const aTags: string[][] = [];
    for (const tag of event.tags) {
      const key = tag[0];
      if (key === 'r') continue;
      if (key === 'p') { pTags.push(tag); continue; }
      if (key === 'a') { aTags.push(tag); continue; }
      if (typeof key === 'string' && (key.startsWith('ext:') || key.startsWith('ekw:'))) {
        extTags.push(tag); continue;
      }
      coreTags.push(tag);
    }

    // Unflatten AMB-core tags to AMB structure
    const amb: any = unflattenTags(coreTags, defaultLanguage);

    // C1/C6: extension namespace reconstruction
    const ext = reconstructExt(extTags, warnings);
    if (ext) amb.ext = ext;

    // Validate required fields
    if (!amb.id) {
      return { success: false, error: new ConversionError('Missing required field: id (d tag)', ConversionErrorCode.MISSING_REQUIRED_FIELD) };
    }
    if (!amb.name) {
      return { success: false, error: new ConversionError('Missing required field: name', ConversionErrorCode.MISSING_REQUIRED_FIELD) };
    }
    if (!amb.type || !Array.isArray(amb.type) || amb.type.length === 0) {
      return { success: false, error: new ConversionError('Missing required field: type', ConversionErrorCode.MISSING_REQUIRED_FIELD) };
    }

    const result: ConversionResult<AmbLearningResource> = { success: true, data: amb as AmbLearningResource };
    if (warnings.length > 0) result.warnings = warnings;
    return result;
  } catch (error) {
    return {
      success: false,
      error: new ConversionError(
        `Conversion failed: ${error instanceof Error ? error.message : String(error)}`,
        ConversionErrorCode.CONVERSION_FAILED
      ),
    };
  }
}

/**
 * Unflatten Nostr tags to AMB structure
 */
function unflattenTags(
  tags: string[][],
  defaultLanguage: string
): Partial<AmbLearningResource> {
  const result: any = {
    '@context': [
      'https://w3id.org/kim/amb/context.jsonld',
      { '@language': defaultLanguage },
    ],
  };

  // Group tags by their base key
  const tagGroups = new Map<string, string[][]>();
  const keywords: string[] = [];

  // First pass: collect and group tags
  for (const tag of tags) {
    if (!tag || tag.length < 2) continue;

    const [key, ...values] = tag;
    
    if (!key) continue;

    // Special case: d tag maps to id
    if (key === 'd' && values[0]) {
      result.id = values[0];
      continue;
    }

    // Special case: t tags map to keywords
    if (key === 't' && values[0]) {
      keywords.push(values[0]);
      continue;
    }

    // Group all other tags
    if (!tagGroups.has(key)) {
      tagGroups.set(key, []);
    }
    tagGroups.get(key)!.push(values);
  }

  // Add keywords if any
  if (keywords.length > 0) {
    result.keywords = keywords;
  }

  // Process grouped tags
  const processedKeys = new Set<string>();

  for (const [key, valuesList] of tagGroups) {
    if (processedKeys.has(key)) continue;

    const baseKey = key.split(':')[0];
    if (!baseKey) continue;

    // Collect all tags with the same base key, preserving original order
    // This is critical for boundary detection in reconstructNestedObjects
    const relatedTags: Array<{ key: string; values: string[] }> = [];
    for (const tag of tags) {
      if (!tag || tag.length < 2) continue;
      const tagKey = tag[0];
      if (!tagKey) continue;
      
      // Skip special tags
      if (tagKey === 'd' || tagKey === 't') continue;
      
      // Check if this tag matches our base key
      if (tagKey === key || tagKey.startsWith(baseKey + ':')) {
        const [, ...values] = tag;
        relatedTags.push({ key: tagKey, values });
        processedKeys.add(tagKey);
      }
    }

    // Reconstruct the property
    const value = reconstructProperty(baseKey, relatedTags);
    if (value !== undefined) {
      // Special cases: these fields must always be arrays in AMB spec
      const arrayFields = [
        'type', 'inLanguage', 'about', 'creator', 'contributor',
        'learningResourceType', 'audience', 'publisher', 'funder',
        'educationalLevel', 'teaches', 'assesses', 'competencyRequired',
        'encoding', 'caption', 'hasPart', 'isPartOf', 'isBasedOn',
        'mainEntityOfPage'
      ];

      if (arrayFields.includes(baseKey)) {
        result[baseKey] = Array.isArray(value) ? value : [value];
      } else {
        result[baseKey] = value;
      }
    }
  }

  // Post-process: normalize nested properties within relationship references
  // In AMB spec, relationship refs (hasPart, isPartOf, isBasedOn) have:
  //   - type: always an array (e.g., ["LearningResource"])
  //   - creator: always an array (e.g., [{ name: "...", type: "Person" }])
  const relationshipFields = ['hasPart', 'isPartOf', 'isBasedOn'];
  for (const field of relationshipFields) {
    if (result[field] && Array.isArray(result[field])) {
      result[field] = result[field].map((ref: any) => normalizeRelationshipRef(ref));
    }
  }

  return result;
}

/**
 * Normalize a relationship reference object
 * Ensures type and creator are arrays as required by AMB spec
 */
function normalizeRelationshipRef(ref: any): any {
  if (!ref || typeof ref !== 'object') return ref;

  // type must be an array
  if (ref.type !== undefined && !Array.isArray(ref.type)) {
    ref.type = [ref.type];
  }

  // creator must be an array
  if (ref.creator !== undefined && !Array.isArray(ref.creator)) {
    ref.creator = [ref.creator];
  }

  return ref;
}

/**
 * Reconstruct a property from flat tags
 */
function reconstructProperty(
  baseKey: string,
  tags: Array<{ key: string; values: string[] }>
): any {
  // Check if this is a nested structure
  const hasNested = tags.some((t) => t.key.includes(':'));

  if (!hasNested) {
    // Simple property
    if (tags.length === 1 && tags[0]) {
      return tags[0].values[0];
    }
    // Multiple values = array
    return tags.map((t) => t.values[0]);
  }

  // Nested structure - need to group into objects
  return reconstructNestedObjects(tags);
}

/**
 * Reconstruct nested objects from flat tags
 * This handles arrays of objects like about, creator, etc.
 */
function reconstructNestedObjects(
  tags: Array<{ key: string; values: string[] }>
): any {
  // Group tags into object instances
  const objects: any[] = [];
  let currentObject: any = {};
  let lastKeyAtTargetLevel: string | null = null;

  for (const tag of tags) {
    const parts = tag.key.split(':');
    const finalKey = parts[parts.length - 1];
    const value = tag.values[0];

    if (!finalKey || !value) continue;

    // Build nested structure to get target object
    let target = currentObject;
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part) {
        if (!target[part]) {
          target[part] = {};
        }
        target = target[part];
      }
    }

    // BOUNDARY DETECTION: Check if we should start a new object
    // Three-tier strategy:
    // 1. Priority: 'id' property signals a new object (semantic boundary)
    // 2. 'type' collision: If the previous tag at this level was also 'type',
    //    collect into array (multi-type like ["LearningResource", "Course"]).
    //    If non-type tags appeared in between, it's a new object boundary.
    // 3. Fallback: Any other property collision means new object
    let shouldStartNewObject = false;

    if (Object.keys(currentObject).length > 0) {
      if (finalKey === 'id' && target.hasOwnProperty('id')) {
        // Primary signal: 'id' reappearance means new object
        shouldStartNewObject = true;
      } else if (finalKey === 'type' && target.hasOwnProperty('type')) {
        // 'type' collision: boundary only if non-type tags appeared since last 'type'
        if (lastKeyAtTargetLevel !== 'type') {
          shouldStartNewObject = true;
        }
        // Otherwise: consecutive type tags → collect into array below
      } else if (target.hasOwnProperty(finalKey)) {
        // Fallback: Property collision means new object
        shouldStartNewObject = true;
      }
    }

    if (shouldStartNewObject) {
      objects.push(currentObject);
      currentObject = {};
      lastKeyAtTargetLevel = null;

      // Re-navigate to target in the new object
      target = currentObject;
      for (let i = 1; i < parts.length - 1; i++) {
        const part = parts[i];
        if (part) {
          if (!target[part]) {
            target[part] = {};
          }
          target = target[part];
        }
      }
    }

    // Handle multi-language prefLabel (e.g., about:prefLabel:de, about:prefLabel:en)
    // The spec uses prefLabel:<lang> format where lang is embedded in the key
    const secondToLastPart = parts.length >= 2 ? parts[parts.length - 2] : null;

    if (secondToLastPart === 'prefLabel') {
      // finalKey is the language code (e.g., 'de', 'en')
      const langCode = finalKey;

      // Navigate to parent of prefLabel
      let prefLabelTarget = currentObject;
      for (let i = 1; i < parts.length - 2; i++) {
        const part = parts[i];
        if (part) {
          if (!prefLabelTarget[part]) {
            prefLabelTarget[part] = {};
          }
          prefLabelTarget = prefLabelTarget[part];
        }
      }

      // Initialize or extend prefLabel object
      if (!prefLabelTarget.prefLabel) {
        prefLabelTarget.prefLabel = {};
      }
      prefLabelTarget.prefLabel[langCode] = value;
    } else if (finalKey === 'prefLabel') {
      // Fallback: simple prefLabel without language code
      target[finalKey] = value;
    } else if (finalKey === 'type' && target.hasOwnProperty('type')) {
      // Collect multiple type values into an array
      if (Array.isArray(target.type)) {
        target.type.push(value);
      } else {
        target.type = [target.type, value];
      }
    } else {
      target[finalKey] = value;
    }

    // Track last key at this nesting level for boundary detection
    lastKeyAtTargetLevel = finalKey;
  }

  // Add the last object
  if (Object.keys(currentObject).length > 0) {
    objects.push(currentObject);
  }

  // Return single object or array based on count
  return objects.length === 1 ? objects[0] : objects;
}

/**
 * Split an ext/ekw tag key into { ns, facet, sub, legacy }. Mirrors
 * edufeed-app's parseExtensionTags.parseTagKey. Returns null if not an ext key.
 */
function parseExtKey(
  key: string
): { ns: string; facet: string; sub: string | null; legacy: boolean } | null {
  if (!key) return null;
  const segments = key.split(':');
  if (segments.length < 2) return null;

  let body: string[];
  let legacy = false;
  if (segments[0] === 'ext') {
    body = segments.slice(1);
  } else if (segments[0] === 'ekw') {
    body = segments; // ns = 'ekw'
    legacy = true;
  } else {
    return null;
  }
  if (body.length < 2) return null;

  let sub: string | null = null;
  let tail = body.length;
  const lastSeg = body[body.length - 1];
  const prevSeg = body[body.length - 2];
  if (prevSeg === 'prefLabel') {
    if (!lastSeg) return null;
    sub = `prefLabel:${lastSeg}`;
    tail = body.length - 2;
  } else if (lastSeg === 'id' || lastSeg === 'type') {
    sub = lastSeg;
    tail = body.length - 1;
  }
  if (tail < 2) return null;

  const facet = body[tail - 1];
  const ns = body.slice(0, tail - 1).join(':');
  if (!ns || !facet) return null;
  return { ns, facet, sub, legacy };
}

/**
 * Reconstruct output.ext.<ns>.<facet> from ext/ekw tags. Concept facets
 * (with :id) become arrays of { id, type, prefLabel? }; scalar facets (bare
 * key) become string arrays. Pushes a migrate-warning per legacy namespace.
 */
function reconstructExt(
  extTags: string[][],
  warnings: string[]
): Record<string, Record<string, any>> | undefined {
  if (extTags.length === 0) return undefined;
  const legacyNamespaces = new Set<string>();
  const work: Record<string, Record<string, { kind: 'concept' | 'scalar'; items: any[] }>> = {};

  for (const tag of extTags) {
    const parsed = parseExtKey(tag[0]);
    if (!parsed) continue;
    const { ns, facet, sub, legacy } = parsed;
    if (legacy) legacyNamespaces.add(ns);
    const value = typeof tag[1] === 'string' ? tag[1] : '';

    if (!work[ns]) work[ns] = {};
    if (!work[ns][facet]) {
      work[ns][facet] = { kind: sub === null ? 'scalar' : 'concept', items: [] };
    }
    const f = work[ns][facet];

    if (sub === null) {
      if (f.kind !== 'scalar') continue;
      if (value) f.items.push(value);
    } else {
      if (f.kind !== 'concept') continue;
      if (sub === 'id') {
        if (value) f.items.push({ id: value, type: 'Concept' });
      } else if (sub === 'type') {
        // presence only; type is always 'Concept'
      } else if (sub.startsWith('prefLabel:')) {
        const lang = sub.slice('prefLabel:'.length);
        const last = f.items[f.items.length - 1];
        if (last && lang) {
          if (!last.prefLabel) last.prefLabel = {};
          last.prefLabel[lang] = value;
        }
      }
    }
  }

  const out: Record<string, Record<string, any>> = {};
  for (const ns of Object.keys(work)) {
    for (const facet of Object.keys(work[ns])) {
      const f = work[ns][facet];
      if (f.items.length === 0) continue;
      if (!out[ns]) out[ns] = {};
      out[ns][facet] = f.items;
    }
  }

  for (const ns of legacyNamespaces) {
    warnings.push(`legacy unprefixed ext namespace '${ns}'; producers should migrate to 'ext:${ns}:'`);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
