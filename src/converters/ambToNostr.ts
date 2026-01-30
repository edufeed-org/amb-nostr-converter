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
  MediaObject,
  FundingScheme,
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

    // Normalize non-standard AMB fields
    // Some sources (e.g. sitemap parsers) emit `type` as Concept[] instead of string[]
    let normalizedTypes: string[];
    const rawTypes = Array.isArray(ambResource.type) ? ambResource.type : [ambResource.type];
    if (rawTypes.length > 0 && typeof rawTypes[0] === 'object') {
      warnings.push('Non-standard AMB: type contains Concept objects instead of strings, normalizing via id');
      normalizedTypes = rawTypes.map((t: any) => t.id || String(t));
    } else {
      normalizedTypes = rawTypes as string[];
    }

    // Some sources emit `license` as Concept[] instead of { id: string }
    let normalizedLicense: { id: string } | undefined;
    if (ambResource.license) {
      if (Array.isArray(ambResource.license)) {
        warnings.push('Non-standard AMB: license is an array of Concepts, using first entry');
        const first = (ambResource.license as any[])[0];
        if (first?.id) {
          normalizedLicense = { id: first.id };
        }
      } else {
        normalizedLicense = ambResource.license;
      }
    }

    // Build tags array
    const tags: NostrTag[] = [];

    // Add deterministic identifier (d tag) - use original AMB ID directly per spec
    tags.push(createTag('d', ambResource.id));

    // Add resource types (can be multiple)
    normalizedTypes.forEach(type => {
      tags.push(createTag('type', type));
    });

    // Add name (spec uses 'name' not 'title')
    tags.push(createTag('name', ambResource.name));

    // Add description
    if (ambResource.description) {
      tags.push(createTag('description', ambResource.description));
    }

    // Add keywords as hashtags (Nostr-native 't' tags)
    // Preserve original case for lossless roundtrip
    if (ambResource.keywords && ambResource.keywords.length > 0) {
      ambResource.keywords.forEach(keyword => {
        tags.push(createTag('t', keyword));
      });
    }

    // Add languages
    if (ambResource.inLanguage && ambResource.inLanguage.length > 0) {
      ambResource.inLanguage.forEach(lang => {
        tags.push(createTag('inLanguage', lang));
      });
    }

    // Add creators (using colon-delimited tags + optional p tags for Nostr pubkeys)
    if (ambResource.creator && ambResource.creator.length > 0) {
      ambResource.creator.forEach(creator => {
        addPersonOrOrgTags(tags, 'creator', creator);
        // Add Nostr-native p tag if pubkey is available
        if ('nostrPubkey' in creator && creator.nostrPubkey) {
          const relayHint = ('relayHint' in creator && creator.relayHint)
            ? creator.relayHint
            : options.defaultRelayHint || '';
          tags.push(['p', creator.nostrPubkey, relayHint, 'creator']);
        }
      });
    }

    // Add contributors (using colon-delimited tags + optional p tags for Nostr pubkeys)
    if (ambResource.contributor && ambResource.contributor.length > 0) {
      ambResource.contributor.forEach(contributor => {
        addPersonOrOrgTags(tags, 'contributor', contributor);
        // Add Nostr-native p tag if pubkey is available
        if ('nostrPubkey' in contributor && contributor.nostrPubkey) {
          const relayHint = ('relayHint' in contributor && contributor.relayHint)
            ? contributor.relayHint
            : options.defaultRelayHint || '';
          tags.push(['p', contributor.nostrPubkey, relayHint, 'contributor']);
        }
      });
    }

    // Add publishers (using colon-delimited tags)
    if (ambResource.publisher && ambResource.publisher.length > 0) {
      ambResource.publisher.forEach(publisher => {
        addPersonOrOrgTags(tags, 'publisher', publisher);
      });
    }

    // Add funders (using colon-delimited tags)
    if (ambResource.funder && ambResource.funder.length > 0) {
      ambResource.funder.forEach(funder => {
        addPersonOrOrgTags(tags, 'funder', funder);
      });
    }

    // Add license (using colon-delimited tag)
    if (normalizedLicense?.id) {
      tags.push(createTag('license:id', normalizedLicense.id));
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

    // Add modification date
    if (ambResource.dateModified) {
      tags.push(createTag('dateModified', ambResource.dateModified));
    }

    // Add duration (ISO8601 format)
    if (ambResource.duration) {
      tags.push(createTag('duration', ambResource.duration));
    }

    // Add image
    if (ambResource.image) {
      tags.push(createTag('image', ambResource.image));
    }

    // Add trailer (MediaObject)
    if (ambResource.trailer) {
      addMediaObjectTags(tags, 'trailer', ambResource.trailer);
    }

    // Add encoding (MediaObject array)
    if (ambResource.encoding && ambResource.encoding.length > 0) {
      ambResource.encoding.forEach(enc => {
        addMediaObjectTags(tags, 'encoding', enc);
      });
    }

    // Add caption (MediaObject array)
    if (ambResource.caption && ambResource.caption.length > 0) {
      ambResource.caption.forEach(cap => {
        addMediaObjectTags(tags, 'caption', cap);
      });
    }

    // Add teaches (Concept array)
    if (ambResource.teaches && ambResource.teaches.length > 0) {
      ambResource.teaches.forEach(concept => {
        addConceptTags(tags, 'teaches', concept);
      });
    }

    // Add assesses (Concept array)
    if (ambResource.assesses && ambResource.assesses.length > 0) {
      ambResource.assesses.forEach(concept => {
        addConceptTags(tags, 'assesses', concept);
      });
    }

    // Add competencyRequired (Concept array)
    if (ambResource.competencyRequired && ambResource.competencyRequired.length > 0) {
      ambResource.competencyRequired.forEach(concept => {
        addConceptTags(tags, 'competencyRequired', concept);
      });
    }

    // Add interactivityType (Concept)
    if (ambResource.interactivityType) {
      addConceptTags(tags, 'interactivityType', ambResource.interactivityType);
    }

    // Add mainEntityOfPage (array of complex objects)
    if (ambResource.mainEntityOfPage && ambResource.mainEntityOfPage.length > 0) {
      ambResource.mainEntityOfPage.forEach(entity => {
        tags.push(createTag('mainEntityOfPage:id', entity.id));
        if (entity.type) {
          tags.push(createTag('mainEntityOfPage:type', entity.type));
        }
        if (entity.provider) {
          if (entity.provider.id) {
            tags.push(createTag('mainEntityOfPage:provider:id', entity.provider.id));
          }
          if (entity.provider.name) {
            tags.push(createTag('mainEntityOfPage:provider:name', entity.provider.name));
          }
          if (entity.provider.type) {
            tags.push(createTag('mainEntityOfPage:provider:type', entity.provider.type));
          }
        }
        if (entity.dateCreated) {
          tags.push(createTag('mainEntityOfPage:dateCreated', entity.dateCreated));
        }
        if (entity.dateModified) {
          tags.push(createTag('mainEntityOfPage:dateModified', entity.dateModified));
        }
        // Add Nostr-native r tag for the URL
        tags.push(['r', entity.id]);
      });
    }

    // Add relationships if requested (using colon-delimited tags + optional a tags)
    if (options.includeRelationships !== false) {
      const addRelationshipTags = (prefix: string, refs: typeof ambResource.hasPart) => {
        if (!refs || refs.length === 0) return;
        refs.forEach(ref => {
          tags.push(createTag(`${prefix}:id`, ref.id));
          if (ref.name) {
            tags.push(createTag(`${prefix}:name`, ref.name));
          }
          if (ref.type) {
            const types = Array.isArray(ref.type) ? ref.type : [ref.type];
            types.forEach(type => {
              tags.push(createTag(`${prefix}:type`, type));
            });
          }
          // Add nested creator tags
          if (ref.creator && ref.creator.length > 0) {
            ref.creator.forEach(creator => {
              addPersonOrOrgTags(tags, `${prefix}:creator`, creator);
            });
          }
          // Add nested license tag
          // String license uses prefix:license (simple value)
          // Object license uses prefix:license:id (nested structure)
          if (ref.license) {
            if (typeof ref.license === 'string') {
              tags.push(createTag(`${prefix}:license`, ref.license));
            } else if (ref.license.id) {
              tags.push(createTag(`${prefix}:license:id`, ref.license.id));
            }
          }
          // Add Nostr-native a tag if event info is available
          const eventInfo = ref.nostrEvent || options.relatedEvents?.[ref.id];
          if (eventInfo) {
            const aTagValue = `30142:${eventInfo.pubkey}:${eventInfo.dTag}`;
            tags.push(['a', aTagValue, eventInfo.relayHint || '', prefix]);
          }
        });
      };

      addRelationshipTags('hasPart', ambResource.hasPart);
      addRelationshipTags('isPartOf', ambResource.isPartOf);
      addRelationshipTags('isBasedOn', ambResource.isBasedOn);
    }

    // Create the Nostr event
    // Per AMB spec, content SHOULD contain description for client compatibility
    // The description tag is kept for relay queryability
    const event: NostrEducationalEvent = {
      pubkey,
      created_at,
      kind,
      tags,
      content: ambResource.description || '',
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
 * Does NOT bake in honorificPrefix - that is kept as a separate tag for lossless roundtrip
 */
function getPersonOrOrgName(entity: Person | Organization | FundingScheme): string {
  return entity.name;
}

/**
 * Add tags for Person, Organization, or FundingScheme
 */
function addPersonOrOrgTags(
  tags: NostrTag[],
  prefix: string,
  entity: Person | Organization | FundingScheme
): void {
  tags.push(createTag(`${prefix}:name`, getPersonOrOrgName(entity)));
  tags.push(createTag(`${prefix}:type`, entity.type));

  if ('id' in entity && entity.id) {
    tags.push(createTag(`${prefix}:id`, entity.id));
  }

  if ('honorificPrefix' in entity && entity.honorificPrefix) {
    tags.push(createTag(`${prefix}:honorificPrefix`, entity.honorificPrefix));
  }

  if ('honorificSuffix' in entity && entity.honorificSuffix) {
    tags.push(createTag(`${prefix}:honorificSuffix`, entity.honorificSuffix));
  }

  if ('email' in entity && entity.email) {
    tags.push(createTag(`${prefix}:email`, entity.email));
  }

  if ('url' in entity && entity.url) {
    tags.push(createTag(`${prefix}:url`, entity.url));
  }

  if ('affiliation' in entity && entity.affiliation) {
    const affiliation = entity.affiliation;
    if (affiliation.name) {
      tags.push(createTag(`${prefix}:affiliation:name`, affiliation.name));
    }
    if (affiliation.type) {
      tags.push(createTag(`${prefix}:affiliation:type`, affiliation.type));
    }
    if (affiliation.id) {
      tags.push(createTag(`${prefix}:affiliation:id`, affiliation.id));
    }
    if (affiliation.url) {
      tags.push(createTag(`${prefix}:affiliation:url`, affiliation.url));
    }
    if (affiliation.email) {
      tags.push(createTag(`${prefix}:affiliation:email`, affiliation.email));
    }
  }
}

/**
 * Add tags for MediaObject
 */
function addMediaObjectTags(
  tags: NostrTag[],
  prefix: string,
  media: MediaObject
): void {
  if (media.id) {
    tags.push(createTag(`${prefix}:id`, media.id));
  }
  if (media.type) {
    tags.push(createTag(`${prefix}:type`, media.type));
  }
  if (media.contentUrl) {
    tags.push(createTag(`${prefix}:contentUrl`, media.contentUrl));
  }
  if (media.embedUrl) {
    tags.push(createTag(`${prefix}:embedUrl`, media.embedUrl));
  }
  if (media.encodingFormat) {
    tags.push(createTag(`${prefix}:encodingFormat`, media.encodingFormat));
  }
  if (media.sha256) {
    tags.push(createTag(`${prefix}:sha256`, media.sha256));
  }
  if (media.inLanguage) {
    tags.push(createTag(`${prefix}:inLanguage`, media.inLanguage));
  }
  if (media.contentSize) {
    tags.push(createTag(`${prefix}:contentSize`, media.contentSize));
  }
  if (media.bitrate) {
    tags.push(createTag(`${prefix}:bitrate`, media.bitrate));
  }
}

/**
 * Add tags for Concept
 */
function addConceptTags(
  tags: NostrTag[],
  prefix: string,
  concept: Concept
): void {
  if (concept.id) {
    tags.push(createTag(`${prefix}:id`, concept.id));
  }
  if (concept.prefLabel) {
    Object.entries(concept.prefLabel).forEach(([lang, label]) => {
      tags.push(createTag(`${prefix}:prefLabel:${lang}`, label));
    });
  }
  if (concept.type) {
    tags.push(createTag(`${prefix}:type`, concept.type));
  }
}
