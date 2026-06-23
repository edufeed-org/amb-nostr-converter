# AMB Converter Spec Re-alignment + Data-Pool Handout — Design

**Date:** 2026-06-23
**Status:** Design (awaiting review)
**Repos touched:** `amb-nostr-converter` (primary), `edufeed-examples` (handout page)

## Context

A partner ("Materialdatenpool Migration") needs to consume the educational
metadata edufeed produces, and asked five questions:

1. What data is stored in the relay? Is there an overview?
2. How does the data get into the relay?
3. Does the storage location matter?
4. How is the data updated there?
5. Is there a concept for categorizing the data?

They are a technical integrator. Their core practical need: **turn the relay's
Nostr events back into "regular" JSON**, including the extension (`ext`) fields.

This triggered a compliance question: has `amb-nostr-converter` drifted from the
current [NIP-AMB spec](https://git.edufeed.org/edufeed/nips/src/branch/edufeed-amb/AMB.md)?

## Key Finding

**`edufeed-app` is spec-compliant. The standalone `amb-nostr-converter` library
has drifted.** This matters because the partner would reach for the *library* to
reconstruct JSON — and the library silently mishandles exactly the fields they
need.

Evidence in `edufeed-app` (the compliant reference):
- `src/lib/helpers/educational/ekwNamespace.js` — `EKW_TAG_PREFIX = 'ext:ekw:'`
  (prefixed, forward-compatible shape).
- `src/lib/helpers/educational/formDataToEkwTags.js` — emits
  `ext:ekw:<facet>:id` / `:prefLabel:de` / `:type` triples.
- `src/lib/helpers/educational/parseExtensionTags.js` — reads both the forward
  `ext:<ns>:…` shape (incl. form-emitted `ext:30168:<pub>:<d>:…`) and the legacy
  unprefixed `ekw:…` as a read-only fallback. Its classification rule is clean:
  **a tag is an extension iff its key starts with `ext:` or `ekw:`; everything
  else is AMB-core.** No AMB-core allowlist guesswork is required.

The converter will adopt this same prefix rule, keeping library and app
consistent.

## Drift Inventory (drives Deliverables 1 & 2)

| # | Gap in `amb-nostr-converter` | What the spec / compliant app requires |
|---|---|---|
| C1 | No `ext:` namespace handling in either direction | `ext:<ns>:<facet>:<sub>` grouped under `output.ext.<ns>.<facet>` |
| C2 | `nostrToAmb` ignores `p` tags | `["p", <pub>, <hint>, <role>]` → creator/contributor `{ id: "nostr:<nprofile>" }` |
| C3 | `nostrToAmb` ignores `a` tags | `["a", "30142:<pub>:<d>", <hint>, <role>]` → relation `{ id: "nostr:<naddr>", type: "LearningResource" }` bucketed by role |
| C4 | `nostrToAmb` never reads `content` | `content` is the preferred source for `description` |
| C5 | `r` tags get folded into output as a property | `r` tags are Nostr-native supplementary refs — excluded from AMB output |
| C6 | 30168 form-emitted ext (`ext:30168:<pub>:<d>:…`) unmodeled | form ext convention; `["a", "30168:…", hint, "form"]` back-ref is NOT a relation |
| C7 | `ambToNostr` emits no `ext` (input has no `ext` field) | symmetric `ext` emission from an input `ext` object |

---

## Deliverable 1 — Compliance Audit (written report)

**Location:** `amb-nostr-converter/docs/COMPLIANCE-AUDIT-2026-06-23.md`

A markdown report that:
- States the headline up front: edufeed-app compliant, library lagging.
- Walks each drift point C1–C7 with: current converter behavior (file/line), the
  spec/app-reference requirement, and the resulting data corruption for a
  consumer (e.g. EKW facets silently dropped or mis-nested).
- References the compliant edufeed-app helpers as the behavioral target.
- Concludes with the remediation summary (= Deliverable 2 scope).

This is documentation only; written first so the fixes have a checklist.

## Deliverable 2 — Converter Re-alignment (TDD, full)

Bring `amb-nostr-converter` back to the current spec. Test-first: each drift
point gets a failing test before the fix.

### 2a. Types (`src/types/amb.ts`)
- Add `ext?: Record<string, Record<string, Concept[]>>` to
  `AmbLearningResource` (shape: `ext.<ns>.<facet> = Concept[]`).

### 2b. Forward — `ambToNostr` (`src/converters/ambToNostr.ts`)
- **C7:** When `resource.ext` is present, emit, for each `ns` → `facet` →
  `Concept[]`: `ext:<ns>:<facet>:id`, `ext:<ns>:<facet>:prefLabel:<lang>`,
  `ext:<ns>:<facet>:type` per concept. Mirror `formDataToEkwTags` emission order
  (id, prefLabel*, type) so reverse boundary detection (new `id` = new entry)
  works. Scalar ext facets (a `Concept[]` whose entries are bare strings, or a
  dedicated scalar shape) emit a bare `ext:<ns>:<facet>` tag — match
  `parseExtensionTags`'s scalar handling. (Decide the scalar input shape during
  implementation; default to concept triples, add scalar only if a fixture
  needs it.)

