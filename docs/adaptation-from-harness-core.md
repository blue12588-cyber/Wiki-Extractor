# Adaptation Log — harness-core → llmwiki

**Status**: STUB (Slice 1, round-3). Substantive content deferred to Slice 2.

## Source reference

- **upstream repository**: `harness-core` (private; located at `\\wsl.localhost\ubuntu-24.04\home\user\harness-core` during Slice 1 work)
- **upstream HEAD at adaptation start**: `f7dddc38eab9004b2dfe73e8d6805de07dbbeb48`
- **upstream HEAD verification command**: `git -C <harness-core-root> rev-parse HEAD`
- **upstream branch**: `master`
- **upstream working tree write policy during Slice 1**: zero writes outside `runs/<run_id>/`. AC-9 of `agreed_contract.json` mandates pre/post HEAD equality.

This file exists to satisfy **AC-8 (adaptation log stub)** of the Slice-1-scope-reduced contract. It records:
- the upstream commit that this project's structure was derived from;
- the policy that any module copied from upstream must be re-justified here before merging;
- the placeholders for Slice 2 to fill.

## What was adapted in Slice 1

**Nothing — by design.**

Slice 1's narrowed scope is "working Tauri+SvelteKit scaffold + lockfiles + adaptation-log stub + harness-core safety". No source files, schemas, or extractor logic were copied from harness-core in this slice. The carved directory layout under `sidecar/`, `shared/schemas/`, etc. anticipates where Slice 2 will place adapted modules, but those directories are currently empty.

The only structural decisions in Slice 1 that reference harness-core's design:

| llmwiki path | harness-core analog (intended source for Slice 2) | rationale |
|---|---|---|
| `shared/schemas/` | `harness-core/schemas/` | shared JSON-Schema definitions for candidate_items and source records; Slice 2 will copy a subset and record per-file diff here |
| `sidecar/src/gates/` | `harness-core/runs/.../gate_*` evaluation logic | extraction-gate orchestration; Slice 2 will port the gate dispatch table only, with adapter for desktop runtime |
| `sidecar/src/extractor/` | `harness-core/tools/` (extractor toolchain) | candidate-item extraction passes; Slice 2 will port pattern-matching and synthesizer subset, NOT the academic-pipeline glue |
| `sidecar/src/path-resolver/` | NEW (no harness-core analog) | install-folder-relative path resolution; AC-7 portability requirement |
| `sidecar/src/sources/` | NEW (no harness-core analog) | UI-upload-driven source ingestion; harness-core operates on pre-staged sources only |
| `src/lib/auth/` | NEW (no harness-core analog) | OpenAI OAuth (PKCE) dual-state UI; harness-core has no client-side auth |
| `src/lib/upload/` | NEW (no harness-core analog) | drag/drop + magic-bytes upload UI; harness-core uses CLI staging |

## What Slice 2 must add to this file

For every file copied or substantively derived from `harness-core`, Slice 2 must append a row to **§Adapted Modules** below with these columns:

1. **llmwiki path** (relative to project root)
2. **upstream path** (relative to harness-core root, at HEAD `f7dddc38`)
3. **upstream commit hash** of the source file at copy time (`git -C <harness-core> log -1 --format=%H -- <upstream-path>`)
4. **change class**: one of `verbatim`, `field-rename`, `schema-subset`, `runtime-port`, `inspired-by`
5. **field-level diff** if `change-class ∈ {schema-subset, field-rename}`: bulleted list of added/removed/renamed JSON-Schema fields with one-line rationale per change
6. **rationale**: why the upstream code is appropriate for llmwiki's desktop-extraction context; why deviations were necessary
7. **drift risk**: bulleted list of upstream behaviors NOT reproduced and the user-visible consequence

## Adapted modules

*(empty in Slice 1; populated by Slice 2)*

| llmwiki path | upstream path | upstream commit | change class | field diff | rationale | drift risk |
|---|---|---|---|---|---|---|
| _(none)_ | _(none)_ | _(none)_ | _(none)_ | _(none)_ | _(none)_ | _(none)_ |

## Policies enforced across all slices

- **No upstream-write policy** (AC-9): all work in this repo. The harness-core working tree must never be modified by llmwiki development. Pre/post HEAD checks recorded in `runs/<run_id>/harness_core_head_pre_*.txt` and `harness_core_head_post_*.txt`.
- **Adapted-file freshness**: when re-syncing from a newer harness-core HEAD, every row above must be re-verified against the new upstream file. Rows whose upstream commit hash changed need an explicit re-review entry (append, do not overwrite).
- **No silent verbatim copies**: a row in §Adapted Modules is required before merging any file that was copied or substantially derived from harness-core. Code review checklist enforces this.
- **Schema-diff discipline**: any schema change from upstream must list every field touched. A `change-class = schema-subset` with empty field diff is invalid and fails review.

## Why this file exists as a stub in Slice 1

The Slice 1 scope-reduction note (`runs/run_20260520_000001_p5_sw_llmwiki_extract_split/scope_reduction_note.md`) explicitly defers the substantive contents of this log to Slice 2:

> AC-8 adaptation log (stub): docs/adaptation-from-harness-core.md 파일 생성. harness-core HEAD ref (f7dddc38) 기록. 실제 schema diff / source 분리는 slice 2에서.

The stub form satisfies:
- Slice-1 AC-8 (file present + upstream commit recorded + Slice-2 contract documented);
- a freeze point for the Slice-2 work bundle (Slice 2's first commit must extend this file before adding any adapted code);
- a discoverable contract for future contributors (the §Adapted modules table format is fixed by this file).

## Cross-references

- `agreed_contract.json` (Slice 1, run `run_20260520_000001_p5_sw_llmwiki_extract_split`)
- `scope_reduction_note.md` (round-2 → round-3 boundary decision; same run)
- `implementation_manifest.json` (round-3 closeout; same run)
- `discretion_notes.md` (D-class observations during Slice 1; same run)
