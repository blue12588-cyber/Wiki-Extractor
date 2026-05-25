/**
 * Wiki builder — compose WikiEntry objects from extracted candidates +
 * outline mappings + (optional) translations.
 *
 * Authority: agreed_contract.json#AC-WIKI-PERSIST + AC-CLASSIFY-MAP +
 *            AC-TRANSLATE + AC-ANNOTATION.
 *
 * Original-text preservation: a claim's `original_text` is the candidate's
 * verbatim `source_text`. `evidence_text` may be a UI excerpt/context. The
 * translation (when available) goes into the separate `translated_text` field.
 * When translation is unavailable (offline /
 * degraded), `translated_text` is left empty and the original still shows.
 *
 * Pure functions; no I/O, no LLM call here (the LLM results are passed in).
 */

import type { CandidateItem } from '../extract/candidateExtractor';
import type { Chunk } from '../chunk/chunker';
import type { WikiClaim, WikiEntry } from './wikiTypes';

/** A user-editable mapping of candidate -> outline node (LLM or manual). */
export interface CandidateMapping {
  local_candidate_id: string;
  outline_node_id: string | null;
  recommended_action: string;
  rationale: string;
}

/** Optional translation result keyed by candidate id (Catholic terminology). */
export type TranslationMap = Record<string, string>;

function isoNow(): string {
  return new Date().toISOString();
}

function chunkForCandidate(c: CandidateItem, chunks: Chunk[]): Chunk | null {
  return (
    chunks.find(
      (ch) =>
        ch.source_id === c.source_id &&
        c.span.start >= ch.location.char_start &&
        c.span.start < ch.location.char_end,
    ) ??
    chunks.find(
      (ch) =>
        ch.source_id === c.source_id &&
        c.span.start < ch.location.char_end &&
        c.span.end > ch.location.char_start,
    ) ??
    null
  );
}

function chunkEvidenceRef(c: CandidateItem, chunk: Chunk): string {
  const localStart = Math.max(0, Math.min(c.span.start - chunk.location.char_start, chunk.text.length));
  const line = chunk.text.slice(0, localStart).split('\n').length;
  const page = chunk.location.page != null ? `#p${chunk.location.page}` : '';
  return `${chunk.source_id}#${chunk.chunk_id}${page}#line${line}`;
}

function evidenceRefsForCandidate(c: CandidateItem, chunks: Chunk[]): string[] {
  const chunk = chunkForCandidate(c, chunks);
  if (!chunk) return c.evidence_refs;
  const ref = chunkEvidenceRef(c, chunk);
  return [ref, ...c.evidence_refs.filter((existing) => existing !== ref)];
}

function claimFromCandidate(c: CandidateItem, translations: TranslationMap, chunks: Chunk[]): WikiClaim {
  const original_text = c.source_text ?? c.evidence_text;
  return {
    claim_id: c.local_candidate_id,
    statement: c.title,
    // Original is preserved verbatim; translation is separate (may be empty).
    translated_text: translations[c.local_candidate_id] ?? '',
    original_text,
    evidence_refs: evidenceRefsForCandidate(c, chunks),
    candidate_id: c.local_candidate_id,
  };
}

function uniqueOriginalTerms(candidates: CandidateItem[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const term of c.original_terms ?? []) {
      const clean = term.trim();
      if (!clean) continue;
      const key = clean.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
  }
  return out.slice(0, 24);
}

/**
 * Group candidates by their mapped outline node and build one WikiEntry per
 * node. Candidates with no mapping are grouped under a synthetic
 * "unclassified" entry so nothing is silently dropped (upstream rule: do not
 * discard candidates).
 */
export function buildEntriesFromCandidates(opts: {
  source_id: string;
  candidates: CandidateItem[];
  mappings: CandidateMapping[];
  outlineTitleById: Record<string, string>;
  /** Real chunks for the source. When present, offline claims are bound to chunk_id evidence. */
  chunks?: Chunk[];
  translations?: TranslationMap;
  now?: string;
}): WikiEntry[] {
  const translations = opts.translations ?? {};
  const chunks = opts.chunks ?? [];
  const now = opts.now ?? isoNow();
  const mapById = new Map(opts.mappings.map((m) => [m.local_candidate_id, m]));

  // node id (or "__unclassified__") -> candidates
  const groups = new Map<string, CandidateItem[]>();
  for (const c of opts.candidates) {
    const m = mapById.get(c.local_candidate_id);
    const node = m?.outline_node_id ?? '__unclassified__';
    if (!groups.has(node)) groups.set(node, []);
    groups.get(node)!.push(c);
  }

  const entries: WikiEntry[] = [];
  // Deterministic node ordering.
  const nodeIds = Array.from(groups.keys()).sort();
  for (const node of nodeIds) {
    const cands = groups.get(node)!;
    const isUnclassified = node === '__unclassified__';
    const title = isUnclassified
      ? '미분류 후보'
      : opts.outlineTitleById[node] ?? node;
    const id = isUnclassified
      ? `${opts.source_id}-unclassified`
      : `${opts.source_id}-${node}`;
    entries.push({
      id,
      title,
      category: 'extracted',
      status: 'draft',
      outline_node_id: isUnclassified ? null : node,
      summary: null,
      claims: cands.map((c) => claimFromCandidate(c, translations, chunks)),
      source_ids: [opts.source_id],
      original_terms: uniqueOriginalTerms(cands),
      tags: [],
      related: [],
      created_from_candidates: cands.map((c) => c.local_candidate_id),
      created_at: now,
      updated_at: now,
      review_notes: null,
    });
  }
  return entries;
}

/**
 * Fallback mapping when the LLM classify path is unavailable (offline /
 * degraded). Every candidate maps to no node (null) with a clear rationale, so
 * AC-CLASSIFY-MAP still produces a usable, user-editable result.
 */
export function fallbackMappings(candidates: CandidateItem[]): CandidateMapping[] {
  return candidates.map((c) => ({
    local_candidate_id: c.local_candidate_id,
    outline_node_id: null,
    recommended_action: c.suggested_action,
    rationale: 'LLM 분류 미사용(오프라인/degradation) — 수동으로 목차 항목을 지정하세요.',
  }));
}
