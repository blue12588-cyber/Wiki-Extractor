# Adaptation Log — harness-core → llmwiki

**Status**: SUBSTANTIVE (Slice 2 Round-2). Stub replaced.

## Upstream pin

- **upstream repository**: `harness-core` (private; located at `\\wsl.localhost\ubuntu-24.04\home\user\harness-core` during Slice 2 work).
- **upstream HEAD pinned during this adaptation**: `490779559169faa6924afa2a4395f16732762d69`.
- **upstream HEAD verification command**: `git -C <harness-core-root> rev-parse HEAD`.
- **upstream branch**: `master`.
- **upstream working tree write policy during Slice 2**: zero writes outside `runs/<run_id>/`. AC-9 of the agreed contract mandates pre/post HEAD equality for this run's own writes; observed divergence from the Slice-2 pre-snapshot to the orchestrator-acknowledged value above is attributable to parallel agent activity (SW-1.1 worktree) and is NOT a Slice-2 write.

The pin above is the upstream HEAD at the moment Round-2 began copying / rewriting the source files listed below. If a later slice re-syncs from a newer HEAD, every per-file rationale entry must be re-verified against the new upstream — append a new rationale block rather than rewriting in place.

## Adapted source paths (enumeration)

The following harness-core source files were ported, generalized, or used as the structural blueprint for the corresponding llmwiki artifact. Paths are relative to each repo's root.

