/**
 * Converter for Nostr events to AMB metadata
 */

import { nip19 } from 'nostr-tools';
import {
  NostrEvent,
  AmbLearningResource,
  ConversionResult,
  ConversionError,
  ConversionErrorCode,
} from '../types/index.js';

/** Matches an RFC 3986 scheme prefix, i.e. an absolute URI. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

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

    // C2: Nostr-native creator/contributor (p tags)
    applyPersonTags(amb, pTags);

    // C3: Nostr-native relations (a tags)
    applyRelationTags(amb, aTags);

    // C4: content is the preferred source for description
    if (typeof event.content === 'string' && event.content.length > 0) {
      amb.description = event.content;
    }

    // Coerce string-encoded scalars back to their AMB schema types.
    if (amb.isAccessibleForFree === 'true') amb.isAccessibleForFree = true;
    else if (amb.isAccessibleForFree === 'false') amb.isAccessibleForFree = false;
    if (amb.suggestedAge) {
      const sa = Array.isArray(amb.suggestedAge) ? amb.suggestedAge[0] : amb.suggestedAge;
      const coerced: { minValue?: number; maxValue?: number } = {};
      const min = parseInt(sa?.minValue, 10);
      const max = parseInt(sa?.maxValue, 10);
      if (Number.isFinite(min)) coerced.minValue = min;
      if (Number.isFinite(max)) coerced.maxValue = max;
      amb.suggestedAge = coerced;
    }

    // Non-URI d values (slugs) derive the AMB id as nostr:<naddr> per NIP-AMB.
    if (typeof amb.id === 'string' && amb.id && !URI_SCHEME.test(amb.id)) {
      if (event.pubkey) {
        try {
          const naddr = nip19.naddrEncode({
            identifier: amb.id,
            pubkey: event.pubkey,
            kind: event.kind,
          });
          amb.id = `nostr:${naddr}`;
        } catch {
          warnings.push(`d tag "${amb.id}" is not an absolute URI and naddr derivation failed; id kept verbatim`);
        }
      } else {
        warnings.push(`d tag "${amb.id}" is not an absolute URI and the event has no pubkey; id kept verbatim`);
      }
    }

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
 * Sub-properties an ext key may carry, per NIP-AMB. Anything else means the
 * key has a surplus segment.
 */
function isValidExtSub(sub: string): boolean {
  if (sub === 'id' || sub === 'type' || sub === 'name') return true;
  if (!sub.startsWith('prefLabel:')) return false;
  const lang = sub.slice('prefLabel:'.length);
  return lang.length > 0 && !lang.includes(':');
}

/**
 * Split an ext/ekw tag key into { ns, facet, sub, legacy }, parsing
 * left-anchored with the fixed arity NIP-AMB defines:
 *
 *   ext-key = "ext" ":" ns ":" facet [ ":" sub ]
 *   sub     = "id" / "type" / "name" / "prefLabel" ":" lang
 *
 * `<ns>` and `<facet>` MUST NOT contain ':'; `sub` is null for a scalar facet.
 * The unprefixed `ekw:<facet>[:<sub>]` shape is accepted as acknowledged legacy
 * and reported via `legacy`.
 *
 * Returns null for any key outside the grammar. A surplus segment makes the
 * split ambiguous — `ext:ekw:konfi:themen:id` reads as ns=ekw/facet=konfi
 * left-anchored and ns=ekw:konfi/facet=themen right-anchored, and our own
 * implementations picked different answers for the same bytes — so the NIP
 * requires consumers to ignore such keys rather than guess at a segmentation.
 */
