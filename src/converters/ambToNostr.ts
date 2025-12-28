/**
 * AMB to Nostr Converter
 * Converts AMB learning resources to Nostr educational events
 */

import crypto from 'crypto';
import {
  AmbLearningResource,
  getResourceType,
  Person,
  Organization,
  Concept,
  LocalizedString,
} from '../types/amb.js';
import {
  NostrEducationalEvent,
  NostrEducationalKind,
  NostrTag,
  createTag,
  NostrEducationalContent,
} from '../types/nostr.js';
import {
  ConversionOptions,
  ConversionResult,
  ConversionError,
  ConversionErrorCode,
} from '../types/index.js';

/**
 * Default public key for testing (should be overridden in production)
 */
const DEFAULT_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Convert AMB learning resource to Nostr educational event
 */
export function ambToNostr(
  ambResource: AmbLearningResource,
  options: ConversionOptions = {}
): ConversionResult<NostrEducationalEvent> {
  const warnings: string[] = [];

  try {
    // Validate input
    if (!ambResource.id) {
      throw new ConversionError(
        'AMB resource must have an id',
        ConversionErrorCode.MISSING_REQUIRED_FIELD
      );
    }

    if (!ambResource.name) {
      throw new ConversionError(
        'AMB resource must have a name',
        ConversionErrorCode.MISSING_REQUIRED_FIELD
      );
    }

    // All AMB events use kind 30142 (AMB Metadata Event)
    const kind = NostrEducationalKind.AMB;
    
    // Get pubkey (required for Nostr events)
    const pubkey = options.pubkey || DEFAULT_PUBKEY;
    if (pubkey === DEFAULT_PUBKEY) {
      warnings.push('Using default pubkey - should provide a real pubkey in production');
    }

    // Get timestamp
    const created_at = options.timestamp || Math.floor(Date.now() / 1000);

    // Build tags array
    const tags: NostrTag[] = [];

    // Add deterministic identifier (d tag) - use original AMB ID directly per spec
    tags.push(createTag('d', ambResource.id));

    // Add resource types (can be multiple)
    const types = Array.isArray(ambResource.type) ? ambResource.type : [ambResource.type];
    types.forEach(type => {
      tags.push(createTag('type', type));
    });

    // Add name (spec uses 'name' not 'title')
    tags.push(createTag('name', ambResource.name));

    // Add description
    if (ambResource.description) {
      tags.push(createTag('description', ambResource.description));
    }

    // Add keywords as hashtags (Nostr-native 't' tags)
    if (ambResource.keywords && ambResource.keywords.length > 0) {
      ambResource.keywords.forEach(keyword => {
        tags.push(createTag('t', keyword.toLowerCase()));
      });
    }

    // Add languages
    if (ambResource.inLanguage && ambResource.inLanguage.length > 0) {
      ambResource.inLanguage.forEach(lang => {
        tags.push(createTag('inLanguage', lang));
      });
    }

    // Add creators (using colon-delimited tags)
    if (ambResource.creator && ambResource.creator.length > 0) {
      ambResource.creator.forEach(creator => {
        tags.push(createTag('creator:name', getPersonOrOrgName(creator)));
        tags.push(createTag('creator:type', creator.type));
        
        if ('id' in creator && creator.id) {
          tags.push(createTag('creator:id', creator.id));
        }
        
        if ('honorificPrefix' in creator && creator.honorificPrefix) {
          tags.push(createTag('creator:honorificPrefix', creator.honorificPrefix));
        }
        
        if ('affiliation' in creator && creator.affiliation) {
          if (creator.affiliation.name) {
            tags.push(createTag('creator:affiliation:name', creator.affiliation.name));
          }
          if (creator.affiliation.type) {
            tags.push(createTag('creator:affiliation:type', creator.affiliation.type));
          }
          if (creator.affiliation.id) {
            tags.push(createTag('creator:affiliation:id', creator.affiliation.id));
          }
        }
      });
    }

    // Add publishers (using colon-delimited tags)
    if (ambResource.publisher && ambResource.publisher.length > 0) {
      ambResource.publisher.forEach(publisher => {
        tags.push(createTag('publisher:name', getPersonOrOrgName(publisher)));
        tags.push(createTag('publisher:type', publisher.type));
        
        if ('id' in publisher && publisher.id) {
          tags.push(createTag('publisher:id', publisher.id));
        }
      });
    }

    // Add license (using colon-delimited tag)
    if (ambResource.license?.id) {
      tags.push(createTag('license:id', ambResource.license.id));
    }

    // Add free access flag (spec uses full name)
    if (typeof ambResource.isAccessibleForFree === 'boolean') {
      tags.push(createTag('isAccessibleForFree', ambResource.isAccessibleForFree.toString()));
    }

    // Add conditions of access (using colon-delimited tags)
    if (ambResource.conditionsOfAccess) {
      if (ambResource.conditionsOfAccess.id) {
        tags.push(createTag('conditionsOfAccess:id', ambResource.conditionsOfAccess.id));
      }
      if (ambResource.conditionsOfAccess.prefLabel) {
        Object.entries(ambResource.conditionsOfAccess.prefLabel).forEach(([lang, label]) => {
          tags.push(createTag(`conditionsOfAccess:prefLabel:${lang}`, label));
        });
      }
      if (ambResource.conditionsOfAccess.type) {
        tags.push(createTag('conditionsOfAccess:type', ambResource.conditionsOfAccess.type));
      }
    }

    // Add subjects (using colon-delimited tags)
    if (ambResource.about && ambResource.about.length > 0) {
      ambResource.about.forEach(subject => {
        if (subject.id) {
          tags.push(createTag('about:id', subject.id));
        }
        if (subject.prefLabel) {
          Object.entries(subject.prefLabel).forEach(([lang, label]) => {
            tags.push(createTag(`about:prefLabel:${lang}`, label));
          });
        }
        if (subject.type) {
          tags.push(createTag('about:type', subject.type));
        }
      });
    }

    // Add educational level (using colon-delimited tags)
    if (ambResource.educationalLevel && ambResource.educationalLevel.length > 0) {
      ambResource.educationalLevel.forEach(level => {
        if (level.id) {
          tags.push(createTag('educationalLevel:id', level.id));
        }
        if (level.prefLabel) {
          Object.entries(level.prefLabel).forEach(([lang, label]) => {
            tags.push(createTag(`educationalLevel:prefLabel:${lang}`, label));
          });
        }
        if (level.type) {
          tags.push(createTag('educationalLevel:type', level.type));
        }
      });
    }

    // Add audience (using colon-delimited tags)
    if (ambResource.audience && ambResource.audience.length > 0) {
      ambResource.audience.forEach(aud => {
        if (aud.id) {
          tags.push(createTag('audience:id', aud.id));
        }
        if (aud.prefLabel) {
          Object.entries(aud.prefLabel).forEach(([lang, label]) => {
            tags.push(createTag(`audience:prefLabel:${lang}`, label));
          });
        }
        if (aud.type) {
          tags.push(createTag('audience:type', aud.type));
        }
      });
    }

    // Add learning resource type (using colon-delimited tags)
    if (ambResource.learningResourceType && ambResource.learningResourceType.length > 0) {
      ambResource.learningResourceType.forEach(lrt => {
        if (lrt.id) {
          tags.push(createTag('learningResourceType:id', lrt.id));
        }
        if (lrt.prefLabel) {
          Object.entries(lrt.prefLabel).forEach(([lang, label]) => {
            tags.push(createTag(`learningResourceType:prefLabel:${lang}`, label));
          });
        }
        if (lrt.type) {
          tags.push(createTag('learningResourceType:type', lrt.type));
        }
      });
    }

    // Add published date (spec uses 'datePublished')
    if (ambResource.datePublished) {
      tags.push(createTag('datePublished', ambResource.datePublished));
    }

    // Add creation date (spec uses 'dateCreated')
    if (ambResource.dateCreated) {
      tags.push(createTag('dateCreated', ambResource.dateCreated));
    }

    // Add image
    if (ambResource.image) {
      tags.push(createTag('image', ambResource.image));
    }

    // Add relay hints (NIP-65 style 'r' tags)
    if (options.relayHints && options.relayHints.length > 0) {
      options.relayHints.forEach(relay => {
        tags.push(createTag('r', relay));
      });
    }

    // Add relationships if requested (using colon-delimited tags)
    if (options.includeRelationships !== false) {
      // hasPart relationships
      if (ambResource.hasPart && ambResource.hasPart.length > 0) {
        ambResource.hasPart.forEach(part => {
          tags.push(createTag('hasPart:id', part.id));
          if (part.name) {
            tags.push(createTag('hasPart:name', part.name));
          }
          if (part.type) {
            const types = Array.isArray(part.type) ? part.type : [part.type];
            types.forEach(type => {
              tags.push(createTag('hasPart:type', type));
            });
          }
        });
      }

      // isPartOf relationships
      if (ambResource.isPartOf && ambResource.isPartOf.length > 0) {
        ambResource.isPartOf.forEach(parent => {
          tags.push(createTag('isPartOf:id', parent.id));
          if (parent.name) {
            tags.push(createTag('isPartOf:name', parent.name));
          }
          if (parent.type) {
            const types = Array.isArray(parent.type) ? parent.type : [parent.type];
            types.forEach(type => {
              tags.push(createTag('isPartOf:type', type));
            });
          }
        });
      }

      // isBasedOn relationships
      if (ambResource.isBasedOn && ambResource.isBasedOn.length > 0) {
        ambResource.isBasedOn.forEach(source => {
          tags.push(createTag('isBasedOn:id', source.id));
          if (source.name) {
            tags.push(createTag('isBasedOn:name', source.name));
          }
        });
      }
    }

    // Create the Nostr event
    // Per AMB spec, content field must be empty - all data goes in tags
    const event: NostrEducationalEvent = {
      pubkey,
      created_at,
      kind,
      tags,
      content: '',
    };

    const result: ConversionResult<NostrEducationalEvent> = {
      success: true,
      data: event,
    };
    
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    
    return result;
  } catch (error) {
    if (error instanceof ConversionError) {
      return {
        success: false,
        error,
      };
    }

    return {
      success: false,
      error: new ConversionError(
        `Conversion failed: ${error instanceof Error ? error.message : String(error)}`,
        ConversionErrorCode.CONVERSION_FAILED,
        error
      ),
    };
  }
}


/**
 * Extract name from Person or Organization
 */
function getPersonOrOrgName(entity: Person | Organization): string {
  if ('honorificPrefix' in entity && entity.honorificPrefix) {
    return `${entity.honorificPrefix} ${entity.name}`;
  }
  return entity.name;
}
