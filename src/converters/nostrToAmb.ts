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

    // Unflatten tags to AMB structure
    const amb = unflattenTags(event.tags, options?.defaultLanguage || 'de');

    // Validate required fields
    if (!amb.id) {
      return {
        success: false,
        error: new ConversionError(
          'Missing required field: id (d tag)',
          ConversionErrorCode.MISSING_REQUIRED_FIELD
        ),
      };
    }

    if (!amb.name) {
      return {
        success: false,
        error: new ConversionError(
          'Missing required field: name',
          ConversionErrorCode.MISSING_REQUIRED_FIELD
        ),
      };
    }

    if (!amb.type || !Array.isArray(amb.type) || amb.type.length === 0) {
      return {
        success: false,
        error: new ConversionError(
          'Missing required field: type',
          ConversionErrorCode.MISSING_REQUIRED_FIELD
        ),
      };
    }

    return {
      success: true,
      data: amb as AmbLearningResource,
    };
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
      const arrayFields = ['type', 'inLanguage', 'about', 'creator', 'contributor', 
                          'learningResourceType', 'audience', 'publisher', 'funder'];
      
      if (arrayFields.includes(baseKey)) {
        result[baseKey] = Array.isArray(value) ? value : [value];
      } else {
        result[baseKey] = value;
      }
    }
  }

  return result;
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
    // Two-tier strategy:
    // 1. Priority: 'id' property signals a new object (semantic boundary)
    // 2. Fallback: Property collision (property already exists at this level)
    let shouldStartNewObject = false;

    if (Object.keys(currentObject).length > 0) {
      if (finalKey === 'id' && target.hasOwnProperty('id')) {
        // Primary signal: 'id' reappearance means new object
        shouldStartNewObject = true;
      } else if (target.hasOwnProperty(finalKey)) {
        // Fallback: Property collision
        shouldStartNewObject = true;
      }
    }

    if (shouldStartNewObject) {
      objects.push(currentObject);
      currentObject = {};
      
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

    // Handle special cases like prefLabel with inLanguage
    if (finalKey === 'prefLabel') {
      // Look for corresponding inLanguage tag
      const currentIndex = tags.indexOf(tag);
      const langTag = tags.find((t, idx) => {
        return (
          t.key === parts.slice(0, -1).concat('inLanguage').join(':') &&
          idx > currentIndex - 2 &&
          idx < currentIndex + 2
        );
      });

      if (langTag && langTag.values[0]) {
        const lang = langTag.values[0];
        target[finalKey] = { [lang]: value };
      } else {
        target[finalKey] = value;
      }
    } else if (finalKey === 'inLanguage' && target.prefLabel) {
      // Already handled in prefLabel case
      continue;
    } else {
      target[finalKey] = value;
    }
  }

  // Add the last object
  if (Object.keys(currentObject).length > 0) {
    objects.push(currentObject);
  }

  // Return single object or array based on count
  return objects.length === 1 ? objects[0] : objects;
}
