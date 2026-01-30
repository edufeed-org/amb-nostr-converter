# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build          # Full build (clean, compile, generate types, chmod CLI)
npm test               # Run all tests once
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report

# Run a single test file
npx vitest run tests/converters/ambToNostr.test.ts
npx vitest run tests/converters/nostrToAmb.test.ts

# CLI testing (after build)
npm link && amb-convert amb:nostr tests/data/amb/example_1_course.json -p
npm unlink -g amb-nostr-converter
```

## Architecture Overview

This library provides **bidirectional conversion** between AMB (educational metadata JSON-LD standard) and Nostr events (kind 30142).

### Core Flow

```
AMB (JSON-LD)  ──ambToNostr()──►  Nostr Event (kind 30142)
                                        │
                                        │ content: "" (always empty)
                                        │ tags: [...flattened metadata]
                                        ▼
Nostr Event   ──nostrToAmb()──►  AMB (JSON-LD)
```

### Critical Spec Requirement

All metadata is encoded in tags using colon-delimited flattening. This is per the [AMB-NIP spec](https://github.com/edufeed-org/nips/blob/edufeed-amb/edufeed.md).

### Tag Flattening Pattern

Nested AMB structures are flattened into tags with colon delimiters:

```typescript
// AMB input
{ creator: [{ name: "Jane", type: "Person", affiliation: { name: "MIT" }}] }

// Nostr tags output
["creator:name", "Jane"]
["creator:type", "Person"]
["creator:affiliation:name", "MIT"]
```

Special mappings:
- `d` tag ← AMB `id` (event identifier)
- `t` tags ← AMB `keywords` (Nostr-native hashtags)
- Language-tagged labels: `about:prefLabel:en`, `about:prefLabel:de`

### Key Files

- `src/converters/ambToNostr.ts` - AMB→Nostr: flattens nested structures into tags
- `src/converters/nostrToAmb.ts` - Nostr→AMB: reconstructs nested objects from tags using boundary detection
- `src/types/amb.ts` - AMB type definitions (Person, Organization, Concept, etc.)
- `src/types/nostr.ts` - Nostr event types and tag helpers
- `src/cli/index.ts` - CLI tool supporting both directions, signing, tags-only output

### Boundary Detection (nostrToAmb)

When reconstructing arrays of objects from flat tags, the converter uses a two-tier boundary detection algorithm:

1. **Primary**: `id` property signals a new object (semantic boundary)
2. **Fallback**: Property collision (same property appears again)

Original tag order must be preserved for correct reconstruction.

## Project Documentation

The `memory-bank/` folder contains project documentation:
- `projectbrief.md` - Core requirements
- `activeContext.md` - Current work focus and recent changes
- `progress.md` - What works, what's left, milestones
- `techContext.md` - Technology stack and constraints
- `systemPatterns.md` - Architecture and design patterns

## External Specifications

- AMB spec: https://dini-ag-kim.github.io/amb/latest/
- AMB-NIP (kind 30142): https://github.com/edufeed-org/nips/blob/edufeed-amb/edufeed.md
