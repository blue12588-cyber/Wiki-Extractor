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

## Slice 3 adaptation (Round-3)

**Status**: SUBSTANTIVE (Slice 3). Slice 3 re-syncs from a newer harness-core HEAD
and re-introduces the academic-domain semantics that Slice 2 deliberately
generalized away (Catholic terminology, the 7-type extraction units, the
candidate-evaluator, the wiki-committer local_markdown target).

### Upstream pin (Slice 3)

- **upstream repository**: `harness-core` (read-only; `\\wsl.localhost\ubuntu-24.04\home\user\harness-core`).
- **upstream HEAD pinned during Slice 3 work**: `03538cfe2cdafd809ba92cbf2e9f4035245f4d21`.
- **upstream branch**: `master`.
- **write policy**: zero writes outside `D:\AI Project\llmwiki\**` and `runs/<run_id>/`. AC-9 pre/post HEAD equality holds.

### Adapted source paths (Slice 3 enumeration)

- `harness-core/workflows/academic-source-ingest.md` §"Step 2. Chunk" → `src/lib/chunk/chunker.ts`. The semantic-boundary chunking rules (heading / paragraph cluster / oversize internal split) are ported into a deterministic TS module that writes `data/sources/<id>/chunks.jsonl` (AC-CHUNK). The upstream's Notion authority-order, HITL stops, and commit-plan lifecycle are NOT ported (single-user desktop, no canonical-promotion tier in this slice).
- `harness-core/domains/academic/source-extractor.md` → `src-tauri/src/llm_cmd.rs::EXTRACT_SYSTEM_PROMPT`. The role prompt (7 extraction units, "reusable knowledge candidate", evidence-required, candidate quality test) is ported into an LLM system prompt (Slice 2's deterministic TS module is RETAINED as the offline fallback). `biblical_text` stays renamed to `religious_text` per the Slice-2 generalization, kept for schema compatibility.
- `harness-core/domains/academic/candidate-evaluator.md` → `src-tauri/src/llm_cmd.rs::CLASSIFY_SYSTEM_PROMPT`. The evaluator's review criteria (standalone reuse value, evidence quality, duplication risk, action recommendation) are ported and re-aimed at the user-supplied outline-node classification (AC-CLASSIFY-MAP). Slice 2 had marked this file "NOT adapted"; Slice 3 supersedes that entry.
- `harness-core/domains/academic/writing-guidance.md` §"Catholic Terminology" → `src-tauri/src/llm_cmd.rs::TRANSLATE_SYSTEM_PROMPT`. The Catholic-standard-terminology default and the Protestant-term prohibition are ported verbatim in intent (의화 not 칭의, 은총 not 은혜, 판관기/마르코 복음/마태오 복음 Catholic book names). The "preserve source titles / metadata / direct quotations" exception is honored by the ORIGINAL-TEXT-PRESERVATION invariant: translation is a SEPARATE field (`WikiClaim.translated_text`); `WikiClaim.original_text` is never mutated (AC-TRANSLATE + AC-ANNOTATION). Slice 2 had explicitly DROPPED the Catholic-terminology default ("llmwiki Slice 2 is domain-neutral"); Slice 3 re-introduces it for the academic wiki path.
- `harness-core/domains/academic/wiki-committer.md` + `harness-core/knowledge/academic/wiki/**` layout → `src-tauri/src/wiki_cmd.rs` + `src/lib/wiki/*.ts`. The local_markdown target store (`<entry>.md` + `index.json` + `links.json`) is ported as the persistent, EDITABLE wiki store under `data/wiki/` (AC-WIKI-PERSIST + AC-EDIT-PERSIST). The HITL approval gate, staging tier, commit_plan/commit_result lifecycle, and Notion target are NOT ported — the desktop single-user app persists directly from candidate → editable entry (entries enter as `draft`). Slice 2 had marked wiki-committer "NOT adapted"; Slice 3 supersedes that for the local_markdown structure only.

### Original-text preservation (HARD invariant)

`WikiClaim.original_text` is a verbatim slice of the source `evidence_text`; it is never altered by translation. The Catholic-terminology Korean translation lives only in `WikiClaim.translated_text`. The annotation UI (`ClaimAnnotation.svelte`) shows translated-original ABOVE and untranslated-original BELOW (AC-ANNOTATION). This satisfies the upstream "preserve direct quotations / original-language labels exactly" exception while still defaulting prose to Catholic terminology.

### LLM auth + model abstraction (AC-LLM-EXTRACT)

- Model id (`gpt-5.4`, a user-specified value) + endpoint template live in `src-tauri/llm.config.json` (config single source). The abstraction seam is `LlmConfig` + `resolve_base_url()`; swapping models is a config edit.
- Auth = OAuth subscription flow (OpenClaude/Hermes pattern) via the existing `oauth_child` loopback endpoint (`http://127.0.0.1:<port>/v1`). The child injects the subscription bearer token, so `llm_cmd.rs` never reads the auth file (keeps the AC-7-relaxed boundary intact — `external_dep_paths.rs` remains the SOLE OS-user-dir module). Logic is WIRED; real call operability is NOT guaranteed (contract: "막히면 Codex 협의").
- Graceful degradation: every LLM command returns `Result<.., LlmError{degraded}>`. On auth/call failure the renderer keeps view/edit/save fully working (offline path is FS-only); only extraction/classification/translation are blocked with a Korean message. The app never crashes.

### Korean UI scope note

All Slice-3 surfaces (upload, outline, candidates, wiki editor, annotations, notices) are Korean (AC-KOREAN-UI). The Slice-2 `DisclosureBanner.svelte` legal/security phrases are LEFT in English: they are a verbatim-pinned legal disclosure tied to the upstream openai-oauth README and are asserted by the `T1-banner-mount-and-disclosure-text` regression scenario. Korean-izing them would (a) break that regression and (b) drift from the legally-significant source wording. Recorded here as a scoped exception; a future slice may add a Korean translation row WITHOUT removing the pinned English phrases.

### What was NOT adapted (Slice 3)

- HITL approval gate / `HITL_KNOWLEDGE_COMMIT` stop — the desktop app has no orchestrator-mediated approval loop; entries persist as `draft` directly and the user edits/saves freely.
- `knowledge/academic/staging/**` staging tier, `commit_plan.json` / `commit_result.json`, `promotion_checklist.md` — no canonical-promotion lifecycle in this slice.
- Notion target store — out of scope (contract exclude).
- `source_quality_check.json` preflight / OCR anchors — Slice 3 inputs are the same plaintext/MD/PDF as Slice 2; OCR/EPUB/HWPX remain excluded.

## Slice 5a adaptation (rule-based candidate engine + candidate cards)

**Status**: SUBSTANTIVE (Slice 5a). Slice 5a adds an OFFLINE, deterministic
rule-based candidate-scoring engine and a candidate-card UI on top of the
Slice-4 app. NO LLM, NO network — the slice is the "일반인 MVP (오프라인)"
half of the Codex-discussed hybrid architecture (the ChatGPT copy-paste bridge
is Slice 5b; the codex/openai-oauth hybrid is Slice 5c, both out of scope here).

### Upstream pin (Slice 5a)

- **upstream repository**: `harness-core` (read-only; `\\wsl.localhost\ubuntu-24.04\home\user\harness-core`).
- **upstream HEAD pinned during Slice 5a work**: `03538cfe2cdafd809ba92cbf2e9f4035245f4d21`.
- **upstream branch**: `master`.
- **write policy**: zero writes outside `D:\AI Project\llmwiki\**` and `runs/<run_id>/`. AC-9 pre/post HEAD equality holds (Slice 5a makes ZERO harness-core writes; all engine logic is re-implemented in the target tree).

### Adapted source paths (Slice 5a enumeration)

- `harness-core/domains/academic/source-extractor.md` §"Candidate Quality Test" + §"Extraction Units" → `src/lib/candidate/scoringEngine.ts` (criterion 4 재사용성 + the type-as-knowledge-unit signal) and `src/lib/candidate/claimVerbs.ts` (criterion 2 주장 강도). The upstream role prompt asks an LLM to JUDGE whether a chunk is a reusable knowledge unit / asserts a claim; Slice 5a **collapses that judgement into deterministic rules** — a bilingual assertion-verb lexicon (`claimVerbs.ts`) and a type/heading-proximity heuristic (`scoringEngine.ts::scoreReusability`). The "can this be reused without rereading the chunk?" test is realized as the reusability sub-score, not a prose check. NO model call.
- `harness-core/domains/academic/candidate-evaluator.md` §"Review Criteria" + §"Action Guidance" → `src/lib/candidate/scoringEngine.ts` (criteria 3 근거 품질, 5 새로움/중복, 6 경계; the create_new/update_existing/link_only/ignore classifier) and `src/lib/candidate/demotePatterns.ts` (the `reject`-when-"not reusable"/"too source-specific" judgement, realized as a footnote/bibliography/toc/index/copyright regex layer). Slice 3 had ported this file's review criteria into an LLM `CLASSIFY_SYSTEM_PROMPT`; Slice 5a **re-ports the SAME criteria as a deterministic offline scorer** so the app produces classified candidates with no LLM. The upstream action labels are RE-AIMED for the user-facing card: `augment_existing` → `update_existing`, `defer`/`reject` collapse into `ignore` (and the structural-demotion override), `merge` is deferred (5a does not auto-merge — the user decides per card). This is a label re-aim, recorded here so a future re-sync reconciles the two action vocabularies.
- `harness-core/knowledge/academic/index.json` record shape (`title` / `tags` / `original_terms` / `summary` / `related`) → `src/lib/candidate/keywordMatch.ts` + `scoringEngine.ts::scoreNovelty`. The upstream wiki uses these fields as its relatedness/identity surface; Slice 5a reuses the SAME surface for a deterministic token-overlap (Jaccard) similarity — NO embeddings, NO `embedding_ref`, NO LLM. The dedup/novelty check (AC-DEDUP) compares a candidate's `title + summary` against each existing `WikiEntry`'s `title + tags + summary`.
- `harness-core/knowledge/academic/wiki/*.md` section layout (Claim / Evidence / Synthesis / Boundaries / Links) → `src/lib/components/CandidateCard.svelte`. The card's rows map onto that structure: 왜 후보인가 = Claim + Synthesis, 근거 = Evidence (chunk_id + page), 주의 = Boundaries. Links/related surface as the update/link "대상" row. The Slice 5a card does NOT render the wiki entry itself (that is the existing WikiTab); it renders the PROPOSAL to create/augment/link one.

### Score-hidden UX (Codex guidance)

The six per-criterion sub-scores and the internal total are computed in
`scoringEngine.ts` but are **never bound in any Svelte component**. The card
shows only the recommended action, the target (for update/link), the
human-readable rationale ("왜 후보인가"), the evidence locator, and the
boundary/demotion notes. The `T1-slice5a card-shape` scenario asserts the
UI-facing fields exist; the absence of any `{total}`/`{sub}` binding in the
component source is the structural guarantee that scores stay hidden.

### Determinism + offline (AC-RULE-ENGINE / AC-OFFLINE)

Every Slice-5a engine module (`scoringEngine`, `candidateEngine`, `claimVerbs`,
`demotePatterns`, `keywordMatch`) is a PURE function of its inputs: no
`Date.now()`, no randomness, no I/O. The `T1-slice5a offline-no-network`
scenario statically asserts none of these modules reference `fetch`,
`XMLHttpRequest`, `WebSocket`, `invoke(`, the LLM client, or any URL — the
engine cannot reach the network or the model by construction.

### What was NOT adapted (Slice 5a)

- `harness-core/domains/academic/candidate-evaluator.md` §"merge" guidance — Slice 5a does not auto-merge candidates; the per-card 승인/보류/폐기 decision is the user's. Merge may return in a later slice.
- `harness-core/schemas/candidate.schema.json` `evaluation` object / `duplication_risk` numeric fields — Slice 5a keeps scores internal and does not persist a candidate-queue file; the card decisions are in-memory for 5a.
- The ChatGPT copy-paste prompt body (Slice 5b) — the card's "ChatGPT 프롬프트 복사" button is a DISABLED placeholder in 5a; its prompt format is a deferred question.

## Slice 5b adaptation (ChatGPT copy-paste bridge)

**Status**: SUBSTANTIVE (Slice 5b). Slice 5b adds the ChatGPT copy-paste bridge
on top of the Slice-5a offline candidate engine: the app builds a prompt the
user copies into chatgpt.com, then validates the JSON ChatGPT returns and
imports passing candidates into the wiki. The app NEVER calls the LLM itself
(that is Slice 5c codex/openai-oauth, out of scope here); 'ChatGPT 열기' is OS
browser delegation only. No auth, no API key.

### Upstream pin (Slice 5b)

- **upstream repository**: `harness-core` (read-only; `\\wsl.localhost\ubuntu-24.04\home\user\harness-core`).
- **upstream HEAD pinned during Slice 5b work**: `fb9c33392410b764d70657da4415a9ffa79b4538`.
- **upstream branch**: `master`.
- **write policy**: zero writes outside `D:\AI Project\llmwiki\**` and `runs/<run_id>/`. AC-9 pre/post HEAD equality holds (Slice 5b makes ZERO harness-core writes; the prompt schema + validation rules are re-expressed in the target tree). A parallel SW gate track may advance the harness-core HEAD during this run; that is external and is NOT a Slice-5b write — the invariant is that THIS run touches nothing under the harness-core working tree.

### Adapted source paths (Slice 5b enumeration)

- `harness-core/domains/academic/source-extractor.md` (role-prompt shape: "use only the supplied chunks", "do not guess", "evidence required by chunk_id") → `src/lib/bridge/promptBuilder.ts` `ROLE_BLOCK`. The upstream LLM role instructions are **re-expressed as the user-copyable prompt text** the bridge generates. The Catholic-terminology default (from `writing-guidance.md`, already adapted in Slice 3) is **carried into the prompt** as the explicit "한글 번역은 가톨릭 용어 우선(개신교 번역 금지)" line. The app does not run the prompt — the USER pastes it into chatgpt.com.
- `harness-core/domains/academic/candidate-evaluator.md` §"evidence quality" / "evidence required" → `src/lib/bridge/responseValidator.ts`. The upstream's "every candidate must cite real evidence" criterion is **mechanized as the anti-forgery binding gate**: every `evidence[].chunk_id` in the pasted reply must exist in the REAL uploaded `chunks.jsonl`; any unknown chunk_id rejects the candidate. This is stricter than the upstream prose check (it is a hard, deterministic gate) because a pasted LLM reply is untrusted input.
- `harness-core/knowledge/academic/wiki/*.md` structure (Claim / Evidence / Synthesis / Boundaries / Links) + the Slice-3 `WikiClaim` original-text-preservation invariant → `src/lib/bridge/wikiImport.ts`. A validated ChatGPT candidate becomes a draft `WikiEntry`: `WikiClaim.original_text` is the **verbatim source chunk text** (resolved by chunk_id from the real uploaded chunks — NOT the ChatGPT-authored `quote`), the Catholic-terminology `summary_ko` goes into the separate `translated_text` field, and `evidence_refs` bind to the real chunk_id. This reuses the Slice-3 `wikiStore.saveEntryAndIndex` + `ClaimAnnotation` UI unchanged.

### Anti-forgery evidence binding (HARD gate)

A pasted ChatGPT reply can hallucinate fake chunk_ids. `responseValidator.validateResponse(parsed, knownChunkIds)` cross-checks every `evidence[].chunk_id` against the set of chunk_ids actually present in the uploaded source's `chunks.jsonl`. A candidate with ANY unknown chunk_id is marked NOT importable with a Korean 위조-차단 message; only fully-bound candidates can enter the wiki. The `T1-slice5b evidence-bind` scenario asserts a forged chunk_id is rejected and a real one is accepted.

### App-never-calls-LLM (5b scope boundary)

The four bridge modules (`promptBuilder`, `responseParser`, `responseValidator`, `wikiImport`) are PURE functions of their inputs — no `fetch`, no `invoke`, no LLM client, no URL. The `T1-slice5b offline-no-network` scenario asserts that statically. The single network-adjacent action is `window.open('https://chatgpt.com/')` in `BridgePanel.svelte` (AC-COPY 'ChatGPT 열기'), which delegates a user-initiated navigation to the OS default browser — the app issues no HTTP request of its own. The clipboard copy uses the OS clipboard (`navigator.clipboard`) only. Introducing a direct ChatGPT/OpenAI API call would be a Slice-5b scope violation (it is the deferred Slice 5c).

### What was NOT adapted (Slice 5b)

- `harness-core/domains/academic/wiki-committer.md` HITL approval gate / Notion target — the imported entry persists directly as `draft`; the user approves/holds/discards per the existing card flow.
- Auto LLM call / codex / openai-oauth hybrid — deferred to Slice 5c (contract `deferred_questions`).
- Custom GPT template provisioning — the bridge supplies the prompt text only; creating a Custom GPT is a manual user action (contract exclude).

## Slice 5b repair (defense-in-depth hardening; non-blocking)

**Status**: REPAIR on top of Slice 5b (run `run_20260523_000006_sw_llmwiki_slice5b`, verdict pass / blocking 0). Three Evaluator-flagged non-blocking robustness notes were hardened. No AC behaviour changed for the passing single-source flow; the anti-forgery gate and original-text preservation are unchanged-or-stronger. Write scope: `D:\AI Project\llmwiki\**` only; harness-core read-only.

1. **Source-scoped evidence binding** — `actions.ts` `bridgeKnownChunkIds()` and the original-text restoration chunk pool in `importBridgeCandidate()` are now scoped to the OPEN candidate's own `source_id` (via `chunksForSource`). Evidence can only bind within the source the candidate came from; in a multi-source session a real chunk_id from a *different* loaded source is treated as unknown (rejected), so `entry.source_ids` and the evidence refs never disagree. Single-source flow is unchanged.
2. **Rejected-evidence quarantine** — `responseValidator.ts` now keeps bound evidence on `ValidatedCandidate.evidence` and routes forged/empty refs (with their model-authored quote) into a SEPARATE `rejectedEvidence: RejectedEvidence[]` carrying only `claimed_chunk_id` + Korean `reason`. A forged ref can never be read off `evidence` downstream even if a future caller forgets the `importable` guard. `BridgePanel.svelte` renders bound refs from `evidence` and rejected refs (red) from `rejectedEvidence`.
3. **Fallback hard-refusal** — `wikiImport.ts` `claimsFor` no longer silently substitutes the ChatGPT quote into `original_text` when a chunk is unresolvable. It now THROWS (`원문 복원 실패…`), so the model-authored quote can never become the preserved-original on any code path.

New smoke scenarios (in `fixtures/t1-slice5b-smoke.mjs`): `source-scope`, `rejected-evidence`, `fallback-refusal`; `evidence-bind` was extended to assert the forged ref is quarantined off `evidence`. All 10 slice5b scenarios + slice3/4/5a regression + static-scan green; svelte-check 0 errors (1 pre-existing node-types warning); tauri build exit 0.

## Slice 5c — hybrid auto-LLM mode (codex + openai-oauth, ima2 pattern ported)

**Status**: SUBSTANTIVE (Slice 5c, run `run_20260523_000007_sw_llmwiki_slice5c`). Adds the advanced/auto-LLM provider on top of the 5b copy-paste bridge. Default stays copy-paste (common-person); auto LLM is an opt-in for codex-authenticated advanced users. Write scope: `D:\AI Project\llmwiki\**` only; harness-core read-only (this run writes 0 to harness-core). codex `~/.codex/auth.json` is READ-ONLY detection only (never written/parsed). Network in auto mode is the openai-oauth loopback proxy (127.0.0.1) only; copy-paste mode = 0.

### Adapted source (ima2-gen, NOT harness-core)

The OAuth machinery is ported from `ima2-gen` (`D:\AI Tools\npm-global\node_modules\ima2-gen\lib`), not from harness-core. Recorded here for traceability since it crosses the project boundary:

- `ima2-gen/lib/codexDetect.js` (file-presence OR `codex login status` probe; "file absence ≠ unauth" because auth may live in the OS keyring) → `src-tauri/src/codex_detect.rs`. **Adapted**: the auth-path resolution is NOT duplicated — it is delegated to the existing AC-7-relaxed module `external_dep_paths::auth_file_present` (the SOLE module allowed to touch `~/.codex`), so `codex_detect.rs` introduces ZERO forbidden OS-user-dir tokens (T1-static-scan clean). The probe runs `codex login status` with stdio fully ignored (read-only), bounded by a 2.5s timeout so a hung binary cannot stall the auth poll. `available = auth_file_present || probe==authed`.
- `ima2-gen/lib/oauthLauncher.js` (`startOAuthProxy`: spawn `npx openai-oauth --port <P>`, parse ready URL from stdout, restart-on-exit) → the Round-2 spawn body of `src-tauri/src/oauth_child.rs::spawn_oauth_child`. **Adapted**: the Round-1 scaffold's `parse_ready_line` + `ChildStatus` + `oauth_child_status` command are now backed by a real `tokio::process` spawn that scans stdout AND stderr for the loopback `/v1` ready line, with a 12s timeout → `ReadyLineGrammarMismatch` (orchestrator stop_condition) and early-exit/spawn-error → `Degraded` (graceful). ima2's infinite restart-on-exit loop is intentionally NOT ported — a single bounded attempt is contract-aligned (a missing ready line routes to a stop_condition rather than spinning).
- `ima2-gen/lib/oauthProxy.js` (`generateViaOAuth`: POST to `http://127.0.0.1:<port>/v1/responses`, SSE stream) → the transport shape reused in `src-tauri/src/llm_cmd.rs::chat_completion` (already wired in Slice 3 against the loopback `/v1` base resolved from `oauth_child_status`). **Adapted**: ima2 streams an *image* result; llmwiki needs *text* extraction, so the new `llm_extract_wiki` command posts the 5b prompt and returns the raw model TEXT (no image/SSE-image parsing). The model id + endpoint template stay in `src-tauri/llm.config.json` (single source).

### Provider abstraction (AC-AUTH-ABSTRACT + AC-ENCAPSULATE)

The openai-oauth/codex/ima2 details are encapsulated entirely behind one interface (`src/lib/llm/provider.ts::ExtractionProvider`). Three providers: `offline` (copy-paste, 5b — default, always available, zero network), `codex_oauth_proxy` (auto, available when codex detected), `future` (API-key placeholder, never available). The rest of the app (`BridgePanel`, `MainTab`, `ModeToggle`) talks only to `ProviderId` + `ExtractionProvider`, so removing/swapping the codex path is a localized change. `src/lib/llm/registry.ts` maps id→instance; `src/lib/llm/modeStore.svelte.ts` holds the detect snapshot + the user's selected mode (default `offline`; an unavailable selection collapses to `offline` via `effectiveProviderId()`).

### Anti-forgery gate REUSED, not re-implemented (AC-EVIDENCE-REUSE)

`src/lib/llm/autoExtract.ts` is the single seam: it runs the SAME 5b pipeline — `buildPrompt` → `provider.runExtraction` → `parseResponse` → `validateResponse(parsed, knownChunkIds)` — so an auto LLM reply is bound by the IDENTICAL chunk_id anti-forgery validator a manual paste uses. A hallucinated chunk_id from the auto LLM is rejected exactly like a forged one from a manual paste; the validator and the original-text-preserving import (`buildEntryFromValidated`) are imported UNCHANGED. The `T1-slice5c auto-evidence-reuse` + `auto-import-preserve` scenarios assert this.

### Graceful degradation (AC-GRACEFUL)

Every auto failure path (no Tauri shell / codex absent / proxy not ready / call failed / malformed reply) returns a `degraded` result with a Korean message; the caller falls back to the 5b copy-paste UI. `ExtractionProvider.runExtraction` and `autoExtractCandidate` NEVER throw and NEVER yield importable data on failure. The common-person always has copy-paste. The `T1-slice5c auto-graceful` + `offline-provider-noop` scenarios assert no-throw + degraded-Korean + no-importable-leak.

### Dependency note (lockfile)

`src-tauri/Cargo.toml` adds an explicit `tokio` dependency with features `process`, `io-util`, `time`, `macros`, `rt` (for the async child spawn + line-reader + `select!` timeout). tokio was already a transitive tauri dependency pinned at 1.52.3; declaring it directly only ENABLES features (Cargo feature unification reuses the locked version). The lockfile gained three feature-deps (`tokio-macros`, `signal-hook-registry`, `errno`) — feature-driven additions, not a version change.

### What was NOT adapted (Slice 5c)

- ima2's image-generation prompt/SSE pipeline (REAL_PERSON_RESEARCH_DIRECTIVE, partial-image streaming, multimode) — llmwiki does text extraction only.
- ima2's infinite restart-on-exit proxy loop — replaced with a single bounded spawn + graceful degrade.
- API-key provider — `future` is a never-available placeholder only (contract: contract_refresh_required_when API key mode is actually implemented).
- Bundling codex/Node into the app — advanced users supply their own (contract exclude).

New smoke scenarios (`fixtures/t1-slice5c-smoke.mjs`): `provider-availability`, `auto-evidence-reuse`, `auto-graceful`, `offline-provider-noop`, `auto-import-preserve`, `encapsulation-scan`, `ready-line-parse` — all green. 5b regression (all 10 scenarios) + static-scan green; svelte-check 0 errors (1 pre-existing node-types warning); 20 Rust lib tests pass (4 new codex_detect); live `codex login status` exit 0 + live `npx openai-oauth` spawn returned `http://127.0.0.1:<port>/v1` with `GET /v1/models` HTTP 200 (codex-oauth model list); tauri build exit 0 (app.exe + msi + nsis bundled).

## Slice 6 — codex login button + sticky sidebar + usage tab

**Status**: SUBSTANTIVE (Slice 6, run `run_20260523_000008_sw_llmwiki_slice6`). Adds
three things on top of the 5c hybrid: (1) a GUI **[ChatGPT로 로그인]** button that
spawns `codex login` (browser ChatGPT OAuth — no CLI typing), (2) a `position:sticky`
sidebar so the tabs stay visible while the main content scrolls, and (3) a fifth
**사용법** tab (between 로그인 and 피드백) with step-by-step guidance for non-experts.
Default stays copy-paste; codex login is opt-in for advanced users. Write scope:
`D:\AI Project\llmwiki\**` only; harness-core read-only (this run writes 0 to
harness-core).

### Upstream pin (Slice 6)

- **upstream repository**: `harness-core` (read-only; `\\wsl.localhost\ubuntu-24.04\home\user\harness-core`).
- **upstream HEAD observed at Slice 6 start**: `b381f880dd5b2d572c8191cbc79254bfada56833` (a parallel SW gate track may advance this during the run; that is external and is NOT a Slice-6 write — the invariant is that THIS run touches nothing under the harness-core working tree).
- **upstream branch**: `master`.
- **write policy**: zero writes outside `D:\AI Project\llmwiki\**` and `runs/<run_id>/`. AC-9 pre/post HEAD equality holds.

### App-auth-write-0 (HARD boundary — the central Slice-6 invariant)

The login button **spawns `codex login` only**; the app NEVER opens, reads,
parses, copies, or writes the codex auth file. codex performs the browser OAuth
round trip and writes `~/.codex/auth.json` itself, OUTSIDE this app's tree. The
new `src-tauri/src/codex_login.rs` therefore (a) contains ZERO file-write APIs,
(b) does NOT reference the `auth.json` path literal in code (only the boundary
doc-comment mentions it), and (c) introduces ZERO AC-7-relaxed OS-user-dir tokens
— it delegates the post-login read-only re-detect to `codex_detect::detect_codex`,
which in turn delegates the only auth-path stat to `external_dep_paths` (the SOLE
AC-7-relaxed module). The `T1-slice6 login-no-authwrite` scenario asserts all three
statically (pulling the forbidden-token pattern from the Rust sentinel so the
fixture itself stays T1-static-scan clean).

### Adapted source (ima2-gen / codex CLI, NOT harness-core)

The login-spawn pattern continues the Slice-5c ima2 lineage (recorded for
cross-boundary traceability):

- `codex` CLI `login` subcommand (browser ChatGPT OAuth; `--device-auth` device-code
  variant) → `src-tauri/src/codex_login.rs::spawn_codex_login`. **Adapted** from the
  oauth_child spawn convention (Windows `cmd /C` shim resolution, piped stdout/stderr
  line scan, `tokio::process` + `select!` bounded wait). The wait is generous (150s,
  human-paced browser OAuth) but finite → on expiry we return a graceful `Pending`
  (NOT a kill: the codex child finishes in the background and the user re-checks with
  the existing "다시 검출"), so the app never blocks. A device-code/URL line emitted by
  codex is surfaced to the user as Korean guidance (`looks_like_verification`
  heuristic; the auth TOKEN is written by codex to auth.json and never printed on
  this path). The `--device-auth` flag was verified to exist in the installed codex
  build.

### Provider/state abstraction reuse (AC-LOGIN-STATE-REFRESH)

The button is wired through the SAME provider/store seam as 5c: a new
`provider.ts::startCodexLogin` (typed wrapper over the `codex_login_start` Rust
command, mirroring the `LoginOutcome` serde enum) + a `modeStore.svelte.ts::
loginWithChatGPT` action. On an `authed` outcome the action applies the carried
read-only detect snapshot so the login tab flips unauthed→authed and the auto-mode
radio becomes selectable — it does NOT auto-select auto mode (the user still opts
in; only AVAILABILITY changes). On `pending` it runs a read-only `refreshDetect()`
so a meanwhile-completed flow is picked up. `cli_missing`/`failed` show a Korean
message only; copy-paste stays the default. Every path is non-throwing and ends
with a Korean `loginMessage` (AC-GRACEFUL + AC-KOREAN-UI).

### Sticky sidebar (AC-STICKY-SIDEBAR)

`+layout.svelte` `.sidebar` becomes `position:sticky; top:0; align-self:start;
max-height:100vh; overflow-y:auto`. `align-self:start` is the load-bearing detail:
without it the grid row stretches the sidebar to full content height and sticky has
nothing to stick within. The capped height + internal scroll handle a viewport
shorter than the tab list without clipping a tab off-screen. `.app-shell` gains
`overflow-x:hidden` (가로 스크롤 0). Pure CSS; no JS scroll listener.

### Usage tab (AC-USAGE-TAB) — non-expert audience

`src/lib/components/views/UsageTab.svelte` is a pure read-only guidance screen (no
state/network/persistence). Four numbered steps (①원서 넣기 → ②후보 자동 추출 →
③ChatGPT로 정리 → ④위키 검토·저장). Step ③ splits into two branches presented as
equivalent: **방법 A 복사·붙여넣기 (기본·누구나)** and **방법 B 자동 처리 (선택·로그인하면)**,
with an explicit "로그인하지 않아도 방법 A로 모두 쓸 수 있다" (codex 강요 0). Internal
jargon (oauth/tauri/chunk_id/openai-oauth/svelte) is kept OUT of the copy — the
`T1-slice6 usage-content` scenario asserts its absence. `tabs.ts` adds the `usage`
tab between `login` and `feedback` with a distinct `book` shape glyph (color-blind
cue preserved); the Slice-4 nav fixture's 4-tab order assertion is EVOLVED to the
Slice-6 5-tab order (the contract supersedes it).

### What was NOT adapted (Slice 6)

- Auto-installing codex for users without it — `cli_missing` shows guidance only (contract: codex 강요 0; 기본 복붙).
- Guaranteeing real OAuth success — the spawn is wired; a cancelled/blocked browser flow is graceful degradation to copy-paste, not a crash (contract: 작동 미보장).
- API-key login (`--with-api-key` exists in codex) — out of scope (`future` placeholder; contract_refresh_required_when API key mode is implemented).
- Korean-izing the pinned English `DisclosureBanner` legal phrases (unchanged Slice-3 scoped exception).

New smoke scenarios (`fixtures/t1-slice6-smoke.mjs`): Tier-1 `tab-order-usage`,
`sticky-sidebar-css`, `login-spawn-graceful`; Tier-2 `usage-content`,
`login-no-authwrite`, `login-button-wired` — all green. Slice 5c (7) + 5b (10) +
nav (2, evolved to 5-tab) + static-scan regression green; svelte-check 0 errors
(1 pre-existing node-types warning); 24 Rust lib tests pass (4 new codex_login).
Live D-class on this PC: `codex login status` → "Logged in using ChatGPT" exit 0,
`~/.codex/auth.json` present (mtime predates this run — app wrote 0), `codex login
--device-auth` flag confirmed present. tauri build: see implementation_manifest.

## Slice 8 — codex login browser-open bug fix + usage outline-first

**Status**: SUBSTANTIVE (Slice 8, run `run_20260523_000010_sw_llmwiki_slice8`).
A UI/auth bug fix on top of Slice 6/7 — no NEW harness-core source was ported;
this slice only refines the Slice-5c/6 codex-auth surface already adapted from the
ima2 `codexDetect`/`oauthLauncher` pattern. Recorded here per the contract's
"every harness-core adaptation recorded … (UI/auth fix면 간략)" clause.

### Upstream pin (Slice 8)

- **upstream HEAD observed at Slice 8 start**: `b381f880` (`harness-core` master). A
  parallel SW gate track may advance this during the run; that is external and is
  NOT a Slice-8 write — THIS run touches nothing under the harness-core working
  tree (writes are confined to `D:\AI Project\llmwiki\**` + `runs/<run_id>/`).

### What changed (Slice 8)

- **detect-first (AC-LOGIN-DETECT-FIRST)**: the login button now runs the
  read-only `codex_detect` BEFORE any spawn. An already-authed machine
  short-circuits — no `codex login` spawn, no browser — and just flips
  availability on with a Korean "이미 로그인" message. This removes the
  "I pressed the button and nothing opened" confusion on a machine that is
  already signed in (the no-browser is correct there).
- **device-auth default + app-opens-browser (AC-LOGIN-DEVICE-BROWSER)**: the
  spawn now defaults to `codex login --device-auth`, which prints a verification
  URL + code regardless of TTY (the piped/no-TTY spawn could not rely on codex
  auto-opening the browser). `codex_login.rs` parses the URL + the `XXXX-XXXX`
  code into a structured `Verification` and opens the URL itself via an
  OS-delegated command (`cmd /C start` / `open` / `xdg-open`) — no OAuth round
  trip, no credential handling; codex still owns auth.json.
- **code UI (AC-LOGIN-CODE-UI)**: ModeToggle shows the code prominently with a
  copy button + an open-URL button (`window.open`, OS-delegated) + a [다시 검출]
  after-login hint. Only the non-secret verification code/URL is surfaced — the
  access token is never on this path (forbidden_side_effects honored).
- **usage outline-first (AC-USAGE-OUTLINE-FIRST)**: UsageTab now leads with a
  목차/스키마-먼저 callout and a five-step order (목차→원서→추출→ChatGPT→위키).

### What was NOT adapted (Slice 8)

- A Tauri opener/shell PLUGIN (and its capabilities + npm dependency) — the app
  already shells out via `Command`, so the OS-delegated `start`/`open`/`xdg-open`
  spawn (Rust) + `window.open` (renderer) is the lighter, dependency-free path the
  contract permits ("Tauri opener plugin 또는 window.open(OS 위임)"). No new
  capability or crate was added.
- Real OAuth success guarantee — unchanged from Slice 6 (graceful degradation to
  copy-paste; codex login 실 OAuth 실패 = 복붙, not a crash).

New smoke scenarios (`fixtures/t1-slice8-smoke.mjs`): Tier-1 `detect-first-wiring`,
`login-graceful`, `usage-outline-first`, `no-token-display`; Tier-2
`device-auth-default`, `url-code-parse`, `code-ui`, `no-authwrite` — all green. The
Slice-6 `device-auth-gui` scenario was updated in place to assert the Slice-8
superseding design (device-auth as the primary path), following the same
slice-supersedes-slice precedent the Slice-6 `sticky-sidebar-css` scenario set when
Slice 7 replaced the sticky sidebar. Slice 6 (9) + Slice 7 (4) + static-scan
regression green; svelte-check 0 errors (1 pre-existing node-types warning); 31
Rust lib tests pass (7 new in codex_login: parse_url, parse_device_code accept/
reject, build_verification split, open_in_browser non-http guard, Verification
serialize). Live D-class on this PC: `codex login status` → authed (the detect-
first path applies — no spawn, no browser, by design); app wrote 0 to auth.json;
access token displayed 0 (only verification code/URL surfaced). tauri build: see
implementation_manifest.

## Slice 8 repair — SEC-URL-INJECTION (blocking) + parse-trust + test-coverage

**Status**: SUBSTANTIVE (Slice 8 repair, run `run_20260523_000010_sw_llmwiki_slice8`).
The Slice-8 review returned `verdict=fail` on one blocking security defect plus two
non-blocking items, all folded into this single repair (Contract unchanged).

- **[blocking] SEC-URL-INJECTION** — `codex_login.rs::open_in_browser` previously
  routed the parsed verification URL through `cmd /C start "" <url>`. Because the
  URL is parsed from UNTRUSTED codex stdout and `cmd.exe` re-parses its command
  line, a token like `https://x.com/&calc` had its `&` interpreted as a command
  separator (CVE-2024-24576 / "BatBadBut" class; Rust std Windows quoting handles
  spaces/quotes but not cmd operators). **Fix**: the open path is now SHELL-FREE on
  Windows — `rundll32.exe url.dll,FileProtocolHandler <url>`, a direct exec of a
  real PE binary (no `cmd.exe`, no `.bat`/`.cmd`, no command-line re-parse). The URL
  is a single opaque argv element. macOS `open` / Linux `xdg-open` already passed
  the URL as a single argv (unchanged). NO new crate, NO Tauri plugin, NO capability
  change (Cargo.toml/Cargo.lock/capabilities unchanged) — `rundll32` needs no
  dependency, whereas `ShellExecuteW` would have required adding a `Win32_UI_Shell`
  feature to a `windows` crate dependency and churned the lockfile.
- **[non-blocking] ROBUST-PARSE-TRUST** — `parse_url` is now strict at the boundary:
  it rejects any token carrying whitespace, ASCII control chars, or shell-significant
  metacharacters (`& | < > ^ " ' ( ) % \` { } ; $ ! \\ ,`), bounds the URL length
  (`MAX_URL_LEN = 512`), and requires the http(s) scheme (`is_safe_url`). The raw
  line is still surfaced verbatim for layouts we cannot split (graceful).
- **Host allow-list (defense-in-depth)** — only a URL whose host is on the codex
  device-auth allow-list (`chatgpt.com`, `openai.com`, `auth.openai.com`, and
  dot-suffix subdomains) is AUTO-OPENED. A well-formed but off-allow-list URL is
  still shown to the user as text (manual copy) but never handed to the OS opener —
  so an unexpected-but-safe host cannot trigger an automatic browser launch
  (AC-LOGIN-GRACEFUL preserved). Look-alike hosts (`chatgpt.com.evil.com`,
  `openai.com.attacker.net`) are correctly excluded by exact-or-dot-suffix matching.
- **[non-blocking] TEST-COVERAGE-SECURITY** — added adversarial-input Rust tests:
  `parse_url_rejects_shell_metacharacter_payloads` (drives `&calc`, `|whoami`,
  `^calc`, a `%`-wrapped env-var probe, `$(calc)`, backticks, `;`, redirection,
  parens/braces, backslash, `!` end-to-end through the parser and asserts `None`),
  `is_safe_url_rejects_whitespace_control_and_overlong`,
  `open_in_browser_refuses_off_allowlist_host` (incl. look-alike hosts),
  `build_verification_neutralizes_hostile_line_end_to_end` (hostile line → no URL
  surfaced, no browser opened, code still parsed, raw preserved), and
  `windows_opener_is_shell_free` (source guard against reintroducing `cmd /C start`).
  The `%`-env-var test probe is assembled at RUNTIME so the literal OS-user-dir token
  never appears as contiguous source text (it would otherwise trip the T1 static-scan
  forbidden-pattern sentinel, which legitimately bans that identifier in code).

The Slice-8 smoke `url-code-parse` + `no-authwrite` scenarios were updated to assert
the new SHELL-FREE shape (rundll32, not `cmd /C start`), the metachar-rejecting
parser, the host allow-list gate, and the presence of the adversarial tests — the
prior assertions hard-coded the now-removed `cmd /C start` string and would otherwise
falsely fail.

**Verification (this repair)**: `cargo test --lib` → 37 passed, 0 failed (codex_login
now 17 tests, +6 over the pre-repair 11; the manifest's "7 new" count referenced only
the Slice-8-added subset). Slice-8 smoke all 8 scenarios green; T1 static-scan 0
violations across 104 files; svelte-check 0 errors (1 pre-existing node-types
warning). Behaviour preserved: detect-first, auth write 0, access-token display 0,
graceful copy-paste degrade, no copy-paste/auto/sidebar regression. tauri build: see
implementation_manifest (`target_commit` slice8-repair).

## Slice 9 — codex detect Windows-`.cmd` bug fix + WSL cross-boundary fallback

**Status**: SUBSTANTIVE (Slice 9, run `run_20260523_000011_sw_llmwiki_slice9`).
A bug-fix + cross-boundary slice on top of Slice 5c/6/8. No NEW harness-core
*source file* was ported; this slice refines the existing codex-auth detection
surface (adapted from the ima2 `codexDetect`/`oauthLauncher` pattern) and
STRENGTHENS the academic source-extraction PROMPT that was already adapted from
`domains/academic/source-extractor.md` + `candidate-evaluator.md`. Recorded here
per the contract's "every harness-core adaptation recorded … (UI/auth fix면 간략)"
clause.

### Upstream pin (Slice 9)

- **upstream HEAD observed at Slice 9 start**: `b381f880` (`harness-core` master).
  A parallel SW gate track may advance this during the run; that is external and
  is NOT a Slice-9 write — THIS run touches nothing under the harness-core working
  tree (writes are confined to `D:\AI Project\llmwiki\**` + `runs/<run_id>/`).
- **upstream branch**: `master`.

### What changed (Slice 9)

- **AC-DETECT-WIN-CMD (the core bug)**: `codex_detect.rs::probe_login_status`
  previously did `Command::new(bin).args(["login","status"])` with `bin` iterating
  `["codex.cmd","codex.exe","codex"]`. On Windows, spawning the `codex.cmd` npm
  shim directly fails — `CreateProcess` cannot execute a `.cmd`/`.bat` shim, only
  `cmd.exe` resolves it — so every candidate erred → `Missing` → a false
  "인증 미설정 / codex CLI 미설치" even with codex installed+authed. **Fix**: the
  Windows probe now routes through `cmd /C codex login status` (a new
  `build_probe_command` helper), the SAME convention the sibling
  `codex_login.rs::build_command` already used. `cmd.exe` resolves the shim and is
  unaffected by PowerShell's ExecutionPolicy (which only gates `.ps1`). Off-Windows
  keeps the direct `Command::new(bin)`. Probe stays fully read-only (stdio null,
  `login status` only) with the bounded `PROBE_TIMEOUT` poll loop intact.
- **AC-DETECT-WSL-FALLBACK**: when the Windows-native probe yields `Missing`, a
  single cross-boundary probe `wsl.exe -- codex login status` runs (guarded by
  `cfg!(windows)`), detecting a codex install that lives only inside WSL Ubuntu
  (the project owner's setup). A new `CodexOrigin` enum (`windows`|`wsl`|`none`,
  serde snake_case) is added to `CodexDetect` recording WHERE auth was found.
  `codex_cli_missing` is now derived from the EFFECTIVE (post-fallback) probe, so
  install guidance shows only when codex is found NOWHERE. Both probes are
  read-only; both shell calls use FIXED-LITERAL args (the only interpolated value
  is `bin` from the fixed candidate list — never user input).
- **AC-PROXY-ORIGIN**: `oauth_child.rs::spawn_oauth_child` now takes the detected
  `CodexOrigin` and branches the proxy spawn via a new `build_proxy_command`:
  `wsl` → `wsl.exe -- npx openai-oauth --port <P>` (cross-boundary; the proxy
  binds 127.0.0.1:<port> inside WSL2, reachable from Windows via mirrored
  networking — best-effort, WSL2 forwarding verified later by the user); else
  `cmd /C npx …` (Windows) / bare `npx …` (non-Windows). `oauth_proxy_start`
  resolves the origin from a single READ-ONLY `detect_codex()` (login status only;
  zero auth.json writes). Every spawn failure (incl. a failed WSL spawn) sets a
  `Degraded` Korean status → the renderer falls back to copy-paste cleanly (never
  a crash, never a hang — the bounded ready-timeout still applies). Fixed-literal
  args (only the numeric port is interpolated).
- **AC-AUTO-EXTRACT-CONFIRM**: the auto-LLM flow (`autoExtract.ts`:
  `buildPrompt → provider.runExtraction → parseResponse → validateResponse`) was
  already correct LLM-direct extraction — confirmed intact and wired, NOT
  rewritten (it was simply unreachable because detect always returned Missing on
  Windows). The only enhancement is `promptBuilder.ts::ROLE_BLOCK`: it now
  explicitly instructs the academic **7-type** extraction (concept/argument/
  method/scholar/religious_text/objection/quotation — mirroring
  `EXTRACT_SYSTEM_PROMPT`) and the **목차(table-of-contents) classification** (each
  candidate's `schema_field` is classified against the user's outline — mirroring
  `CLASSIFY_SYSTEM_PROMPT`), with verbatim/Catholic-terminology and the chunk_id
  anti-forgery instruction preserved. The `responseValidator.ts` anti-forgery gate
  (forged/hallucinated chunk_ids rejected + quarantined) is UNCHANGED — a forged
  chunk_id from the auto LLM is rejected exactly like one from a manual paste.
- **AC-USAGE-AUTO-SETUP**: `UsageTab.svelte` gains a distinct "자동 모드 설정법
  (고급)" section (separate from the default copy-paste steps): open PowerShell →
  `npm i -g @openai/codex` → `codex login` (browser ChatGPT OAuth, free/subscription
  — uses the user's own quota) → press [다시 검출] and auto mode becomes available.
  Korean, non-technical-friendly, framed as optional/advanced; the Slice-8
  outline-first guidance and the five default steps are untouched.

### App-auth-write-0 preserved (HARD boundary, unchanged)

Both detection probes and the proxy-origin resolver are READ-ONLY (`login status`
only). The app still writes ZERO to codex `auth.json`; the only auth-path stat is
delegated to `external_dep_paths` (the SOLE AC-7-relaxed module). The Slice-8
shell-free URL opener (rundll32 + host allow-list) is untouched. The new shell
calls (`cmd /C codex …`, `wsl.exe -- codex …`, `wsl.exe -- npx …`) interpolate
ONLY fixed compile-time literals — zero user-input injection surface.

### What was NOT adapted (Slice 9)

- A WSL-distro selector / explicit `-d <distro>` flag — `wsl.exe -- …` uses the
  default distro (best-effort; the project owner runs a single Ubuntu). A
  multi-distro selector is deferred.
- WSL2 localhost forwarding setup — relied on as a host capability (mirrored
  networking), not configured by the app; verified later by the user (contract
  deferred_question). A failed cross-boundary proxy degrades to copy-paste.
- Bundling codex/Node (Windows or WSL) — advanced users supply their own; the app
  detects + guides only (contract exclude; codex 강요 0).
- API-key mode — `future` placeholder unchanged (contract_refresh_required_when
  implemented).

New smoke scenarios (`fixtures/t1-slice9-smoke.mjs`): Tier-1 `detect-win-cmd`,
`origin-defaults`, `usage-auto-setup`, `auto-extract-prompt`; Tier-2
`wsl-fallback`, `proxy-origin`, `no-authwrite-detect`, `evidence-forgery-kept` —
all green. The Slice-5b `prompt-build` scenario's `has_role` assertion was EVOLVED
in place to the strengthened role wording (the slice-supersedes-slice precedent),
adding `has_seven_types` + `has_outline_classification` assertions; the Slice-5c
`provider-availability` fixture's `CodexDetectSnapshot` literals gained the new
`origin` field. Slice 8 (8) + 5c (7) + 5b (2 touched) regression + T1 static-scan
(0 violations) green; svelte-check 0 errors (1 pre-existing node-types warning);
44 Rust lib tests pass (was 31 — +13: codex_detect origin/probe-routing/
fixed-literal guards + oauth_child proxy-origin branch guards). tauri build: see
implementation report.

## Slice 10 — codex detect distribution hardening (home fallback + XDG + npm-prefix + self-diag)

**Status**: SUBSTANTIVE (Slice 10, run `run_20260523_000012_sw_llmwiki_slice10`).
A distribution-hardening + bug-fix slice on top of Slice 9. No NEW harness-core
*source file* was ported; it refines the existing codex-auth detection surface
(adapted from the ima2 `codexDetect`/`oauthLauncher` pattern) and brings it to
parity with ima2's `codexDetect.js` on the home/XDG path coverage. Recorded here
per the contract's "every harness-core adaptation recorded … (UI/auth fix면 간략)"
clause.

### Upstream pin (Slice 10)

- **upstream HEAD observed at Slice 10 start**: `94b8785f` (`harness-core` master).
  A parallel track may advance this during the run; that is external and is NOT a
  Slice-10 write — THIS run touches nothing under the harness-core working tree
  (writes are confined to `D:\AI Project\llmwiki\**` + `runs/<run_id>/`).
- **upstream branch**: `master`.

### Live problem fixed

On the test machine `~/.codex/auth.json` EXISTS (4381 bytes, mtime 11:27) and a
Node mimic of the resolver returns `exists=true`, yet the bundled app reported
`available=false` and "다시 검출" stayed dead. Root cause: in the packaged release
runtime `dirs::home_dir()` could return `None`, so `external_dep_paths` never even
BUILT the `~/.codex` / `~/.chatgpt-local` candidates — only the unset
`$CODEX_HOME` / `$CHATGPT_LOCAL_HOME` env candidates were checked → no auth path →
`available=false`.

### What changed (Slice 10)

- **AC-HOME-ROBUST**: `external_dep_paths::resolve_home_dir` is now a multi-step
  fallback — `dirs::home_dir()` ?? `USERPROFILE` ?? (`HOMEDRIVE` + `HOMEPATH`). A
  `None` from `dirs` no longer blinds the resolver; `C:\Users\USER` is still
  resolved so `~/.codex/auth.json` is found. ALL OS-user-dir tokens stay inside
  this one static-scan-exempt file (T1-static-scan: 0 violations across 105 files).
  Fallback helpers (`home_from_userprofile`, `home_from_homedrive_homepath`) are
  unit-tested by temp-setting the env vars (`dirs::home_dir()` cannot be forced to
  `None` in a test).
- **AC-AUTH-PATHS**: `auth_file_path` adds the XDG candidate
  `~/.config/codex/auth.json` (matching ima2's `codexDetect.js`), keeping the
  existing precedence ($CHATGPT_LOCAL_HOME → $CODEX_HOME → ~/.chatgpt-local →
  ~/.codex → ~/.config/codex). Still a presence-stat only — contents never opened.
- **AC-NPM-PREFIX-PROBE**: `codex_detect.rs::probe_login_status` order is now bare
  `cmd /C codex…` candidates → npm-prefix absolute → WSL fallback. When all bare
  candidates are `Missing` on Windows, `cmd /C npm prefix -g` (npm is on the machine
  PATH) resolves the global bin dir, and the absolute `<prefix>\codex.cmd login
  status` is probed via `cmd /C` — finding a custom-prefix codex (e.g.
  `D:\AI Tools\npm-global`) regardless of a stale GUI PATH. The npm-prefix query
  CAPTURES stdout (a path, not auth data; bounded + trimmed; the last drive-rooted
  line is taken so a leading CWD warning cannot poison the path); the codex probe
  built from it keeps stdio fully null (read-only). The only interpolated arg is the
  npm-PRODUCED path — never user input. Empirically confirmed: Rust's
  `Command::new("cmd").args(["/C", "<spaced path>", "login", "status"])` returns
  exit 0 against the real `D:\AI Tools\npm-global\codex.cmd` (std quotes the spaced
  path as one argv).
- **AC-DETECT-SELFDIAG**: `CodexDetect` gains a `detail` string summarizing the
  resolved home path + which signal won (`auth_file:<path>` / `probe_path` /
  `probe_npm_prefix` / `probe_wsl` / `none:<reason>`). PATHS + labels ONLY — never
  auth.json contents, never a token/secret. The home/auth path STRINGS come from
  new `external_dep_paths` accessors (`resolved_home_display`, `auth_file_display`),
  so `codex_detect.rs` names no OS-user-dir token in source. Surfaced in
  `ModeToggle.svelte` as a small muted line (`검출 상세: …`) so a future detection
  failure is diagnosable, not silent. A unit test asserts no detail string contains
  any sentinel OS-user-dir token or a secret marker.
- **AC-REFRESH-SURFACE**: `provider.ts::detectCodex` now returns
  `{ snapshot, error }` (was a bare snapshot). On an `invoke('codex_detect')` throw
  it still degrades to an unavailable snapshot but records a Korean `error`;
  `modeStore` carries `detectError` and `ModeToggle` shows it, so "다시 검출" never
  looks dead. Outside the Tauri shell (preview) `error` stays null (expected, not a
  failure). The two degrade returns were consolidated into a `degradedSnapshot()`
  helper that still defaults `origin: 'none'` (the Slice-9 `origin-defaults` fixture
  assertion was EVOLVED in place to the helper shape — slice-supersedes-slice
  precedent — behaviour preserved).

### App-auth-write-0 preserved (HARD boundary, unchanged)

Detection stays READ-ONLY: presence-stat (delegated to the SOLE AC-7-relaxed
module) + `login status` probes only. The app writes ZERO to `auth.json` and never
reads its CONTENTS — the new `detail` exposes only the auth-file PATH string, never
its contents or any token. The Slice-8 shell-free `rundll32` URL opener is
untouched. The new shell calls (`cmd /C npm prefix -g`, `cmd /C <prefix>\codex.cmd
login status`) interpolate ONLY fixed compile-time literals + the npm-produced path
— zero user-input injection surface.

### What was NOT adapted (Slice 10)

- A `dirs`-crate upgrade or a Win32 `SHGetKnownFolderPath` binding — the env-var
  fallback (the same composition Windows uses) covers the bundled-`None` case with
  no new dependency / lockfile churn.
- Parsing/validating npm prefix beyond "last drive-rooted line" — a non-path output
  yields `None` and the WSL fallback runs (graceful).
- Bundling codex/Node — advanced users supply their own; the app detects + guides
  (contract exclude; codex 강요 0).
- API-key mode — `future` placeholder unchanged.

New smoke coverage: the Slice-9 `origin-defaults` scenario was evolved in place;
51 Rust lib tests pass (was 44 — +7: home fallback, XDG auth candidates, display
helpers, detail-no-tokens, npm-prefix fixed-literals, npm-prefix parser, npm-prefix
no-panic). Slice 9 (8, origin-defaults evolved) + 8 (8) + 5c (7) + 5b (10)
regression + T1 static-scan (0 violations / 105 files) green; svelte-check 0 errors
(1 pre-existing node-types warning); npm build green. Live D-class on this PC: bare
`cmd /C codex login status` → "Logged in using ChatGPT" exit 0; `npm prefix -g` →
`D:\AI Tools\npm-global`; `~/.codex/auth.json` present (mtime predates this run —
app wrote 0). tauri build: see implementation report.

## Cross-references

- `agreed_contract.json` (Slice 10, run `run_20260523_000012_sw_llmwiki_slice10`).
- `agreed_contract.json` (Slice 9, run `run_20260523_000011_sw_llmwiki_slice9`).
- `agreed_contract.json` (Slice 8, run `run_20260523_000010_sw_llmwiki_slice8`).
- `agreed_contract.json` (Slice 6, run `run_20260523_000008_sw_llmwiki_slice6`).
- `agreed_contract.json` (Slice 5c, run `run_20260523_000007_sw_llmwiki_slice5c`).
- `agreed_contract.json` (Slice 5b, run `run_20260523_000006_sw_llmwiki_slice5b`).
- `agreed_contract.json` (Slice 5a, run `run_20260523_000005_sw_llmwiki_slice5a`).
- `agreed_contract.json` (Slice 3, run `run_20260520_000003_sw_llmwiki_slice3`).
- `agreed_contract.json` (Slice 2, run `run_20260521_093931_p5_sw_llmwiki_slice2`).
- `contract_proposal_v2.md` (Round-2 proposal narrative; same run).
- `r2_step_log.txt` (Round-2 implementation step log; same run).
- `implementation_manifest.json` (Round-2 closeout boundary artifact; same run).
- Slice-1 closeout: `runs/run_20260520_000001_p5_sw_llmwiki_extract_split/final_evaluation.json`.
