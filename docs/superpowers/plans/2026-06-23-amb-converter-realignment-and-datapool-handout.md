# AMB Converter Re-alignment + Data-Pool Handout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `amb-nostr-converter` back into line with current NIP-AMB (ext namespace, p/a/content/r handling) and ship a live in-browser data-pool handout for an integrating partner.

**Architecture:** Phase 1 documents the drift (audit). Phase 2 fixes the converter test-first, mirroring `edufeed-app`'s compliant `parseExtensionTags` prefix rule (`ext:`/`ekw:` = extension, everything else AMB-core) and adding Nostr-native `p`/`a` reverse mapping. Phase 3 builds a self-contained static HTML page in `edufeed-examples` powered by an esbuild browser bundle of the converter.

**Tech Stack:** TypeScript, Vitest (globals: `describe`/`test`/`beforeAll`), `nostr-tools@^1.17` (`nip19`), esbuild (new devDep), plain HTML/CSS/JS for the handout.

## Global Constraints

- Spec reference: `https://git.edufeed.org/edufeed/nips/src/branch/edufeed-amb/AMB.md`.
- Compliant reference implementation to mirror: `edufeed-app/src/lib/helpers/educational/parseExtensionTags.js` and `formDataToEkwTags.js`.
- Extension classification rule (verbatim): a tag is an extension **iff** its key starts with `ext:` or `ekw:`; all other colon-delimited keys are AMB-core.
- ext tag shape: `ext:<ns>:<facet>:<sub>` where `<sub>` ∈ {`id`, `type`, `prefLabel:<lang>`, none}. `<ns>` MAY contain colons (form-emitted ns is `30168:<pub>:<d>`).
- Emission order per concept (forward): `id`, then `prefLabel:<lang>`(s), then `type`. Reverse boundary = repeated `id`.
- `p` reverse: `["p", <pub>, <hint>, <role>]`, role ∈ {`creator`,`contributor`} → `{ id: "nostr:<nprofile>", type: "Person" }`.
- `a` reverse: `["a", "30142:<pub>:<d>", <hint>, <role>]`, role ∈ {`isBasedOn`,`isPartOf`,`hasPart`} → `{ id: "nostr:<naddr>", type: "LearningResource" }`. Role `form` and unknown roles are ignored.
- `content` (non-empty) is the preferred source for `description`.
- `r` tags are excluded from AMB output.
- Two repos: converter at `/home/laoc/coding/edufeed/amb-nostr-converter`, handout at `/home/laoc/coding/edufeed/edufeed-examples`. Commit in the repo each task touches.
- Run converter tests with `npm test` (vitest) from the converter repo root.

---

### Task 1: Compliance Audit document

**Files:**
- Create: `amb-nostr-converter/docs/COMPLIANCE-AUDIT-2026-06-23.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a checklist consumed by humans; no code interface.

Doc-only task (no test cycle).

- [ ] **Step 1: Write the audit**

Create `docs/COMPLIANCE-AUDIT-2026-06-23.md` with these sections:

1. **Headline:** "edufeed-app is spec-compliant; the standalone `amb-nostr-converter` library has drifted. A consumer using the library to reconstruct JSON silently loses extension data."
2. **Reference:** link AMB.md and name `edufeed-app/.../parseExtensionTags.js` + `formDataToEkwTags.js` as the compliant behavior.
3. **Drift table** — one row each, with current file:line and the required behavior:
   - C1 `ext:` namespace unhandled both directions (`nostrToAmb.ts` only special-cases `d`/`t`; `ambToNostr.ts` has no `ext` emission).
   - C2 `nostrToAmb.ts` ignores `p` tags → must map to creator/contributor `{ id: "nostr:<nprofile>", type: "Person" }`.
   - C3 `nostrToAmb.ts` ignores `a` tags → must map to relation `{ id: "nostr:<naddr>", type: "LearningResource" }` bucketed by role; role `form` ignored.
   - C4 `nostrToAmb.ts` never reads `event.content` → must prefer non-empty `content` for `description`.
   - C5 `r` tags fold into output as an `r` property (via generic unflatten) → must be excluded.
   - C6 form-emitted ext (`ext:30168:<pub>:<d>:…`) unmodeled → must reconstruct with ns = `30168:<pub>:<d>`.
   - C7 `ambToNostr.ts` emits no `ext` (no input field) → must emit symmetric `ext:` tags from a new `ext` input field.
4. **Known lossiness (document, don't fix):** `p`/`a` reverse produces `nostr:<nprofile>`/`<naddr>` ids that do not round-trip back to bare pubkeys without decoding; `name` for `p`-tag persons requires a kind:0 fetch, which is out of scope for an offline converter. Tests assert the spec-defined reverse shape, not bit-exact re-encoding.
5. **Remediation:** point to this plan's Tasks 2–7.

- [ ] **Step 2: Commit**

```bash
cd /home/laoc/coding/edufeed/amb-nostr-converter
git add docs/COMPLIANCE-AUDIT-2026-06-23.md
git commit -m "docs: compliance audit of amb-nostr-converter vs NIP-AMB"
```

---

### Task 2: Add `ext` field to AMB types

**Files:**
- Modify: `src/types/amb.ts` (add `ExtFacet` type + `ext?` on `AmbLearningResourceBase`)

**Interfaces:**
- Produces: `AmbLearningResourceBase.ext?: Record<string, Record<string, ExtFacet>>` where `export type ExtFacet = Concept[] | string[];`. Used by Tasks 3 (forward) and 4 (reverse).

- [ ] **Step 1: Add the type and field**

In `src/types/amb.ts`, after the `Concept` interface (around line 27) add:

```typescript
/**
 * An extension facet value: either controlled-vocabulary concepts or bare scalars.
 */
