# NIP-AMB Compliance Audit: amb-nostr-converter Library

## Executive Summary

**edufeed-app is spec-compliant.** The standalone `amb-nostr-converter` library has drifted from the NIP-AMB specification. A consumer using the library to reconstruct JSON from Nostr events silently loses extension metadata, creator/contributor provenance, relationship references, content descriptions, and relay hints. This audit documents seven non-conformance points (C1–C7) and maps the remediation work required to align the library with the published spec.

## Reference Implementation

The NIP-AMB specification is defined at:
- **Spec:** [AMB.md](https://git.edufeed.org/edufeed/nips/src/branch/edufeed-amb/AMB.md)

The canonical compliant implementation in edufeed-app is:
- **Nostr → JSON (reverse, mirrors `nostrToAmb`):** `src/lib/helpers/educational/parseExtensionTags.js` — parses `ext:` namespaced tags and reconstructs metadata. Classification rule (verbatim): a tag is an extension **iff** its key starts with `ext:` or `ekw:`; all other colon-delimited keys are AMB-core.
- **JSON → Nostr (forward, mirrors `ambToNostr`):** `src/lib/helpers/educational/formDataToEkwTags.js` — emits `ext:` triples (`id`, then `prefLabel:<lang>`, then `type`) for form-defined extensions.

## Drift Table: Non-Conformances (C1–C7)

| ID | Issue | Current File:Line | Required Behavior | Impact |
|----|-------|------------------|-------------------|--------|
| **C1** | `ext:` namespace unhandled both directions | `nostrToAmb.ts:158–159` (skip list excludes only `d`/`t`, so `ext:` keys are mangled by generic unflatten); `ambToNostr.ts` (no `ext` emission anywhere) | Both converters must handle `ext:30168:<pubkey>:<d>:<key>` tags: `nostrToAmb` parses into `ext` field, `ambToNostr` emits them from input | Extensions (e.g., form-specific metadata) are silently dropped in both directions |
| **C2** | `p` tags ignored; creators/contributors have no Nostr identity | `nostrToAmb.ts:158–159` (skip list excludes only `d`/`t`; `p` falls through generic unflatten into a junk `p` property) | `nostrToAmb` must map `p` tags with role `creator`/`contributor` to `creator`/`contributor` array with `{ id: "nostr:<nprofile>", type: "Person" }` | Creator/contributor Nostr pubkey provenance lost in forward conversion |
| **C3** | `a` tags ignored; relationships have no Nostr identity | `nostrToAmb.ts:158–159` (skip list excludes only `d`/`t`; `a` falls through generic unflatten into a junk `a` property) | `nostrToAmb` must parse `a` tags, bucket by role (hasPart/isPartOf/isBasedOn), and emit `{ id: "nostr:<naddr>", type: "LearningResource", … }` refs; role `form` ignored | Relationship Nostr event references lost in forward conversion |
| **C4** | `event.content` never read; descriptions are tag-only | `nostrToAmb.ts:16–88` (no `.content` reference) | `nostrToAmb` must prefer non-empty `event.content` for `description` field (per AMB spec, content field SHOULD carry description for client compatibility) | If content field exists but description tag missing, the natural description source is ignored |
| **C5** | `r` tags fold into generic output as `r` property | `nostrToAmb.ts:158–166` (skip list at line 159 only excludes `d`/`t`; `r` falls through the generic unflatten loop) | `r` tags (Nostr-native supplementary refs) must be excluded from output; they are transport metadata, not AMB data | Extra `r` property pollutes AMB JSON structure |
| **C6** | Form-emitted extensions unmodeled (no round-trip) | `ambToNostr.ts:99–409` (no ext input field) | `ambToNostr` must accept `ext` field in AMB input and emit symmetric `ext:30168:<pubkey>:<d>:<key>:…` tags | Form metadata cannot be round-tripped: JSON → Nostr loses the ext structure |
| **C7** | `ambToNostr.ts` emits no `ext` tags, has no `ext` input | `ambToNostr.ts:39–449` (no ext parameter or emission logic) | `ambToNostr` must read `ext` object from input and emit one `ext:` tag per property (namespace = `30168:<pubkey>:<d>`) | Extensions cannot be encoded back to Nostr |

## Known Lossiness (Document, Don't Fix)

The following limitations are inherent to offline conversion and should be documented but not fixed:

1. **`p`/`a` reverse produces `nostr:<nprofile>`/`<naddr>` identifiers that do not bit-exact round-trip.** Bare pubkeys (like `creator:id: "02abc..."`) become wrapped (`creator:id: "nostr:nprofile1qy2hwumn8ghj7mn0wf5k…"`). Round-trip tests must assert the spec-defined reverse shape (presence of the Nostr URI scheme), not byte-for-byte identity.

2. **`name` field for `p`-tag persons requires a kind 0 (metadata) fetch.** This is out of scope for an offline converter. Tests should allow omission of creator `name` when converting from bare pubkeys, and populate it only when caller provides a pre-fetched name via the person object.

3. **A creator that has a Nostr pubkey is represented twice on reverse.** edufeed's forward emission writes both the flattened `creator:*` core tags (name, type, affiliation — see `formDataToAmb.js` + `appendCreatorPTags` in `eventTags.js`) AND a separate `["p", pubkey, hint, "creator"]` tag for the same person. On reverse, `unflattenTags` reconstructs the name-described `{ name, type }` entry while `applyPersonTags` appends the `{ id: "nostr:<nprofile>", type: "Person" }` entry, so `amb.creator` carries two objects for one person. This is **intentional and matches the reference implementation** (`edufeed-app/ambTransform.js:85-103` does the identical non-deduping push). Deduping would make the converter diverge from the producer it must mirror, so it is documented here rather than fixed. (The design doc's assumption that p-tag persons carry no `creator:*` tags was inaccurate for edufeed's real output; the resulting behavior is nonetheless correct.)

## Remediation

The following implementation plan addresses all drift points (test-first):

- **Task 2:** Add an `ext` field (`ext[ns][facet] = Concept[] | string[]`) to the AMB types.
- **Task 3 (C7):** Forward — `ambToNostr` emits `ext:` tags from `resource.ext`.
- **Task 4 (C1, C5, C6):** Reverse — `nostrToAmb` partitions tags, reconstructs `ext` (including form-emitted ns `30168:<pub>:<d>`), and excludes `r` tags.
- **Task 5 (C2):** Reverse — `p` tags → creator/contributor `{ id: "nostr:<nprofile>", type: "Person" }`.
- **Task 6 (C3):** Reverse — `a` tags → relations `{ id: "nostr:<naddr>", type: "LearningResource" }` bucketed by role; role `form` ignored.
- **Task 7 (C4):** Reverse — prefer non-empty `event.content` for `description`.

See the implementation plan at: `docs/superpowers/plans/2026-06-23-amb-converter-realignment-and-datapool-handout.md`