### 2c. Reverse — `nostrToAmb` (`src/converters/nostrToAmb.ts`)
Currently only `d` and `t` are special-cased; everything else is unflattened
into AMB-core. Add, before/around the generic unflatten:
- **C1 + C6 (ext classification):** Tags whose key starts with `ext:` or `ekw:`
  are **removed from the AMB-core unflatten path** and routed to an ext
  reconstructor that produces `output.ext.<ns>.<facet>` (array of
  `{ id, prefLabel?, type? }` concept objects, boundary on repeated `id`;
  `prefLabel:<lang>` → `prefLabel.<lang>`). For legacy `ekw:` keys, synthesize
  `ns = "ekw"` and push a conversion warning naming the namespace
  ("legacy unprefixed ext namespace 'ekw'; producers should migrate to
  'ext:ekw:'"). Port the parsing rule from edufeed-app's
  `parseExtensionTags.js` for consistency.
- **C2 (`p` tags):** `["p", <pub>, <hint>, <role>]` with role `creator` /
  `contributor` → push `{ id: "nostr:<nprofile>", type: "Person" }` (default
  type Person; nprofile via `nip19.nprofileEncode({ pubkey, relays: hint?[hint]:[] })`)
  into the matching array. These persons have no flattened `creator:*` tags, so
  they merge with any externally-described creators in the same array.
- **C3 (`a` tags):** `["a", "30142:<pub>:<d>", <hint>, <role>]` with role
  `isBasedOn` / `isPartOf` / `hasPart` → push
  `{ id: "nostr:<naddr>", type: "LearningResource" }` (naddr via
  `nip19.naddrEncode({ kind: 30142, pubkey: <pub>, identifier: <d>, relays: hint?[hint]:[] })`).
  Role `form` (and any unknown role) → **not** a relation; ignore for AMB output.
- **C4 (`content`):** If `event.content` is non-empty, use it as `description`,
  preferring it over a `description` tag.
- **C5 (`r` tags):** Exclude from AMB output (skip like `d`/`t`).

### 2d. Browser bundle (enables Deliverable 3's live widget)
- Add an `esbuild` devDependency and a `build:browser` npm script producing a
  single self-contained ESM file, e.g. `dist/browser/amb-nostr-converter.esm.js`
  (bundles `nostr-tools`; excludes `jsonld`, which the core converters do not
  import — confirmed). Exposes `ambToNostr`, `nostrToAmb`, and signing.
- This artifact is copied into `edufeed-examples` (see Deliverable 3) so the
  handout stays a zero-build static page.

### 2e. Tests (`tests/converters/`)
- Extend `nostrToAmb.test.ts` and `ambToNostr.test.ts` with focused cases per
  C1–C7.
- Add a round-trip test using a **real EKW-shaped event** fixture (build from
  `formDataToEkwTags` output shape): `ext:ekw:gradeLevel:*`, plus a
  form-emitted `ext:30168:<pub>:<d>:fach:*` namespace.
- Add a legacy `ekw:`-unprefixed fixture asserting it lands in `output.ext.ekw`
  **and** raises the migrate warning.
- Add `p`-tag and `a`-tag reverse fixtures asserting `nostr:` nprofile/naddr ids
  and correct relation bucketing; assert `form`-role `a` tags are ignored.
- Assert `r` tags do not appear in AMB output; assert `content` wins over a
  `description` tag.

## Deliverable 3 — Data-Pool Handout (live web page)

**Location:** `edufeed-examples/amb-datapool.html` (+ copied browser bundle).
English, technical, single self-contained static HTML matching the visual
language of the existing `amb-demo.html` (same CSS variables / layout idiom).

Structured as the partner's five questions:

1. **What is stored** — kind 30142 addressable events; the flattened tag schema
   (AMB-core property → tag table); Nostr-native conventions (`d`/`t`/`p`/`a`/`r`,
   `content` duplication); ext namespaces (`ext:ekw:*`, form-emitted
   `ext:30168:<pub>:<d>:*`).
2. **How data enters** — the resource form / EKW wizard / sitemap pipeline sign a
   30142 event and publish it to the AMB relay(s).
3. **Does location matter** — addressing via `kind:pubkey:d-tag`; the AMB relay
   set; querying with NIP-01 filters and NIP-50 search (incl. `#ext:<ns>:<facet>:id`
   tag filters).
4. **How it's updated** — addressable replacement semantics (newest `created_at`
   per `d`-tag wins) + NIP-09 deletion (kind 5).