- `harness-core/workflows/academic-source-ingest.md` → adapted into the Slice-2 extractor pipeline that backs `src/lib/extract/*.ts` and the Tauri `extract_fixture` command (Rust-side dispatcher).
- `harness-core/domains/academic/source-extractor.md` → adapted into the Slice-2 candidate-extraction heuristics now living in `src/lib/extract/candidateExtractor.ts`. The role-prompt-style markdown is collapsed into a deterministic rule-based TS module (no LLM call in Slice 2).
- `harness-core/schemas/chunk_extract.schema.json` → adapted into `shared/schemas/candidate_item.schema.json`. The wrapping `chunk_extract` envelope is dropped (Slice 2 emits flat `candidate_items[]`), and the `candidate_type` enum is generalized.
- `harness-core/schemas/knowledge_entry.schema.json` → adapted into `shared/schemas/wiki_entry.schema.json`. The hard-coded `domain` const restriction is dropped; category language is generalized.
- `harness-core/schemas/common.schema.json#/$defs/candidate_type` → restated inline in `shared/schemas/candidate_item.schema.json#/properties/type/enum`. The `biblical_text` enum value is renamed.
- `harness-core/schemas/common.schema.json#/$defs/candidate_action` → restated inline in `shared/schemas/candidate_item.schema.json#/properties/suggested_action/enum`.
- `harness-core/tools/runner/gates/academic-*` (gate scripts) → reviewed but NOT ported in Slice 2 (deterministic-only extraction does not require the gate-orchestration layer yet; the academic gates' run-tree-coupled assumptions do not transfer to the desktop Tauri runtime). Recorded here for traceability; revisit when Slice 3 introduces LLM-assisted extraction.

The list above is exhaustive for Round-2: no other harness-core path was copied into the llmwiki tree during this slice.

## Per-file rationale

### `workflows/academic-source-ingest.md`

**port** as a runtime pipeline shape (raw source → normalized text → chunks → candidates → approval) but **drop** the workflow's Notion-integration affordances, the user-language command interpretation block (which is academic-specific), and the `target_store: local_markdown | notion` axis. llmwiki's Slice-2 surface is a single-user desktop binary that writes only under its own `data/sources/<source_id>/` tree; the academic workflow's authority-order block (canonical wiki / staging / runs / sources / Notion) is collapsed to a flat single-user model in this slice.

### `domains/academic/source-extractor.md`

**restructure** from a role-prompt for an LLM into a rule-based deterministic TS module. The "Extraction Units" enumeration (concept / argument / method / scholar / biblical_text / objection / quotation) is **adapted**: `biblical_text` is **renamed** to `religious_text`; the rest are preserved. The "Rules" section's Catholic-terminology default (line 53 in upstream) is **dropped** entirely — llmwiki Slice 2 is domain-neutral. The Candidate Quality Test ("can this item be reused later without rereading the source chunk?") is **ported** as a documentation comment in `src/lib/extract/candidateExtractor.ts` but not enforced mechanically (Slice 3 LLM-assisted extraction may revive it as a scoring step).

### `schemas/chunk_extract.schema.json`

**restructure**: the upstream envelope groups candidate items inside a `chunk_extract` record keyed by `chunk_id` + `source_id` + `candidate_items[]`, with parallel buckets (`arguments[]`, `concepts[]`, etc.) that are pre-grouped by type. llmwiki Slice 2 **drops** the chunk envelope and the parallel buckets — the desktop UI uploads a single source file at a time, and the parallel buckets duplicate information already encoded in `candidate_items[].type`. The flat shape of `shared/schemas/candidate_item.schema.json` is one candidate per object, validated individually. Required fields are **carried forward verbatim** (`local_candidate_id`, `title`, `type`, `category`, `summary`, `evidence_refs`, `suggested_action`) plus the Slice-2 additions (`source_id`, `span`, `evidence_text`, `page`).

### `schemas/knowledge_entry.schema.json`

**generalize**: the `domain` field is upstream-constrained to `const: "academic"`. llmwiki Slice 2 **drops** that constraint — wiki entries are produced for any user-uploaded source regardless of domain. The `category` field is preserved as a free-form string. The status state machine (`draft|reviewed|verified|deprecated|superseded`) is **carried forward verbatim**. The audit fields (`created_from_run`, `created_from_candidates`, `created_at`, `updated_at`, `review_notes`) are preserved verbatim; subsequent slices may rename `created_from_run` to a generic `created_from_session` if the harness-run concept becomes opaque to llmwiki end users.

### `schemas/common.schema.json#/$defs/candidate_type`

**rename** and **generalize**: the upstream enum value `biblical_text` is renamed to `religious_text` per the contract's domain-generalization clause. All other enum values (`concept|argument|method|scholar|objection|quotation|other`) are preserved verbatim. The enum is restated inline in the Slice-2 schema rather than `$ref`-imported because the upstream `common.schema.json` file is not itself adapted into llmwiki (it carries unrelated Notion-target-store and ai_ops enums).

### `schemas/common.schema.json#/$defs/candidate_action`

**port** verbatim: the five action labels (`augment_existing|create_new|merge|defer|reject`) survive the generalization unchanged.

### `tools/runner/gates/academic-*`

**drop** for Slice 2. The academic gate scripts orchestrate per-chunk evaluation phases against the harness `runs/<run_id>/` tree; they assume a multi-pass LLM evaluation loop that Slice 2's deterministic extraction does not need. Revisit in Slice 3 alongside LLM-assisted extraction.

## Schema diff: chunk_extract → candidate_item

The diff below shows field-level deltas between `harness-core/schemas/chunk_extract.schema.json` (upstream) and `llmwiki/shared/schemas/candidate_item.schema.json` (adapted). Italic fields are inherited from `candidate_items[].properties` in the upstream envelope.

| Field | harness-core | llmwiki | Change |
| --- | --- | --- | --- |
| envelope | `chunk_extract` object wrapping `candidate_items[]` plus parallel buckets | one candidate object per record | restructure: drop envelope |
| `chunk_id` | required at envelope | not present | drop (no chunking in Slice 2) |
| `source_id` | required at envelope | required per candidate | restructure: move down |
| `arguments[]`, `concepts[]`, `scholars[]`, `methods[]`, `biblical_texts[]`, `objections[]`, `quotations[]` | parallel optional arrays | dropped | drop (type-keyed buckets duplicate `candidate_items[].type`) |
| _`local_candidate_id`_ | required string | required string | port verbatim |
| _`title`_ | required string | required string + maxLength 240 | port + tighten |
| _`type`_ enum | `concept | argument | method | scholar | biblical_text | objection | quotation | other` | `concept | argument | method | scholar | religious_text | objection | quotation | other` | rename: `biblical_text` → `religious_text` |
| _`category`_ | required string | required string | port verbatim |
| _`summary`_ | required string | required string | port verbatim |
| _`evidence_refs[]`_ | required, minItems 1 | required, minItems 1 | port verbatim |
| _`suggested_action`_ | required enum | required enum | port verbatim |
| _`target_wiki_hint`_ | optional `string | null` | optional `string | null` | port verbatim |
| _`paper_relevance`_ | optional boolean | dropped | drop (academic-paper-specific) |
| `source_id` (candidate-level) | not present | required string | add (Slice-2: per-item provenance) |
| `page` | not present | optional integer ≥ 1 | add (Slice-2: PDF page reference) |
| `span` | not present | required `{start, end}` integers | add (Slice-2: precise char offsets) |
| `evidence_text` | not present | required string | add (Slice-2: verbatim source fragment) |

## Schema diff: knowledge_entry → wiki_entry

Field-level diff between `harness-core/schemas/knowledge_entry.schema.json` and `llmwiki/shared/schemas/wiki_entry.schema.json`.

```diff
- "domain": {"type": "string", "const": "academic"}    # harness-core
+ (field dropped)                                       # llmwiki Slice 2
  "category": {"type": "string"}                        # port verbatim
  "status": enum[draft|reviewed|verified|deprecated|superseded]   # port verbatim
  "title": {"type": "string", "minLength": 1}           # tighten minLength
  "summary": {"type": ["string", "null"]}               # port verbatim
  "source_ids": array of string                         # port verbatim
  "evidence_refs": array of string                      # port verbatim
  "original_terms": array of string                     # port verbatim
  "tags": array of string                               # port verbatim
  "related": array of string                            # port verbatim
  "created_from_run": string|null                       # port verbatim
  "created_from_candidates": array of string            # port verbatim
  "created_at": string|null                             # port verbatim
  "updated_at": string                                  # port verbatim (required)
  "review_notes": string|null                           # port verbatim
- "id": {"type": "string"}                              # required in both
+ "id": {"type": "string"}                              # port verbatim
```

Single substantive delta: the `domain: const "academic"` constraint is dropped. All other field shapes are preserved bit-for-bit so future re-sync from harness-core can mechanically reconcile the schemas via a string-replace + drop pair.

## What was NOT adapted

The following harness-core artifacts were intentionally NOT ported in Slice 2 even though they exist in the upstream tree; the explicit non-adaptation entries below close the audit loop:

- `harness-core/domains/academic/candidate-evaluator.md` — LLM-driven candidate ranking; Slice 2 is deterministic-only.
- `harness-core/domains/academic/wiki-committer.md` — Notion + canonical-promotion machinery; out-of-scope for the desktop binary.
- `harness-core/schemas/staging_entry.schema.json` — staging-area state machine; Slice 2 promotes directly from candidate → wiki without an intermediate staging tier.
- `harness-core/schemas/source_manifest.schema.json` — multi-source manifest; Slice 2 operates on one upload at a time and re-derives source provenance from `source_id` directly.

These are listed so a future re-sync explicitly considers whether each becomes in-scope.

## Policies enforced across all slices

- **No upstream-write policy** (AC-9): all work in this repo. The harness-core working tree must never be modified by llmwiki development. Pre/post HEAD checks recorded in `runs/<run_id>/harness_core_head_pre_*.txt` and `harness_core_head_post_*.txt`.
- **Adapted-file freshness**: when re-syncing from a newer harness-core HEAD, every rationale entry above must be re-verified against the new upstream file. Rows whose upstream commit hash changed need an explicit re-review entry (append, do not overwrite).
- **No silent verbatim copies**: a rationale entry in §Per-file rationale is required before merging any file that was copied or substantially derived from harness-core. Code review checklist enforces this.
- **Schema-diff discipline**: any schema change from upstream must list every field touched. A diff section with empty body is invalid and fails the `T1-adaptation-log-structure-check` Tier-1 scenario.

## Cross-references

- `agreed_contract.json` (Slice 2, run `run_20260521_093931_p5_sw_llmwiki_slice2`).
- `contract_proposal_v2.md` (Round-2 proposal narrative; same run).
- `r2_step_log.txt` (Round-2 implementation step log; same run).
- `implementation_manifest.json` (Round-2 closeout boundary artifact; same run).
- Slice-1 closeout: `runs/run_20260520_000001_p5_sw_llmwiki_extract_split/final_evaluation.json`.
