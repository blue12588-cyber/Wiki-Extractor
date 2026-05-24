/**
 * Bridge → wiki import builder — Slice 5b (AC-IMPORT + AC-APPROVE + AC-EVIDENCE-BIND).
 *
 * Authority: agreed_contract.json#AC-IMPORT + AC-APPROVE + AC-EVIDENCE-BIND +
 *            AC-TRANSLATE(원문 보존) + AC-ANNOTATION.
 *
 * Turns a VALIDATED ChatGPT candidate (one that passed responseValidator and
 * therefore binds to real uploaded chunk_ids) into a persistent `WikiEntry`.
 * Reuses the slice-3 wiki domain types so the existing save path
 * (`saveEntryAndIndex`) and the `ClaimAnnotation` UI work unchanged.
 *
 * Original-text preservation (HARD invariant):
 *   `WikiClaim.original_text` is the VERBATIM source chunk text (looked up by
 *   chunk_id from the real uploaded chunks) — NOT the ChatGPT-authored quote.
 *   The Catholic-terminology Korean from ChatGPT goes into the SEPARATE
 *   `translated_text` field. The annotation shows translated ABOVE / original
 *   BELOW. The source is never mutated. If a chunk_id cannot be resolved to
 *   verbatim source text, the import is REFUSED (hard throw) — the model-authored
 *   quote is NEVER substituted into `original_text`, so the preservation
 *   invariant cannot degrade on any code path.
 *
 * Pure: no I/O, no network, no LLM. The caller persists the returned entry.
 */

import type { Chunk } from '../chunk/chunker';
import { structuralReasonForCandidate } from '../candidate/structuralFilter';
import type { WikiClaim, WikiEntry } from '../wiki/wikiTypes';
import type { ValidatedCandidate } from './responseValidator';

/** Marker so the wiki/UI can show LLM provenance (AC-IMPORT 출처 표시). */
export const LLM_SOURCE_TAG = 'llm:chatgpt-paste';

function isoNow(now?: string): string {
  return now ?? new Date().toISOString();
}

/**
 * Build the claim list for one validated candidate. Each evidence chunk_id MUST
 * resolve to its REAL chunk text (preservation). A validated candidate always
 * binds to a known chunk_id, so this resolves in practice; if a chunk is
 * unresolvable we REFUSE the import (hard throw) rather than silently
 * substituting the model-authored quote into `original_text`. The model quote
 * is never written into the preserved-original field on any path.
 */
function claimsFor(
  cand: ValidatedCandidate,
  chunksById: Map<string, Chunk>,
): WikiClaim[] {
  return cand.evidence.map((ev, i) => {
    const chunk = chunksById.get(ev.chunk_id);
    if (!chunk) {
      // Hard refusal: cannot restore verbatim original text for this chunk_id
      // within the candidate's source. Do NOT fall back to the ChatGPT quote.
      throw new Error(
        `원문 복원 실패: chunk_id "${ev.chunk_id}" 의 원문 청크 텍스트를 찾을 수 없어 가져오기를 거부합니다(모델 인용을 원문으로 대체하지 않음).`,
      );
    }
    // Prefer the exact model-cited quote only when it is verifiably a verbatim
    // slice of the real chunk. Otherwise fall back to the whole real chunk.
    // Either way original_text comes from source text, never from paraphrase.
    const quote = ev.quote.trim();
    const original_text = quote && chunk.text.includes(quote) ? quote : chunk.text;
    return {
      claim_id: `${cand.index}-${i}-${ev.chunk_id}`,
      statement: cand.title,
      // Catholic-terminology Korean translation of the evidence passage when
      // supplied; summary_ko remains a fallback for older/manual responses.
      translated_text: ev.translation_ko || cand.summary_ko,
      // Preserved verbatim source.
      original_text,
      // Evidence locators bind to the real chunk_id.
      evidence_refs: [
        `${chunk.source_id}#${ev.chunk_id}${chunk.location.page != null ? `#p${chunk.location.page}` : ''}`,
      ],
      candidate_id: LLM_SOURCE_TAG,
    };
  });
}

export interface ImportOptions {
  /** Source id the candidate's chunks belong to (provenance). */
  source_id: string;
  /** Real uploaded chunks (the binding anchor + original-text source). */
  chunks: Chunk[];
  /** Outline node id this candidate maps to (from schema_field), or null. */
  outlineNodeId?: string | null;
  /** Override clock for deterministic tests. */
  now?: string;
}

/**
 * Build a draft WikiEntry from a single validated candidate. The entry enters
 * as `draft` (the user approves/holds/discards it next). NOT importable
 * candidates must be filtered out BEFORE calling this.
 */
export function buildEntryFromValidated(
  cand: ValidatedCandidate,
  opts: ImportOptions,
): WikiEntry {
  if (!cand.importable) {
    throw new Error('가져올 수 없는 후보입니다(검증 실패). 검증을 통과한 후보만 가져올 수 있습니다.');
  }
  const structuralReason = structuralReasonForCandidate(cand);
  if (structuralReason) {
    throw new Error(`${structuralReason} 구조 정보는 위키 항목으로 저장하지 않습니다.`);
  }
  const now = isoNow(opts.now);
  const chunksById = new Map(opts.chunks.map((c) => [c.chunk_id, c]));
  const claims = claimsFor(cand, chunksById);
  const titleSlug = cand.title.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');
  const id = `${opts.source_id}-llm-${cand.index}-${titleSlug || 'entry'}`;

  return {
    id,
    title: cand.title,
    category: 'extracted',
    status: 'draft',
    outline_node_id: opts.outlineNodeId ?? null,
    summary: cand.reason || null,
    claims,
    source_ids: [opts.source_id],
    // LLM-provenance tag (출처 표시) + the schema_field ChatGPT chose.
    tags: [LLM_SOURCE_TAG, ...(cand.schema_field ? [cand.schema_field] : [])],
    related: [],
    created_from_candidates: [LLM_SOURCE_TAG],
    created_at: now,
    updated_at: now,
    review_notes: cand.confidence ? `ChatGPT 신뢰도: ${cand.confidence}` : null,
  };
}
