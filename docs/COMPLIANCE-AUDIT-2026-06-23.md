# NIP-AMB Compliance Audit: amb-nostr-converter Library

## Executive Summary

**edufeed-app is spec-compliant.** The standalone `amb-nostr-converter` library has drifted from the NIP-AMB specification. A consumer using the library to reconstruct JSON from Nostr events silently loses extension metadata, creator/contributor provenance, relationship references, content descriptions, and relay hints. This audit documents seven non-conformance points (C1–C7) and maps the remediation work required to align the library with the published spec.

## Reference Implementation

The NIP-AMB specification is defined at:
- **Spec:** [AMB.md](https://git.edufeed.org/edufeed/nips/src/branch/edufeed-amb/AMB.md)

The canonical compliant implementation in edufeed-app is:
- **Forward (Nostr → JSON):** `src/lib/helpers/educational/parseExtensionTags.js` — parses `ext:` namespaced tags and reconstructs metadata
- **Reverse (JSON → Nostr):** `src/lib/helpers/educational/formDataToEkwTags.js` — emits `ext:` tags for form-defined extensions and `p`/`a` tags for creators/relationships

## Drift Table: Non-Conformances (C1–C7)

| ID | Issue | Current File:Line | Required Behavior | Impact |
|----|-------|------------------|-------------------|--------|
| **C1** | `ext:` namespace unhandled both directions | `nostrToAmb.ts:117–127`; `ambToNostr.ts:99–409` (no ext handling) | Both converters must handle `ext:30168:<pubkey>:<d>:<key>` tags: `nostrToAmb` parses into `ext` field, `ambToNostr` emits them from input | Extensions (e.g., form-specific metadata) are silently dropped in both directions |
| **C2** | `p` tags ignored; creators/contributors have no Nostr identity | `nostrToAmb.ts:110–134` (only d/t special-cased) | `nostrToAmb` must map `p` tags with role `creator`/`contributor` to `creator`/`contributor` array with `{ id: "nostr:<nprofile>", type: "Person" }` | Creator/contributor Nostr pubkey provenance lost in forward conversion |
| **C3** | `a` tags ignored; relationships have no Nostr identity | `nostrToAmb.ts:110–134` (only d/t special-cased) | `nostrToAmb` must parse `a` tags, bucket by role (hasPart/isPartOf/isBasedOn), and emit `{ id: "nostr:<naddr>", type: "LearningResource", … }` refs; role `form` ignored | Relationship Nostr event references lost in forward conversion |
| **C4** | `event.content` never read; descriptions are tag-only | `nostrToAmb.ts:16–88` (no `.content` reference) | `nostrToAmb` must prefer non-empty `event.content` for `description` field (per AMB spec, content field SHOULD carry description for client compatibility) | If content field exists but description tag missing, the natural description source is ignored |
| **C5** | `r` tags fold into generic output as `r` property | `nostrToAmb.ts:130–133` (r tags grouped via generic unflatten) | `r` tags (Nostr relay hints) must be excluded from output; they are transport metadata, not AMB data | Extra `r` property pollutes AMB JSON structure |
| **C6** | Form-emitted extensions unmodeled (no round-trip) | `ambToNostr.ts:99–409` (no ext input field) | `ambToNostr` must accept `ext` field in AMB input and emit symmetric `ext:30168:<pubkey>:<d>:<key>:…` tags | Form metadata cannot be round-tripped: JSON → Nostr loses the ext structure |
| **C7** | `ambToNostr.ts` emits no `ext` tags, has no `ext` input | `ambToNostr.ts:39–449` (no ext parameter or emission logic) | `ambToNostr` must read `ext` object from input and emit one `ext:` tag per property (namespace = `30168:<pubkey>:<d>`) | Extensions cannot be encoded back to Nostr |

## Known Lossiness (Document, Don't Fix)

The following limitations are inherent to offline conversion and should be documented but not fixed:

1. **`p`/`a` reverse produces `nostr:<nprofile>`/`<naddr>` identifiers that do not bit-exact round-trip.** Bare pubkeys (like `creator:id: "02abc..."`) become wrapped (`creator:id: "nostr:nprofile1qy2hwumn8ghj7mn0wf5k…"`). Round-trip tests must assert the spec-defined reverse shape (presence of the Nostr URI scheme), not byte-for-byte identity.

2. **`name` field for `p`-tag persons requires a kind 0 (metadata) fetch.** This is out of scope for an offline converter. Tests should allow omission of creator `name` when converting from bare pubkeys, and populate it only when caller provides a pre-fetched name via the person object.

## Remediation

The following implementation plan addresses all drift points:

- **Tasks 2–3:** Parser refactoring — extend `nostrToAmb` to handle `ext:` tags, `p` tags, `a` tags, `event.content`, and exclude `r` tags.
- **Tasks 4–5:** Reverse encoder fixes — add `ext` input field to `ambToNostr`, emit `ext:` tags, and output `p`/`a` tags (already partially done).
- **Tasks 6–7:** Test coverage — add fixtures and assertions for all seven non-conformances.

See the implementation plan at: `docs/superpowers/plans/2026-06-23-amb-converter-realignment-and-datapool-handout.md`
