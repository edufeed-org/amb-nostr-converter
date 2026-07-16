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

For the latest development build (published on every push to main):
```bash
npm install amb-nostr-converter@dev --registry=https://git.edufeed.org/api/packages/edufeed/npm/
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

### Creator identities (Nostr-native vs. external)

Per [NIP-AMB](https://git.edufeed.org/edufeed/nips/src/branch/edufeed-amb/AMB.md), each creator/contributor gets exactly one representation in the event — never both:

- **Nostr identity**: set the person's `id` to a `nostr:npub…` or `nostr:nprofile…` URI ([NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md)). `ambToNostr` decodes it and emits a `["p", <pubkey-hex>, <relay-hint>, "creator"|"contributor"]` tag; no flattened `creator:*` tags are written for that person. Relay hint precedence: nprofile-embedded relay → `defaultRelayHint` option → empty. (The legacy `nostrPubkey` field still works but is deprecated.)
- **External identity**: any other `id` (e.g. an ORCID URL) — or no `id` — produces flattened `creator:name`/`creator:type`/`creator:id`/… tags.

```typescript
const resource: AmbLearningResource = {
  // ...
  "creator": [
    { "type": "Person", "name": "Jane Smith", "id": "nostr:npub1..." },          // → p tag
    { "type": "Person", "name": "John Doe", "id": "https://orcid.org/0000-..." } // → creator:* tags
  ],
};
```

On reverse conversion, `nostrToAmb` maps each creator/contributor `p` tag to `{ name, type: "Person", id: "nostr:<nprofile>" }`. Because the AMB schema requires `name` and the base converter is offline, `name` falls back to the npub encoding; use `nostrToAmbWithProfiles` to resolve real names from kind:0 profiles (it replaces the npub fallback).

For events whose `d` tag is not an absolute URI (e.g. a slug), `nostrToAmb` derives the AMB `id` as `nostr:<naddr>` from the event's kind, pubkey, and `d` value.

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

When converting multiple events, each event gets an incrementing `created_at` timestamp (base time + 1 second per event). This ensures relay clients that use cursor-based pagination on `created_at` can load all events correctly.

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

- [AMB Sitemap Parser](https://git.edufeed.org/edufeed/amb-sitemap-parser) - Parse sitemaps and extract AMB educational metadata from web pages
- [AMB Specification](https://w3id.org/kim/amb/) - General Metadata Profile for Learning Resources
- [AMB-NIP (kind 30142)](https://github.com/edufeed-org/nips/blob/edufeed-amb/edufeed.md) - Nostr event spec for AMB
- [Nostr Protocol](https://github.com/nostr-protocol/nostr) - Notes and Other Stuff Transmitted by Relays