5. **Categorization** — SKOS vocab fields (`about`, `learningResourceType`,
   `audience`, `educationalLevel`) + ext namespaces for non-AMB facets.

Plus a **"Convert events back to plain JSON"** section:
- CLI/library snippet (`amb-convert nostr:amb event.json`).
- A **live in-browser round-trip widget**: paste/load a 30142 event JSON → render
  the reconstructed AMB JSON (and the reverse: AMB → event). Powered by the
  committed browser bundle from 2d. Ships with a worked EKW example preloaded so
  it demonstrates `ext` reconstruction out of the box.

## Cross-Repo Layout

```
amb-nostr-converter/
  docs/COMPLIANCE-AUDIT-2026-06-23.md      # Deliverable 1
  src/types/amb.ts                         # 2a
  src/converters/ambToNostr.ts             # 2b
  src/converters/nostrToAmb.ts             # 2c
  package.json + esbuild config            # 2d (build:browser)
  tests/converters/*                       # 2e
edufeed-examples/
  amb-datapool.html                        # Deliverable 3
  amb-nostr-converter.esm.js               # copied browser bundle
```

## Testing Strategy

- **Converter:** Vitest, TDD. Failing test per drift point first, then fix. The
  EKW round-trip fixture is the integration anchor.
- **Handout page:** static HTML; verify the live widget in a browser against the
  real bundle (load preloaded EKW example, confirm `ext` reconstructs; try a
  `p`/`a`-tag event, confirm `nostr:` ids). No automated E2E for the demo page.

## Out of Scope / Deferred

- Changing `edufeed-app` (already compliant).
- Publishing a new converter version to the registry (build + version bump can
  follow once fixes land; not required for the handout, which uses the committed
  bundle).
- JSON-LD context resolution / `jsonld` runtime use in the browser bundle.
- Enforcing profile-list access control or enforced-relay semantics.

## Risks

- **`p`/`a` reverse asymmetry:** `nostr:<nprofile>`/`<naddr>` ids do not
  round-trip back to bare pubkeys without decoding. Forward conversion accepts
  `nostrPubkey`/`nostrEvent` inputs, not `nostr:` ids — so a strict
  reverse→forward round-trip of native tags is lossy by design. Tests assert the
  spec-defined reverse shape, not bit-exact re-encoding. Document this in the
  audit.
- **Browser bundle size:** `nostr-tools` pulls in `@noble/*`. Acceptable for a
  demo page; keep `jsonld` out of the bundle.
- **Scalar ext shape:** the input type for scalar ext facets (e.g.
  `ext:ekw:bibleReference`) needs a decision in 2b; default to concept triples
  and only add a scalar path if a fixture requires it.
