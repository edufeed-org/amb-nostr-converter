# AMB-Nostr Converter

A TypeScript library for converting between AMB ("Allgemeines Metadatenprofil für Bildungsressourcen" - General Metadata Profile for Learning Resources) and Nostr educational events ([`kind:30142`](https://github.com/edufeed-org/nips/blob/edufeed-amb/edufeed.md)).

## Overview

Bidirectional conversion between:
- **AMB**: JSON-LD based metadata format for educational resources (used by European OER initiatives)
- **Nostr**: Decentralized protocol for social media and content distribution

Usable as a library or CLI tool.

## Installation

```bash
npm install amb-nostr-converter --registry=https://git.edufeed.org/api/packages/edufeed/npm/
```

Or add to your `.npmrc`:
```
registry=https://git.edufeed.org/api/packages/edufeed/npm/
```

## Quick Start

### As a Library

```typescript
import { ambToNostr, nostrToAmb, AmbLearningResource } from 'amb-nostr-converter';

const resource: AmbLearningResource = {
  "@context": ["https://w3id.org/kim/amb/context.jsonld"],
  "id": "https://example.org/course123",
  "type": ["LearningResource", "Course"],
  "name": "Introduction to TypeScript",
  "creator": [{ "type": "Person", "name": "Jane Smith" }],
  "description": "Learn TypeScript fundamentals",
  "keywords": ["TypeScript", "Programming"],
  "license": { "id": "https://creativecommons.org/licenses/by-sa/4.0/" }
};

// Convert to Nostr event
const result = ambToNostr(resource, { pubkey: 'your-nostr-public-key-hex' });

if (result.success) {
  console.log('Nostr Event:', result.data);

  // Convert back to AMB
  const ambResult = nostrToAmb(result.data!);
}
```

### As a CLI Tool

```bash
# AMB → Nostr
amb-convert amb:nostr course.json -o event.json

# Nostr → AMB
amb-convert nostr:amb event.json -o recovered.json

# Pretty-print and pipe
amb-convert amb:nostr course.json -p | jq .tags

# Sign events with private key
amb-convert amb:nostr course.json --nsec nsec1...

# Batch convert JSONL
amb-convert amb:nostr resources.jsonl --nsec $NOSTR_NSEC -o events.jsonl
```

## CLI Reference

| Option | Description | Direction |
|--------|-------------|-----------|
| `<direction>` | `amb:nostr` or `nostr:amb` | Required |
| `[input]` | Input file path (omit for stdin) | Both |
| `-o, --output <file>` | Output file path (omit for stdout) | Both |
| `-p, --pretty` | Pretty-print JSON | Both |
| `--tags` | Output only tags array | AMB→Nostr |
| `--nsec <key>` | Sign with private key (nsec or hex) | AMB→Nostr |
| `--private-key <key>` | Sign with private key (hex or nsec) | AMB→Nostr |

### Batch Processing (JSONL)

JSONL input (one JSON object per line) is auto-detected. Errors on individual lines are reported with line numbers and don't stop processing of remaining lines.

```bash
cat resources.jsonl | amb-convert amb:nostr --nsec $NOSTR_NSEC -o events.jsonl
```

### Event Signing

When `--nsec` or `--private-key` is provided (both accept nsec1 or hex format):
- Public key is automatically derived
- Event ID and Schnorr signature are generated
- Output includes `id`, `sig`, and correct `pubkey` fields

## Development

```bash
npm install
npm run build
npm test
```

## Related Projects

- [AMB Specification](https://w3id.org/kim/amb/) - General Metadata Profile for Learning Resources
- [AMB-NIP (kind 30142)](https://github.com/edufeed-org/nips/blob/edufeed-amb/edufeed.md) - Nostr event spec for AMB
- [Nostr Protocol](https://github.com/nostr-protocol/nostr) - Notes and Other Stuff Transmitted by Relays