function parseExtKey(
  key: string
): { ns: string; facet: string; sub: string | null; legacy: boolean } | null {
  if (!key) return null;
  const segments = key.split(':');

  // Prefixed keys drop the leading "ext"; legacy unprefixed keys use segment 0
  // as the namespace directly.
  let offset: number;
  let legacy = false;
  if (segments[0] === 'ext') {
    offset = 1;
  } else if (segments[0] === 'ekw') {
    offset = 0;
    legacy = true;
  } else {
    return null;
  }

  const ns = segments[offset];
  const facet = segments[offset + 1];
  if (!ns || !facet) return null;

  const rest = segments.slice(offset + 2);
  if (rest.length === 0) return { ns, facet, sub: null, legacy };

  const sub = rest.join(':');
  if (!isValidExtSub(sub)) return null;
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
  const ignoredKeys = new Set<string>();
  // A facet may legitimately carry both vocabulary concepts and free-text
  // scalars — the Konfi "pick from the list AND type your own" case. Concepts
  // and scalars accumulate separately and concatenate at the end (concepts
  // first, matching nostrlib typesense30142 nostr_amb.go), because a single
  // list would make the last-entry lookup that prefLabel/name attach to land
  // on a string. Fixing a facet to one kind on its first tag silently threw
  // the other half away.
  const work: Record<string, Record<string, { concepts: any[]; scalars: string[] }>> = {};

  for (const tag of extTags) {
    const key = tag[0];
    if (typeof key !== 'string') continue;
    const parsed = parseExtKey(key);
    if (!parsed) {
      // Outside the NIP-AMB grammar. Ignoring is normative — the segmentation
      // is ambiguous — but it is silent data loss from the caller's side, so
      // surface it rather than dropping it quietly.
      ignoredKeys.add(key);
      continue;
    }
    const { ns, facet, sub, legacy } = parsed;
    if (legacy) legacyNamespaces.add(ns);
    const value = typeof tag[1] === 'string' ? tag[1] : '';

    if (!work[ns]) work[ns] = {};
    if (!work[ns][facet]) {
      work[ns][facet] = { concepts: [], scalars: [] };
    }
    const f = work[ns][facet];

    if (sub === null) {
      if (value) f.scalars.push(value);
    } else {
      if (sub === 'id') {
        if (value) f.concepts.push({ id: value, type: 'Concept' });
      } else if (sub === 'type') {
        // presence only; type is always 'Concept'
      } else if (sub === 'name') {
        // Like prefLabel, name attaches to the concept opened by the preceding
        // id. A facet whose entries carry only a name has no id to boundary on,
        // so each tag starts its own entry.
        const last = f.concepts[f.concepts.length - 1];
        if (last && last.name === undefined) {
          last.name = value;
        } else if (value) {
          f.concepts.push({ name: value, type: 'Concept' });
        }
      } else if (sub.startsWith('prefLabel:')) {
        const lang = sub.slice('prefLabel:'.length);
        const last = f.concepts[f.concepts.length - 1];
        if (last && lang) {
          if (!last.prefLabel) last.prefLabel = {};
          last.prefLabel[lang] = value;
        }
      }
    }
  }

  const out: Record<string, Record<string, any>> = {};
  for (const ns of Object.keys(work)) {
    const nsWork = work[ns];
    if (!nsWork) continue;
    for (const facet of Object.keys(nsWork)) {
      const f = nsWork[facet];
      if (!f) continue;
      const items = [...f.concepts, ...f.scalars];
      if (items.length === 0) continue;
      if (!out[ns]) out[ns] = {};
      out[ns]![facet] = items;
    }
  }

  for (const ns of legacyNamespaces) {
    warnings.push(`legacy unprefixed ext namespace '${ns}'; producers should migrate to 'ext:${ns}:'`);
  }

  for (const key of ignoredKeys) {
    warnings.push(
      `ignored non-conforming ext key '${key}'; NIP-AMB requires ext:<ns>:<facet>[:<sub>] ` +
        `with colon-free <ns>/<facet> and <sub> in {id, type, name, prefLabel:<lang>}`
    );
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Map ["p", <pubkey>, <hint?>, <role>] tags (role creator|contributor) to
 * AMB person objects { name, type: "Person", id: "nostr:<nprofile>" }. Persons
 * without a creator/contributor role are ignored. The AMB schema requires
 * `name`, so it falls back to the npub encoding; profile-aware callers
 * (nostrToAmbWithProfiles) replace it with the kind:0 profile name.
 */
function applyPersonTags(amb: any, pTags: string[][]): void {
  for (const tag of pTags) {
    const pubkey = tag[1];
    const role = tag[3];
    if (!pubkey) continue;
    if (role !== 'creator' && role !== 'contributor') continue;
    const hint = tag[2];
    const relays = hint ? [hint] : [];
    let nprofile: string;
    let name: string;
    try {
      nprofile = nip19.nprofileEncode({ pubkey, relays });
      name = nip19.npubEncode(pubkey);
    } catch {
      continue;
    }
    const person = { name, type: 'Person', id: `nostr:${nprofile}` };
    if (!Array.isArray(amb[role])) amb[role] = [];
    amb[role].push(person);
  }
}

/**
 * Map ["a", "30142:<pub>:<d>", <hint?>, <role>] tags (role isBasedOn|isPartOf|
 * hasPart) to AMB relation objects { id: "nostr:<naddr>", type: "LearningResource" }.
 * Role 'form' and unknown roles are ignored.
 */
function applyRelationTags(amb: any, aTags: string[][]): void {
  const RELATION_ROLES = new Set(['isBasedOn', 'isPartOf', 'hasPart']);
  for (const tag of aTags) {
    const coord = tag[1];
    const role = tag[3];
    if (!coord || !role || !RELATION_ROLES.has(role)) continue;
    const parts = coord.split(':');
    if (parts.length < 3) continue;
    const rawKind = parts[0];
    const pubkey = parts[1];
    if (!rawKind || !pubkey) continue;
    const kind = parseInt(rawKind, 10);
    const identifier = parts.slice(2).join(':');
    if (!Number.isFinite(kind)) continue;
    const hint = tag[2];
    const relays = hint ? [hint] : [];
    let naddr: string;
    try {
      naddr = nip19.naddrEncode({ identifier, pubkey, kind, relays });
    } catch {
      continue;
    }
    const relation = { id: `nostr:${naddr}`, type: 'LearningResource' };
    if (!Array.isArray(amb[role])) amb[role] = [];
    amb[role].push(relation);
  }
}
