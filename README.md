# AMB-Nostr Converter

A TypeScript library for converting between AMB ("Allgemeines Metadatenprofil für Bildungsressourcen" - General Metadata Profile for Learning Resources) and Nostr educational events ([`kind:30142`](https://github.com/edufeed-org/nips/blob/edufeed-amb/edufeed.md)).

## Overview

This library enables bidirectional conversion between:
- **AMB**: JSON-LD based metadata format for educational resources (used by European OER initiatives)
- **Nostr**: Decentralized protocol for social media and content distribution

You can use it as a library or a CLI-Tool

## Installation

### From GitHub Packages

This package is published to GitHub Packages and requires authentication:

```bash
npm install @edufeed-org/amb-nostr-converter --registry https://npm.pkg.github.com/edufeed-org
```

**Authentication Setup:**
You'll need a GitHub Personal Access Token (PAT) with `read:packages` scope. Set it in your `.npmrc`:

```
registry=https://npm.pkg.github.com/edufeed-org
//npm.pkg.github.com/:_authToken=YOUR_PAT_HERE
```

Or authenticate with npm login:
```bash
npm login --registry https://npm.pkg.github.com/edufeed-org
```

## Quick Start

### As a Library

```typescript
import { ambToNostr, AmbLearningResource } from 'amb-nostr-converter';

// Your AMB learning resource
const resource: AmbLearningResource = {
  "@context": ["https://w3id.org/kim/amb/context.jsonld"],
  "id": "https://example.org/course123",
  "type": ["LearningResource", "Course"],
  "name": "Introduction to TypeScript",
  "creator": [{
    "type": "Person",
    "name": "Jane Smith"
  }],
  "description": "Learn TypeScript fundamentals",
  "keywords": ["TypeScript", "Programming"],
  "license": {
    "id": "https://creativecommons.org/licenses/by-sa/4.0/"
  }
};

// Convert to Nostr event
const result = ambToNostr(resource, {
  pubkey: 'your-nostr-public-key-hex'
});

if (result.success) {
  console.log('Nostr Event:', result.data);
  // Publish to Nostr relays...
}
```

### As a CLI Tool

After installation, you can use the `amb-convert` command directly if installed globally, or via `npx` if installed locally:

**Convert AMB to Nostr:**
```bash
# Using npx (works with local or global installation)
npx amb-convert amb:nostr your_course.json -o nostr_event.json

# Or directly if installed globally (-g flag)
amb-convert amb:nostr your_course.json -o nostr_event.json
```

**Convert Nostr back to AMB:**
```bash
npx amb-convert nostr:amb nostr_event.json -o recovered_amb.json
```

**Pretty-print output and chain with other tools:**
```bash
npx amb-convert amb:nostr course.json -p | jq .tags
```

**Get help:**
```bash
npx amb-convert --help
```

## CLI Reference

### Bidirectional Conversion

The CLI supports both conversion directions:

#### AMB to Nostr (amb:nostr)
Convert AMB metadata to Nostr events:
```bash
amb-convert amb:nostr input.json
```

#### Nostr to AMB (nostr:amb)
Convert Nostr events back to AMB metadata:
```bash
amb-convert nostr:amb event.json
```

**Example workflow:**
```bash
# Convert AMB to Nostr
amb-convert amb:nostr course.json -o event.json

# Convert back to AMB
amb-convert nostr:amb event.json -o recovered_amb.json
```

### Event Signing (AMB→Nostr only)

Sign Nostr events with your private key to create valid, publishable events.

**Using nsec (bech32 format):**
```bash
amb-convert amb:nostr input.json --nsec nsec1...
```

**Using hex private key:**
```bash
amb-convert amb:nostr input.json --private-key <64-char-hex>
```

When signing is enabled:
- Public key is automatically derived from the private key
- Event ID is calculated (SHA-256 hash of serialized event)
- Event signature is generated (Schnorr signature)
- Output includes `id`, `sig`, and correct `pubkey` fields

**Example signed event output:**
```json
{
  "id": "4ed5fe7bfa3eed0a2f8b6f98cd9a4fcf432f862b17cb50df2a4a5b99375fc101",
  "pubkey": "7e80f997debb47ba8e7dac109a4f783283f752ff6fec5eabf37621f8e9ee4e3a",
  "created_at": 1763643111,
  "kind": 30142,
  "tags": [...],
  "content": "",
  "sig": "abc123..."
}
```

### Tags-Only Output (AMB→Nostr only)

Output only the tags array from the conversion, useful for debugging or when you only need the tag structure:

```bash
amb-convert amb:nostr input.json --tags
```

**Example output:**
```json
[
  ["d", "https://example.org/resource"],
  ["name", "My Resource"],
  ["type", "LearningResource"],
  ["t", "education"]
]
```

### CLI Options

| Option | Description | Applies To | Example |
|--------|-------------|------------|---------|
| `<direction>` | Conversion direction: `amb:nostr` or `nostr:amb` | Required | `amb:nostr` |
| `[input]` | Input file path (omit to read from stdin) | Both | `input.json` |
| `-o, --output <file>` | Output file path (omit to write to stdout) | Both | `-o output.json` |
| `-p, --pretty` | Pretty-print JSON | Both | `--pretty` |
| `--tags` | Output only tags array | AMB→Nostr only | `--tags` |
| `--nsec <key>` | Sign with nsec private key | AMB→Nostr only | `--nsec nsec1...` |
| `--private-key <key>` | Sign with hex private key | AMB→Nostr only | `--private-key abc123...` |
| `-V, --version` | Display version number | Both | `-V` |
| `-h, --help` | Display help information | Both | `-h` |

### CLI Examples

```bash
# Convert multiple files
for file in *.json; do
  amb-convert amb:nostr "$file" -o "nostr_${file}"
done

# Read from stdin, write to stdout
cat input.json | amb-convert amb:nostr > output.json

# Quick validation and conversion
amb-convert amb:nostr course.json -p | jq .

# Extract specific fields after conversion
amb-convert amb:nostr input.json | jq '.tags[] | select(.[0] == "title")'

# Sign and publish
amb-convert amb:nostr input.json --nsec $NOSTR_NSEC -o signed_event.json
```

### CLI Notes

**General:**
- Both conversion directions are fully supported
- Input can be from file or stdin
- Output can be to file or stdout
- Use `--pretty` for human-readable JSON output

**AMB→Nostr Specific:**
- `--nsec` and `--private-key` are mutually exclusive
- When signing, the public key is automatically derived from the private key
- Unsigned events use a default pubkey (all zeros) for testing/development
- All events use kind 30142 (AMB Metadata Event) per specification
- Use `--tags` to output only the tags array for debugging

**Nostr→AMB Specific:**
- Converts kind 30142 events back to AMB metadata format
- `--tags`, `--nsec`, and `--private-key` options are ignored (with warnings)
- Default language context is German (`de`), matching AMB specification

## Library Reference

### Conversion Options

The `ambToNostr` function accepts an optional `ConversionOptions` object:

```typescript
interface ConversionOptions {
  // Pubkey to use for Nostr events (64-char hex string)
  pubkey?: string;
  
  // Whether to include hierarchical relationships (hasPart, isPartOf)
  includeRelationships?: boolean;
  
  // Custom timestamp (defaults to current time)
  timestamp?: number;
  
  // Whether to generate deterministic event IDs based on AMB IDs
  deterministicIds?: boolean;
}
```

**Example with options:**
```typescript
const result = ambToNostr(ambResource, {
  pubkey: 'your-nostr-public-key-hex',
  includeRelationships: true,    // Include hasPart/isPartOf/isBasedOn
  timestamp: 1700000000,         // Custom timestamp
  deterministicIds: true         // Generate deterministic IDs
});
```

### Examples

#### Course with Chapters

```typescript
const course: AmbLearningResource = {
  "@context": ["https://w3id.org/kim/amb/context.jsonld"],
  "id": "https://example.org/advanced-js",
  "type": ["LearningResource", "Course"],
  "name": "Advanced JavaScript",
  "hasPart": [
    {
      "id": "https://example.org/advanced-js/chapter1",
      "type": ["LearningResource", "PresentationDigitalDocument"],
      "name": "Closures and Scope"
    },
    {
      "id": "https://example.org/advanced-js/chapter2",
      "type": ["LearningResource", "PresentationDigitalDocument"],
      "name": "Async Programming"
    }
  ]
};

const result = ambToNostr(course, { 
  pubkey: 'your-key',
  includeRelationships: true  // Important: enables hasPart tags
});
```

#### Image Resource with Attribution

```typescript
const image: AmbLearningResource = {
  "@context": ["https://w3id.org/kim/amb/context.jsonld"],
  "id": "https://example.org/images/diagram.png",
  "type": ["LearningResource", "ImageObject"],
  "name": "System Architecture Diagram",
  "image": "https://example.org/images/diagram.png",
  "isBasedOn": [{
    "id": "https://source.org/original-diagram",
    "name": "Original Diagram",
    "creator": [{ "type": "Person", "name": "John Doe" }],
    "license": { "id": "https://creativecommons.org/licenses/by/4.0/" }
  }]
};

const result = ambToNostr(image, { 
  pubkey: 'your-key',
  includeRelationships: true  // Preserves attribution
});
```


### Error Handling

The converter returns a `ConversionResult` object:

```typescript
interface ConversionResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  warnings?: string[];
}
```

Always check the `success` field:

```typescript
const result = ambToNostr(ambResource, options);

if (result.success) {
  // Use result.data
  const nostrEvent = result.data!;
  
  // Check for warnings
  if (result.warnings) {
    console.warn('Warnings:', result.warnings);
  }
} else {
  // Handle error
  console.error('Error:', result.error?.message);
  
  if (result.error instanceof ConversionError) {
    console.error('Error code:', result.error.code);
    console.error('Details:', result.error.details);
  }
}
```

### Type Guards

Use type guards to validate data:

```typescript
import { 
  isAmbLearningResource,
  isValidNostrEvent,
  isEducationalEvent 
} from 'amb-nostr-converter';

// Check if object is valid AMB resource
if (isAmbLearningResource(data)) {
  const result = ambToNostr(data, options);
}

// Check if object is valid Nostr event
if (isValidNostrEvent(event)) {
  // Process event
}

// Check if event is educational
if (isEducationalEvent(event)) {
  // Process educational event
}
```

### Understanding the Output

The converted Nostr event has this structure:

```typescript
{
  pubkey: "your-nostr-public-key",
  created_at: 1700000000,
  kind: 30142,  // AMB Metadata Event
  tags: [
    ["d", "https://example.org/resource123"],           // Event identifier (AMB ID)
    ["type", "LearningResource"],                       // AMB type
    ["type", "Course"],                                 // AMB type
    ["name", "Introduction to TypeScript"],            // Resource name
    ["description", "Learn TypeScript fundamentals"],  // Resource description
    ["creator:name", "Jane Smith"],                     // Creator name
    ["creator:type", "Person"],                         // Creator type
    ["creator:id", "https://orcid.org/0000-0000-0000-0000"], // Creator ID
    ["license:id", "https://creativecommons.org/licenses/by-sa/4.0/"], // License
    ["t", "typescript"],                                // Keyword/hashtag
    ["t", "programming"],                               // Keyword/hashtag
    ["inLanguage", "en"],                               // Language
    ["about:prefLabel:en", "Computer Science"],         // Subject/discipline
    ["educationalLevel:prefLabel:en", "Bachelor or equivalent"], // Educational level
    ["audience:prefLabel:en", "student"],               // Target audience
  ],
  content: ""
}
```

### AMB Resource Types

All AMB learning resources are converted to Nostr events with `kind: 30142` (AMB Metadata Event), regardless of their specific type. The AMB type information is preserved in the event tags using the `"type"` field.

For example, `learningResourceType` (if present) like:

```json
"learningResourceType": [
  {
    "id": "https://w3id.org/kim/hcrt/image",
    "prefLabel": {
      "en": "Image",
      "de": "Abbildung"
    }
  }
]
```

Gets flattened into these tags:
```json
[
  ["learningResourceType:id", "https://w3id.org/kim/hcrt/image"],
  ["learningResourceType:prefLabel:en", "Image"],
  ["learningResourceType:prefLabel:de", "Abbildung"]
]
```

### Complete Example

```typescript
import { 
  ambToNostr, 
  AmbLearningResource,
  getTagValue,
  getTagValues 
} from 'amb-nostr-converter';
import { readFileSync } from 'fs';

// Load AMB resource from file
const ambData = JSON.parse(
  readFileSync('./resources/course.json', 'utf-8')
);

// Convert to Nostr
const result = ambToNostr(ambData, {
  pubkey: process.env.NOSTR_PUBKEY!,
  includeRelationships: true
});

if (result.success) {
  const event = result.data!;
  
  console.log('Event Kind:', event.kind);
  console.log('Name:', getTagValue(event, 'name'));
  console.log('Keywords:', getTagValues(event, 't'));
  console.log('Creator:', getTagValue(event, 'creator:name'));
  console.log('License:', getTagValue(event, 'license:id'));

  // All metadata is in tags - content is empty per AMB spec
  console.log('Description:', getTagValue(event, 'description'));
  
  // Publish to Nostr relay
  // await publishToRelay(event);
} else {
  console.error('Conversion failed:', result.error);
  process.exit(1);
}
```

## Development

### Setup

```bash
# Clone and install
npm install

# Build the project
npm run build
```

### Testing

#### Unit Tests
```bash
npm test                # Run all tests once
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Get coverage report
```

#### Local CLI Testing

**npm link**
```bash
npm run build
npm link                # Create global symlink
amb-convert amb:nostr tests/data/amb/example_1_course.json --output /tmp/output.json
npm unlink -g amb-nostr-converter  # When done
```

## Related Projects

- [AMB Specification](https://w3id.org/kim/amb/) - Advanced Metadata for Learning Resources
- [Nostr Protocol](https://github.com/nostr-protocol/nostr) - Notes and Other Stuff Transmitted by Relays
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) - Tools for developing Nostr clients

---

Made with ❤️ for the open educational resources community
