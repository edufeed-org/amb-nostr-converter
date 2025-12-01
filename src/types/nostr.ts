/**
 * Nostr Protocol Type Definitions for Educational Content
 * Based on NIP-01 and educational event extensions
 */

/**
 * Nostr event structure (NIP-01)
 */
export interface NostrEvent {
  id?: string;           // 32-bytes lowercase hex-encoded sha256 of the serialized event data
  pubkey: string;        // 32-bytes lowercase hex-encoded public key of the event creator
  created_at: number;    // Unix timestamp in seconds
  kind: number;          // Integer event kind
  tags: string[][];      // Array of tag arrays
  content: string;       // Arbitrary string (can be empty)
  sig?: string;          // 64-bytes hex of the signature of the sha256 hash of the serialized event data
}

/**
 * Nostr event kind for AMB educational content
 * Reference: Edufeed AMB-NIP specification
 * All AMB resources use kind 30142 (replaceable event)
 */
export enum NostrEducationalKind {
  AMB = 30142,  // AMB Metadata Event (replaceable, addressable via kind:pubkey:d-tag)
}

/**
 * Standard Nostr tag types
 */
export type NostrTagType =
  | 'e'           // Event reference
  | 'p'           // Pubkey reference
  | 'a'           // Address reference (NIP-33)
  | 'd'           // Identifier (for replaceable events)
  | 't'           // Hashtag
  | 'r'           // URL reference
  | 'i'           // External identity
  | 'title'       // Content title
  | 'summary'     // Content summary
  | 'published_at'// Publication timestamp
  | 'image'       // Image URL
  | 'alt'         // Alternative description
  | string;       // Custom tags

/**
 * Educational-specific tag types (AMB-NIP compliant)
 * Tags use colon-delimited flattening for nested structures
 * Examples: 'creator:id', 'creator:name', 'creator:affiliation:name'
 */
export type EducationalTagType =
  // Core AMB fields
  | 'type'                        // Resource type (e.g., "LearningResource", "Course")
  | 'name'                        // Resource name/title
  | 'description'                 // Resource description
  | 'inLanguage'                  // Language code (e.g., "en", "de")
  | 'image'                       // Image URL
  
  // Educational metadata (with colon-delimited nesting)
  | 'about:id'                    // Subject/discipline ID
  | 'about:prefLabel'             // Subject/discipline label
  | 'about:type'                  // Concept type
  | 'about:inLanguage'            // Subject label language
  | 'learningResourceType:id'     // Learning resource type ID
  | 'learningResourceType:prefLabel' // Learning resource type label
  | 'learningResourceType:type'   // Concept type
  | 'learningResourceType:inLanguage' // Type label language
  | 'audience:id'                 // Target audience ID
  | 'audience:prefLabel'          // Target audience label
  | 'audience:type'               // Concept type
  | 'audience:inLanguage'         // Audience label language
  | 'educationalLevel:id'         // Educational level ID
  | 'educationalLevel:prefLabel'  // Educational level label
  | 'educationalLevel:type'       // Concept type
  | 'educationalLevel:inLanguage' // Level label language
  
  // Creator/Contributor (with colon-delimited nesting)
  | 'creator:id'                  // Creator ID (e.g., ORCID, GND)
  | 'creator:name'                // Creator name
  | 'creator:type'                // "Person" or "Organization"
  | 'creator:honorificPrefix'     // Title/prefix (Dr., Prof., etc.)
  | 'creator:affiliation:id'      // Affiliation ID
  | 'creator:affiliation:name'    // Affiliation name
  | 'creator:affiliation:type'    // "Organization"
  | 'contributor:id'              // Contributor ID
  | 'contributor:name'            // Contributor name
  | 'contributor:type'            // "Person" or "Organization"
  | 'contributor:honorificPrefix' // Title/prefix
  | 'contributor:affiliation:id'  // Affiliation ID
  | 'contributor:affiliation:name' // Affiliation name
  | 'contributor:affiliation:type' // "Organization"
  
  // Publisher/Funder
  | 'publisher:id'                // Publisher ID
  | 'publisher:name'              // Publisher name
  | 'publisher:type'              // "Organization" or "Person"
  | 'funder:id'                   // Funder ID
  | 'funder:name'                 // Funder name
  | 'funder:type'                 // "Person", "Organization", or "FundingScheme"
  
  // Licensing and Access
  | 'license:id'                  // License URI
  | 'isAccessibleForFree'         // "true" or "false"
  | 'conditionsOfAccess:id'       // Conditions of access URI
  | 'conditionsOfAccess:prefLabel' // Conditions label
  | 'conditionsOfAccess:type'     // "Concept"
  | 'conditionsOfAccess:inLanguage' // Conditions label language
  
  // Temporal data
  | 'dateCreated'                 // ISO8601 date
  | 'datePublished'               // ISO8601 date
  | 'dateModified'                // ISO8601 date
  
  // Relationships (with colon-delimited nesting)
  | 'isBasedOn:id'                // Source/attribution ID
  | 'isBasedOn:name'              // Source name
  | 'isPartOf:id'                 // Parent resource ID
  | 'isPartOf:name'               // Parent resource name
  | 'isPartOf:type'               // Parent resource type
  | 'hasPart:id'                  // Child resource ID
  | 'hasPart:name'                // Child resource name
  | 'hasPart:type'                // Child resource type
  
  // Technical
  | 'duration'                    // ISO8601 duration
  | 'encoding:type'               // MediaObject
  | 'encoding:contentUrl'         // Media URL
  | 'encoding:embedUrl'           // Embed URL
  | 'encoding:encodingFormat'     // IANA media type
  | 'encoding:contentSize'        // Size in bytes
  | 'encoding:sha256'             // SHA256 hash
  | 'encoding:bitrate'            // Bitrate in kbps
  
  // Meta-metadata
  | 'mainEntityOfPage:id'         // WebPage ID
  | 'mainEntityOfPage:type'       // "WebContent"
  | 'mainEntityOfPage:provider:id' // Provider ID
  | 'mainEntityOfPage:provider:name' // Provider name
  | 'mainEntityOfPage:provider:type' // Provider type
  | 'mainEntityOfPage:dateCreated' // Page creation date
  | 'mainEntityOfPage:dateModified'; // Page modification date