export type ExtFacet = Concept[] | string[];
```

In `AmbLearningResourceBase` (after `mainEntityOfPage?` around line 144) add:

```typescript
  // Extension properties (ext namespace). Shape: ext[ns][facet] = Concept[] | string[]
  ext?: Record<string, Record<string, ExtFacet>>;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/laoc/coding/edufeed/amb-nostr-converter && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/amb.ts
git commit -m "feat(types): add ext field to AmbLearningResource"
```

---

### Task 3: Forward — emit `ext:` tags from `resource.ext` (C7)

**Files:**
- Modify: `src/converters/ambToNostr.ts`
- Test: `tests/converters/ambToNostr.test.ts`

**Interfaces:**
- Consumes: `AmbLearningResourceBase.ext` (Task 2).
- Produces: `ext:<ns>:<facet>:id|prefLabel:<lang>|type` tags (concept facets) or bare `ext:<ns>:<facet>` tags (scalar facets) in the event.

- [ ] **Step 1: Write the failing test**

Append to `tests/converters/ambToNostr.test.ts`:

```typescript
describe('ext namespace emission', () => {
  test('emits concept ext tags in id, prefLabel, type order', () => {
    const resource: any = {
      '@context': ['https://w3id.org/kim/amb/context.jsonld'],
      id: 'https://example.org/r1',
      type: ['LearningResource'],
      name: 'Test',
      ext: {
        ekw: {
          gradeLevel: [
            { id: 'https://example.org/grade/5', type: 'Concept', prefLabel: { de: 'Klasse 5' } },
          ],
        },
      },
    };
    const result = ambToNostr(resource, { pubkey: 'a'.repeat(64) });
    expect(result.success).toBe(true);
    const tags = result.data!.tags;
    const ekw = tags.filter((t) => t[0].startsWith('ext:ekw:gradeLevel'));
    expect(ekw).toEqual([
      ['ext:ekw:gradeLevel:id', 'https://example.org/grade/5'],
      ['ext:ekw:gradeLevel:prefLabel:de', 'Klasse 5'],
      ['ext:ekw:gradeLevel:type', 'Concept'],
    ]);
  });

  test('emits bare tags for scalar ext facets', () => {
    const resource: any = {
      '@context': ['https://w3id.org/kim/amb/context.jsonld'],
      id: 'https://example.org/r1',
      type: ['LearningResource'],
      name: 'Test',
      ext: { ekw: { bibleReference: ['Joh 3,16', 'Ps 23'] } },
    };
    const result = ambToNostr(resource, { pubkey: 'a'.repeat(64) });
    const refs = result.data!.tags.filter((t) => t[0] === 'ext:ekw:bibleReference');
    expect(refs).toEqual([
      ['ext:ekw:bibleReference', 'Joh 3,16'],
      ['ext:ekw:bibleReference', 'Ps 23'],
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ambToNostr`
Expected: FAIL (no `ext:ekw:*` tags emitted).

- [ ] **Step 3: Implement emission**

In `src/converters/ambToNostr.ts`, immediately before the `// Create the Nostr event` comment (around line 411), insert:

```typescript
    // Add extension properties (ext namespace) — symmetric with nostrToAmb reconstruction.
    // Concept facets emit id, prefLabel:<lang>(s), type (order matters for reverse boundary).
    // Scalar facets emit a bare ext:<ns>:<facet> tag per value.
    if (ambResource.ext) {
      for (const [ns, facets] of Object.entries(ambResource.ext)) {
        for (const [facet, items] of Object.entries(facets)) {
          for (const item of items as Array<any>) {
            if (typeof item === 'string') {
              tags.push(createTag(`ext:${ns}:${facet}`, item));
            } else if (item && typeof item === 'object') {
              if (item.id) tags.push(createTag(`ext:${ns}:${facet}:id`, item.id));
              if (item.prefLabel) {
                for (const [lang, label] of Object.entries(item.prefLabel)) {
                  tags.push(createTag(`ext:${ns}:${facet}:prefLabel:${lang}`, label as string));
                }
              }
              tags.push(createTag(`ext:${ns}:${facet}:type`, item.type || 'Concept'));
            }
          }
        }
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ambToNostr`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/converters/ambToNostr.ts tests/converters/ambToNostr.test.ts
git commit -m "feat(ambToNostr): emit ext namespace tags (C7)"
```

---

### Task 4: Reverse — partition tags + reconstruct `ext` (C1, C5, C6)

**Files:**
- Modify: `src/converters/nostrToAmb.ts`
- Test: `tests/converters/nostrToAmb.test.ts`

**Interfaces:**
- Consumes: `AmbLearningResourceBase.ext` (Task 2).
- Produces: in `nostrToAmb`, a tag-partition step (`coreTags`/`extTags`/`pTags`/`aTags`, `r` dropped) and helpers `reconstructExt(extTags, warnings)` + `parseExtKey(key)`. `coreTags` is what gets passed to the existing `unflattenTags`. `pTags`/`aTags` are consumed by Tasks 5/6. `warnings` array surfaces on `result.warnings`.

- [ ] **Step 1: Write the failing test**

Append to `tests/converters/nostrToAmb.test.ts`:

```typescript
describe('ext namespace reconstruction', () => {
  function baseEvent(tags: string[][]) {
    return { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '', tags: [['d', 'https://example.org/r1'], ['name', 'T'], ['type', 'LearningResource'], ...tags] };
  }

  test('reconstructs prefixed concept ext facet', () => {
    const ev = baseEvent([
      ['ext:ekw:gradeLevel:id', 'https://example.org/grade/5'],
      ['ext:ekw:gradeLevel:prefLabel:de', 'Klasse 5'],
      ['ext:ekw:gradeLevel:type', 'Concept'],
    ]);
    const result = nostrToAmb(ev);
    expect(result.success).toBe(true);
    expect(result.data!.ext!.ekw.gradeLevel).toEqual([
      { id: 'https://example.org/grade/5', type: 'Concept', prefLabel: { de: 'Klasse 5' } },
    ]);
  });

  test('form-emitted ns keeps the 30168 coordinate', () => {
    const ev = baseEvent([['ext:30168:pub1:formd:fach:id', 'https://example.org/fach/reli']]);
    const result = nostrToAmb(ev);
    expect(result.data!.ext!['30168:pub1:formd'].fach).toEqual([
      { id: 'https://example.org/fach/reli', type: 'Concept' },
    ]);
  });

  test('legacy unprefixed ekw lands in ext.ekw with a warning', () => {
    const ev = baseEvent([['ekw:gradeLevel:id', 'https://example.org/grade/5']]);
    const result = nostrToAmb(ev);
    expect(result.data!.ext!.ekw.gradeLevel).toEqual([{ id: 'https://example.org/grade/5', type: 'Concept' }]);
    expect(result.warnings?.some((w) => w.includes("legacy unprefixed ext namespace 'ekw'"))).toBe(true);
  });

  test('r tags are excluded from AMB output', () => {
    const ev = baseEvent([['r', 'https://oersi.org/x']]);
    const result = nostrToAmb(ev);
    expect((result.data as any).r).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nostrToAmb`
Expected: FAIL (`ext` undefined; `r` present).

- [ ] **Step 3: Implement partition + ext reconstruction**

In `src/converters/nostrToAmb.ts`, replace the body that calls `unflattenTags` and returns. Specifically, change the section starting at `// Unflatten tags to AMB structure` through the `return { success: true, data: amb ... }`:

```typescript
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
```

Update the imports at the top of the file to include `ConversionResult`:

```typescript
import {
  NostrEvent,
  AmbLearningResource,
  ConversionResult,
  ConversionError,
  ConversionErrorCode,
} from '../types/index.js';
```

Then add these helpers at the end of the file (after `reconstructNestedObjects`):

```typescript
/**
 * Split an ext/ekw tag key into { ns, facet, sub, legacy }. Mirrors
 * edufeed-app's parseExtensionTags.parseTagKey. Returns null if not an ext key.
 */
function parseExtKey(
  key: string
): { ns: string; facet: string; sub: string | null; legacy: boolean } | null {
  if (!key) return null;
  const segments = key.split(':');
  if (segments.length < 2) return null;

  let body: string[];
  let legacy = false;
  if (segments[0] === 'ext') {
    body = segments.slice(1);
  } else if (segments[0] === 'ekw') {
    body = segments; // ns = 'ekw'
    legacy = true;
  } else {
    return null;
  }
  if (body.length < 2) return null;

  let sub: string | null = null;
  let tail = body.length;
  const lastSeg = body[body.length - 1];
  const prevSeg = body[body.length - 2];
  if (prevSeg === 'prefLabel') {
    if (!lastSeg) return null;
    sub = `prefLabel:${lastSeg}`;
    tail = body.length - 2;
  } else if (lastSeg === 'id' || lastSeg === 'type') {
    sub = lastSeg;
    tail = body.length - 1;
  }
  if (tail < 2) return null;

  const facet = body[tail - 1];
  const ns = body.slice(0, tail - 1).join(':');
  if (!ns || !facet) return null;
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
  const work: Record<string, Record<string, { kind: 'concept' | 'scalar'; items: any[] }>> = {};

  for (const tag of extTags) {
    const parsed = parseExtKey(tag[0]);
    if (!parsed) continue;
    const { ns, facet, sub, legacy } = parsed;
    if (legacy) legacyNamespaces.add(ns);
    const value = typeof tag[1] === 'string' ? tag[1] : '';

    if (!work[ns]) work[ns] = {};
    if (!work[ns][facet]) {
      work[ns][facet] = { kind: sub === null ? 'scalar' : 'concept', items: [] };
    }
    const f = work[ns][facet];

    if (sub === null) {
      if (f.kind !== 'scalar') continue;
      if (value) f.items.push(value);
    } else {
      if (f.kind !== 'concept') continue;
      if (sub === 'id') {
        if (value) f.items.push({ id: value, type: 'Concept' });
      } else if (sub === 'type') {
        // presence only; type is always 'Concept'
      } else if (sub.startsWith('prefLabel:')) {
        const lang = sub.slice('prefLabel:'.length);
        const last = f.items[f.items.length - 1];
        if (last && lang) {
          if (!last.prefLabel) last.prefLabel = {};
          last.prefLabel[lang] = value;
        }
      }
    }
  }

  const out: Record<string, Record<string, any>> = {};
  for (const ns of Object.keys(work)) {
    for (const facet of Object.keys(work[ns])) {
      const f = work[ns][facet];
      if (f.items.length === 0) continue;
      if (!out[ns]) out[ns] = {};
      out[ns][facet] = f.items;
    }
  }

  for (const ns of legacyNamespaces) {
    warnings.push(`legacy unprefixed ext namespace '${ns}'; producers should migrate to 'ext:${ns}:'`);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nostrToAmb`
Expected: PASS (all ext + r-exclusion tests). The pre-existing nostrToAmb tests still pass (content/p/a not yet handled but those fixtures don't exercise them).

- [ ] **Step 5: Commit**

```bash
git add src/converters/nostrToAmb.ts tests/converters/nostrToAmb.test.ts
git commit -m "feat(nostrToAmb): reconstruct ext namespace, drop r tags (C1,C5,C6)"
```

---

### Task 5: Reverse — `p` tags → creator/contributor (C2)

**Files:**
- Modify: `src/converters/nostrToAmb.ts`
- Test: `tests/converters/nostrToAmb.test.ts`

**Interfaces:**
- Consumes: `pTags` partition + `nip19` from `nostr-tools`.
- Produces: `applyPersonTags(amb, pTags)` appending `{ id: "nostr:<nprofile>", type: "Person" }` to `amb.creator`/`amb.contributor`.

- [ ] **Step 1: Write the failing test**

Append to `tests/converters/nostrToAmb.test.ts`:

```typescript
import { nip19 } from 'nostr-tools';

describe('p tag reverse mapping', () => {
  test('maps p tag with creator role to nostr nprofile id', () => {
    const pub = 'b'.repeat(64);
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'],
             ['p', pub, 'wss://relay.example', 'creator']] };
    const result = nostrToAmb(ev);
    expect(result.success).toBe(true);
    const creators = result.data!.creator!;
    expect(creators).toHaveLength(1);
    expect((creators[0] as any).type).toBe('Person');
    const decoded = nip19.decode((creators[0] as any).id.replace('nostr:', ''));
    expect(decoded.type).toBe('nprofile');
    expect((decoded.data as any).pubkey).toBe(pub);
  });

  test('ignores p tags without creator/contributor role', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'], ['p', 'c'.repeat(64)]] };
    const result = nostrToAmb(ev);
    expect(result.data!.creator).toBeUndefined();
    expect(result.data!.contributor).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nostrToAmb`
Expected: FAIL (`creator` undefined).

- [ ] **Step 3: Implement**

In `src/converters/nostrToAmb.ts`, add `nip19` to the nostr-tools import (add a new import line near the top):

```typescript
import { nip19 } from 'nostr-tools';
```

In `nostrToAmb`, after the ext reconstruction block (`if (ext) amb.ext = ext;`) and before the required-field validation, add:

```typescript
    // C2: Nostr-native creator/contributor (p tags)
    applyPersonTags(amb, pTags);
```

Add this helper after `reconstructExt`:

```typescript
/**
 * Map ["p", <pubkey>, <hint?>, <role>] tags (role creator|contributor) to
 * AMB person objects { id: "nostr:<nprofile>", type: "Person" }. Persons
 * without a creator/contributor role are ignored.
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
    try {
      nprofile = nip19.nprofileEncode({ pubkey, relays });
    } catch {
      continue;
    }
    const person = { id: `nostr:${nprofile}`, type: 'Person' };
    if (!Array.isArray(amb[role])) amb[role] = [];
    amb[role].push(person);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nostrToAmb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/converters/nostrToAmb.ts tests/converters/nostrToAmb.test.ts
git commit -m "feat(nostrToAmb): map p tags to creator/contributor (C2)"
```

---

### Task 6: Reverse — `a` tags → relations (C3)

**Files:**
- Modify: `src/converters/nostrToAmb.ts`
- Test: `tests/converters/nostrToAmb.test.ts`

**Interfaces:**
- Consumes: `aTags` partition + `nip19`.
- Produces: `applyRelationTags(amb, aTags)` appending `{ id: "nostr:<naddr>", type: "LearningResource" }` to `amb.isBasedOn`/`isPartOf`/`hasPart`.

- [ ] **Step 1: Write the failing test**

Append to `tests/converters/nostrToAmb.test.ts`:

```typescript
describe('a tag reverse mapping', () => {
  test('maps a tag with hasPart role to nostr naddr id', () => {
    const pub = 'd'.repeat(64);
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'],
             ['a', `30142:${pub}:child-d`, 'wss://relay.example', 'hasPart']] };
    const result = nostrToAmb(ev);
    const parts = (result.data as any).hasPart;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('LearningResource');
    const decoded = nip19.decode(parts[0].id.replace('nostr:', ''));
    expect(decoded.type).toBe('naddr');
    expect((decoded.data as any).identifier).toBe('child-d');
    expect((decoded.data as any).pubkey).toBe(pub);
    expect((decoded.data as any).kind).toBe(30142);
  });

  test('ignores a tags with form role', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'],
             ['a', '30168:e'.repeat(1) + '0'.repeat(63) + ':formd', 'wss://r', 'form']] };
    const result = nostrToAmb(ev);
    expect((result.data as any).isBasedOn).toBeUndefined();
    expect((result.data as any).isPartOf).toBeUndefined();
    expect((result.data as any).hasPart).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nostrToAmb`
Expected: FAIL (`hasPart` undefined).

- [ ] **Step 3: Implement**

In `nostrToAmb`, after `applyPersonTags(amb, pTags);` add:

```typescript
    // C3: Nostr-native relations (a tags)
    applyRelationTags(amb, aTags);
```

Add this helper after `applyPersonTags`:

```typescript
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
    const kind = parseInt(parts[0], 10);
    const pubkey = parts[1];
    const identifier = parts.slice(2).join(':');
    if (!Number.isFinite(kind) || !pubkey) continue;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nostrToAmb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/converters/nostrToAmb.ts tests/converters/nostrToAmb.test.ts
git commit -m "feat(nostrToAmb): map a tags to relations, ignore form role (C3)"
```

---

### Task 7: Reverse — prefer `content` for `description` (C4)

**Files:**
- Modify: `src/converters/nostrToAmb.ts`
- Test: `tests/converters/nostrToAmb.test.ts`

**Interfaces:**
- Consumes: `event.content`.
- Produces: `amb.description` sourced from non-empty `content`, overriding any `description` tag.

- [ ] **Step 1: Write the failing test**

Append to `tests/converters/nostrToAmb.test.ts`:

```typescript
describe('content to description', () => {
  test('non-empty content overrides description tag', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: 'From content field',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'], ['description', 'From tag']] };
    const result = nostrToAmb(ev);
    expect(result.data!.description).toBe('From content field');
  });

  test('empty content falls back to description tag', () => {
    const ev = { kind: 30142, pubkey: 'a'.repeat(64), created_at: 1, content: '',
      tags: [['d', 'r1'], ['name', 'T'], ['type', 'LearningResource'], ['description', 'From tag']] };
    const result = nostrToAmb(ev);
    expect(result.data!.description).toBe('From tag');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nostrToAmb`
Expected: FAIL (first test: description is 'From tag').

- [ ] **Step 3: Implement**

In `nostrToAmb`, after `applyRelationTags(amb, aTags);` add:

```typescript
    // C4: content is the preferred source for description
    if (typeof event.content === 'string' && event.content.length > 0) {
      amb.description = event.content;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nostrToAmb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/converters/nostrToAmb.ts tests/converters/nostrToAmb.test.ts
git commit -m "feat(nostrToAmb): prefer content field for description (C4)"
```

---

### Task 8: EKW round-trip integration test

**Files:**
- Create: `tests/converters/ekwRoundtrip.test.ts`

**Interfaces:**
- Consumes: `ambToNostr` + `nostrToAmb` with `ext` support (Tasks 3–4).
- Produces: an integration anchor proving ext survives AMB→Nostr→AMB.

- [ ] **Step 1: Write the failing test**

Create `tests/converters/ekwRoundtrip.test.ts`:

```typescript
import { ambToNostr } from '../../src/converters/ambToNostr';
import { nostrToAmb } from '../../src/converters/nostrToAmb';

describe('EKW ext round-trip', () => {
  const resource: any = {
    '@context': ['https://w3id.org/kim/amb/context.jsonld'],
    id: 'https://example.org/material/42',
    type: ['LearningResource'],
    name: 'Schöpfung',
    description: 'Eine Einheit',
    ext: {
      ekw: {
        gradeLevel: [
          { id: 'https://example.org/grade/5', type: 'Concept', prefLabel: { de: 'Klasse 5' } },
          { id: 'https://example.org/grade/6', type: 'Concept', prefLabel: { de: 'Klasse 6' } },
        ],
        bibleReference: ['Gen 1', 'Ps 104'],
      },
      '30168:pub1:reli-form': {
        fach: [{ id: 'https://example.org/fach/reli', type: 'Concept', prefLabel: { de: 'Religion' } }],
      },
    },
  };

  test('ext survives AMB -> Nostr -> AMB', () => {
    const fwd = ambToNostr(resource, { pubkey: 'a'.repeat(64) });
    expect(fwd.success).toBe(true);
    const back = nostrToAmb(fwd.data!);
    expect(back.success).toBe(true);
    const ext = back.data!.ext!;
    expect(ext.ekw.gradeLevel).toEqual(resource.ext.ekw.gradeLevel);
    expect(ext.ekw.bibleReference).toEqual(['Gen 1', 'Ps 104']);
    expect(ext['30168:pub1:reli-form'].fach).toEqual(resource.ext['30168:pub1:reli-form'].fach);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npm test -- ekwRoundtrip`
Expected: PASS if Tasks 3–4 are complete (this test guards their integration). If it fails, fix the converter, not the test.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests PASS (no regressions in pre-existing converter/spec round-trip tests).

- [ ] **Step 4: Commit**

```bash
git add tests/converters/ekwRoundtrip.test.ts
git commit -m "test: EKW ext round-trip integration"
```

---

### Task 9: Browser bundle build

**Files:**
- Create: `src/browser.ts`
- Modify: `package.json` (add `esbuild` devDep + `build:browser` script)

**Interfaces:**
- Produces: `dist/browser/amb-nostr-converter.esm.js` — a single self-contained ESM module exporting `ambToNostr` and `nostrToAmb`. Consumed by the handout (Tasks 10–11).

- [ ] **Step 1: Create the browser entry**

Create `src/browser.ts`:

```typescript
export { ambToNostr } from './converters/ambToNostr.js';
export { nostrToAmb } from './converters/nostrToAmb.js';
```

- [ ] **Step 2: Add esbuild + script**

Run: `cd /home/laoc/coding/edufeed/amb-nostr-converter && npm install --save-dev esbuild`

Then in `package.json` `scripts`, add:

```json
    "build:browser": "esbuild src/browser.ts --bundle --format=esm --platform=browser --target=es2020 --outfile=dist/browser/amb-nostr-converter.esm.js",
```

- [ ] **Step 3: Build and verify the bundle**

Run: `npm run build:browser && grep -c "export" dist/browser/amb-nostr-converter.esm.js`
Expected: build succeeds; grep prints a count ≥ 1 (the file contains `export { ambToNostr, nostrToAmb }`).

- [ ] **Step 4: Smoke-test the bundle in Node (ESM)**

Run:
```bash
node --input-type=module -e "import('./dist/browser/amb-nostr-converter.esm.js').then(m => { const r = m.nostrToAmb({kind:30142,pubkey:'a'.repeat(64),created_at:1,content:'',tags:[['d','x'],['name','N'],['type','LearningResource'],['ext:ekw:gradeLevel:id','https://e/5']]}); console.log(JSON.stringify(r.data.ext)); })"
```
Expected: prints `{"ekw":{"gradeLevel":[{"id":"https://e/5","type":"Concept"}]}}`.

- [ ] **Step 5: Commit**

```bash
git add src/browser.ts package.json package-lock.json
git commit -m "build: esbuild browser bundle of converters"
```

Note: do not commit `dist/` if gitignored; the bundle is copied into the handout repo in Task 10.

---

### Task 10: Handout page scaffold (5 answers)

**Files:**
- Create: `edufeed-examples/amb-datapool.html`
- Create: `edufeed-examples/amb-nostr-converter.esm.js` (copy of the Task 9 bundle)

**Interfaces:**
- Consumes: the browser bundle.
- Produces: a static page answering the partner's 5 questions; the widget shell is wired in Task 11.

- [ ] **Step 1: Copy the bundle into the handout repo**

Run:
```bash
cp /home/laoc/coding/edufeed/amb-nostr-converter/dist/browser/amb-nostr-converter.esm.js \
   /home/laoc/coding/edufeed/edufeed-examples/amb-nostr-converter.esm.js
```

- [ ] **Step 2: Write the page**

Create `edufeed-examples/amb-datapool.html`. Reuse the visual idiom of `amb-demo.html` (same CSS-variable palette and `.wrap`/`section`/`h2`/`pre`/`code` styles — copy the `:root`/base block from that file). English, technical. Structure:

- `<header>`: "Edufeed Educational Data Pool — integration guide".
- Section **1. What's stored**: kind 30142 addressable events; a property→tag mapping table (copy the key rows from AMB.md: `d`=id, `name`, `description`+`content`, `t`=keywords, `about:*`, `learningResourceType:*`, `creator:*`/`p`, relations via `a`, `r` external refs); ext namespaces (`ext:ekw:*`, form-emitted `ext:30168:<pub>:<d>:*`).
- Section **2. How data enters**: resource form / EKW wizard / sitemap pipeline sign a 30142 event and publish to the AMB relay.
- Section **3. Does location matter**: `kind:pubkey:d-tag` addressing; the AMB relay set; querying via NIP-01 filters + NIP-50 search including `#ext:<ns>:<facet>:id` tag filters.
- Section **4. How it's updated**: addressable replacement (newest `created_at` per d-tag wins) + NIP-09 deletion (kind 5).
- Section **5. Categorization**: SKOS vocab fields (`about`, `learningResourceType`, `audience`, `educationalLevel`) + ext namespaces.
- Section **6. Convert events back to plain JSON**: CLI snippet (`amb-convert nostr:amb event.json`) and the live widget placeholder `<div id="widget">` (filled in Task 11).

- [ ] **Step 3: Verify the page renders**

Open `edufeed-examples/amb-datapool.html` in a browser (or via the playwright MCP `browser_navigate` to the `file://` path). Confirm all six sections render and the page is styled consistently with `amb-demo.html`. No console errors.

- [ ] **Step 4: Commit (in the handout repo)**

```bash
cd /home/laoc/coding/edufeed/edufeed-examples
git add amb-datapool.html amb-nostr-converter.esm.js
git commit -m "docs: data-pool integration guide page (static content)"
```

---

### Task 11: Live round-trip widget

**Files:**
- Modify: `edufeed-examples/amb-datapool.html` (add the widget script + preloaded example)

**Interfaces:**
- Consumes: `./amb-nostr-converter.esm.js` (`nostrToAmb`, `ambToNostr`).
- Produces: a two-pane converter the partner can paste events into.

- [ ] **Step 1: Add the widget**

In `amb-datapool.html`, replace the `<div id="widget">` with two `<textarea>`s (left: Nostr event JSON, right: reconstructed AMB JSON), a "Nostr → AMB" button and an "AMB → Nostr" button, and a `<module>` script:

```html
<script type="module">
  import { nostrToAmb, ambToNostr } from './amb-nostr-converter.esm.js';
  const left = document.getElementById('inp');
  const right = document.getElementById('out');
  const EXAMPLE = {
    kind: 30142, pubkey: '0'.repeat(64), created_at: 1700000000, content: 'Eine Unterrichtseinheit zur Schöpfung.',
    tags: [
      ['d', 'https://example.org/material/42'],
      ['name', 'Schöpfung'],
      ['type', 'LearningResource'],
      ['about:id', 'https://w3id.org/kim/schulfaecher/s1009'],
      ['about:prefLabel:de', 'Religion'],
      ['ext:ekw:gradeLevel:id', 'https://example.org/grade/5'],
      ['ext:ekw:gradeLevel:prefLabel:de', 'Klasse 5'],
      ['ext:ekw:gradeLevel:type', 'Concept'],
    ],
  };
  left.value = JSON.stringify(EXAMPLE, null, 2);
  document.getElementById('toAmb').onclick = () => {
    try { const r = nostrToAmb(JSON.parse(left.value));
      right.value = r.success ? JSON.stringify(r.data, null, 2) : 'Error: ' + r.error.message;
    } catch (e) { right.value = 'Invalid JSON: ' + e.message; }
  };
  document.getElementById('toNostr').onclick = () => {
    try { const r = ambToNostr(JSON.parse(right.value || left.value), { pubkey: '0'.repeat(64) });
      right.value = r.success ? JSON.stringify(r.data, null, 2) : 'Error: ' + r.error.message;
    } catch (e) { right.value = 'Invalid JSON: ' + e.message; }
  };
</script>
```

(Add matching `<textarea id="inp">`, `<textarea id="out">`, `<button id="toAmb">`, `<button id="toNostr">` markup in the section.)

- [ ] **Step 2: Verify the widget live**

Open the page in a browser (playwright MCP `browser_navigate` to the `file://` path). Click "Nostr → AMB". Confirm the right pane shows reconstructed AMB JSON including `ext.ekw.gradeLevel` as a concept array and `about` as a concept. Check the console for zero errors. Try pasting a `p`-tag event and confirm a `nostr:nprofile` creator id appears.

- [ ] **Step 3: Commit**

```bash
cd /home/laoc/coding/edufeed/edufeed-examples
git add amb-datapool.html
git commit -m "feat: live Nostr<->AMB round-trip widget on data-pool page"
```

---

## Self-Review

**Spec coverage:**
- C1 ext both directions → Task 3 (forward) + Task 4 (reverse). ✓
- C2 p tags → Task 5. ✓
- C3 a tags + form-role ignore → Task 6. ✓
- C4 content→description → Task 7. ✓
- C5 r exclusion → Task 4. ✓
- C6 form-emitted ext ns → Task 4 (test) + Task 8 (round-trip). ✓
- C7 forward ext → Task 3. ✓
- Audit (Deliverable 1) → Task 1. ✓
- Browser bundle (2d) → Task 9. ✓
- Handout page + live widget (Deliverable 3) → Tasks 10–11. ✓
- EKW round-trip fixture → Task 8. ✓

**Placeholder scan:** No TBD/TODO; all code steps carry full code. ✓

**Type consistency:** `reconstructExt`/`parseExtKey`/`applyPersonTags`/`applyRelationTags` defined in Task 4–6 and referenced consistently; `ExtFacet` defined in Task 2 and used in Task 3; `ConversionResult` import added in Task 4. ✓

**Known deferred:** scalar ext input shape resolved as `string[]` (Task 3 second test); `p`/`a` reverse lossiness documented in Task 1 audit, not "fixed". ✓
