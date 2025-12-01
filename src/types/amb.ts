/**
 * AMB (Advanced Metadata for Learning Resources) Type Definitions
 * Based on https://w3id.org/kim/amb/
 */

/**
 * JSON-LD Context
 */
export interface AmbContext {
  '@context': Array<string | { '@language'?: string; [key: string]: any }>;
}

/**
 * Localized string for multilingual support
 */
export interface LocalizedString {
  [languageCode: string]: string;
}

/**
 * Concept with identifier and label (used for controlled vocabularies)
 */
export interface Concept {
  id: string;
  type?: 'Concept';
  prefLabel?: LocalizedString;
}

/**
 * Person entity (creator, contributor, etc.)
 */
export interface Person {
  id?: string;
  type: 'Person';
  name: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  email?: string;
  affiliation?: Organization;
}

/**
 * Organization entity (publisher, provider, etc.)
 */
export interface Organization {
  id?: string;
  type: 'Organization';
  name: string;
  url?: string;
  email?: string;
}

/**
 * License information
 */
export interface License {
  id: string;
  type?: string;
  name?: string;
}

/**
 * Base interface for all AMB learning resources
 */
export interface AmbLearningResourceBase extends AmbContext {
  id: string;
  type: string[];
  name: string;
  creator?: Array<Person | Organization>;
  description?: string;
  keywords?: string[];
  about?: Concept[];
  
  // Access and licensing
  isAccessibleForFree?: boolean;
  conditionsOfAccess?: Concept;
  license?: License;
  
  // Language and localization
  inLanguage?: string[];
  
  // Educational metadata
  learningResourceType?: Concept[];
  audience?: Concept[];
  educationalLevel?: Concept[];
  
  // Temporal information
  dateCreated?: string;
  datePublished?: string;
  dateModified?: string;
  
  // Publishing information
  publisher?: Array<Person | Organization>;
  
  // Media
  image?: string;
  
  // Relationships
  hasPart?: AmbLearningResourceReference[];
  isPartOf?: AmbLearningResourceReference[];
  isBasedOn?: AmbLearningResourceReference[];
}

/**
 * Reference to another learning resource (lightweight)
 */
export interface AmbLearningResourceReference {
  id: string;
  type?: string[];
  name?: string;
  creator?: Array<Person | Organization>;
  license?: License;
}

/**
 * Course type
 */
export interface AmbCourse extends AmbLearningResourceBase {
  type: ['LearningResource', 'Course'];
}

/**
 * Presentation/Slide type
 */
export interface AmbPresentation extends AmbLearningResourceBase {
  type: ['LearningResource', 'PresentationDigitalDocument'];
}

/**
 * Image type
 */
export interface AmbImage extends AmbLearningResourceBase {
  type: ['LearningResource', 'ImageObject'];
}

/**
 * Worksheet type
 */
export interface AmbWorksheet extends AmbLearningResourceBase {
  type: ['LearningResource'];
}

/**
 * Video type
 */
export interface AmbVideo extends AmbLearningResourceBase {
  type: ['LearningResource', 'VideoObject'];
}

/**
 * Union type for all AMB learning resources
 */
export type AmbLearningResource = 
  | AmbCourse 
  | AmbPresentation 
  | AmbImage 
  | AmbWorksheet 
  | AmbVideo
  | AmbLearningResourceBase;

/**
 * Type guard to check if an object is an AMB learning resource
 */
export function isAmbLearningResource(obj: any): obj is AmbLearningResource {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    Array.isArray(obj.type) &&
    obj.type.includes('LearningResource') &&
    typeof obj.name === 'string'
  );
}

/**
 * Extract the primary resource type from the type array
 */
export function getResourceType(resource: AmbLearningResource): string {
  const types = resource.type.filter(t => t !== 'LearningResource');
  return types.length > 0 && types[0] ? types[0] : 'LearningResource';
}

/**
 * Check if resource is a specific type
 */
export function isResourceType(
  resource: AmbLearningResource,
  type: string
): boolean {
  return (resource.type as string[]).includes(type);
}