/**
 * Tag builder helpers
 */
export type NostrTag = [NostrTagType | EducationalTagType, ...string[]];

/**
 * Educational Nostr event with typed tags
 */
export interface NostrEducationalEvent extends NostrEvent {
  kind: NostrEducationalKind;
  tags: NostrTag[];
}

/**
 * Helper to create a tag
 */
export function createTag(
  type: NostrTagType | EducationalTagType,
  ...values: string[]
): NostrTag {
  return [type, ...values];
}

/**
 * Helper to find tags by type
 */
export function findTags(
  event: NostrEvent,
  tagType: NostrTagType | EducationalTagType
): NostrTag[] {
  return event.tags.filter(tag => tag[0] === tagType) as NostrTag[];
}

/**
 * Helper to get first tag value
 */
export function getTagValue(
  event: NostrEvent,
  tagType: NostrTagType | EducationalTagType
): string | undefined {
  const tag = event.tags.find(tag => tag[0] === tagType);
  return tag ? tag[1] : undefined;
}

/**
 * Helper to get all values for a tag type
 */
export function getTagValues(
  event: NostrEvent,
  tagType: NostrTagType | EducationalTagType
): string[] {
  return event.tags
    .filter(tag => tag[0] === tagType)
    .map(tag => tag[1])
    .filter((value): value is string => value !== undefined);
}

/**
 * Content structure for educational events (stored in content field as JSON)
 */
export interface NostrEducationalContent {
  title: string;
  description: string | undefined;
  body?: string;              // Main content (markdown, HTML, etc.)
  metadata?: {
    [key: string]: any;       // Additional educational metadata
  };
}

/**
 * Validate basic Nostr event structure
 */
export function isValidNostrEvent(obj: any): obj is NostrEvent {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.pubkey === 'string' &&
    obj.pubkey.length === 64 &&
    typeof obj.created_at === 'number' &&
    typeof obj.kind === 'number' &&
    Array.isArray(obj.tags) &&
    typeof obj.content === 'string'
  );
}

/**
 * Check if event is an educational event
 */
export function isEducationalEvent(event: NostrEvent): event is NostrEducationalEvent {
  return (
    isValidNostrEvent(event) &&
    Object.values(NostrEducationalKind).includes(event.kind)
  );
}

/**
 * Get resource type from Nostr event
 */
export function getNostrResourceType(event: NostrEducationalEvent): string | undefined {
  return getTagValue(event, 'resource_type');
}
