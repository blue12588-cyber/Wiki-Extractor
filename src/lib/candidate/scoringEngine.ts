/**
 * Rule-based candidate scoring engine — deterministic, offline, NO LLM.
 *
 * Authority: agreed_contract.json#AC-RULE-ENGINE.
 * Ported from (rule-distilled, LLM parts excluded):
 *   - harness-core/domains/academic/source-extractor.md §"Candidate Quality
 *     Test" ("can this item be reused later without rereading the chunk?")
 *   - harness-core/domains/academic/candidate-evaluator.md §"Review Criteria"
 *     (standalone reuse value, evidence quality, duplication risk) and
 *     §"Action Guidance"
 *   - harness-core/knowledge/academic/wiki/*.md structure
 *     (Claim / Evidence / Synthesis / Boundaries / Links)
 *   (adaptation recorded in docs/adaptation-from-harness-core.md §"Slice 5a")
 *
 * The six Codex-agreed scoring criteria, each producing an INTERNAL integer
 * sub-score (never shown in the UI — Codex UX guidance):
 *   1. schema_fit       — outline/topic keyword + synonym overlap
 *   2. claim_strength   — assertion-verb detection (EN/KO)
 *   3. evidence_quality — chunk_id + page + surrounding-context sufficiency
 *   4. reusability      — knowledge-unit (not mere summary); heading proximity
 *   5. novelty          — not a duplicate of an existing wiki entry
 *   6. boundary         — "이 자료로 어디까지 말할 수 있나" identifiability
 * Minus: structural demotion (footnote / biblio / toc / index / copyright).
 *
 * Determinism contract:
 *   - Pure function: same (candidate, chunks, outlineKeywords, existingEntries)
 *     → byte-identical ScoredCandidate. No I/O, no Date.now(), no randomness.
 *   - Sub-scores are bounded small integers; the total is their sum minus the
 *     demotion penalty. The total is INTERNAL.
 */

import type { CandidateItem } from '../extract/candidateExtractor';
import type { Chunk } from '../chunk/chunker';
import type { WikiEntry } from '../wiki/wikiTypes';
import { countClaimVerbs, detectClaimVerbs } from './claimVerbs';
import { detectDemotion, type DemoteSignal } from './demotePatterns';
import {
  expandSynonyms,
  overlapCount,
  overlapTerms,
  tokenize,
  tokenSimilarity,
} from './keywordMatch';
import { structuralReasonForCandidate } from './structuralFilter';

export type RecommendedAction =
  | 'create_new'
  | 'update_existing'
  | 'link_only'
  | 'ignore';

/** Per-criterion internal sub-scores (NOT rendered). */
export interface SubScores {
  schema_fit: number;
  claim_strength: number;
  evidence_quality: number;
  reusability: number;
  novelty: number;
  boundary: number;
  /** Negative penalty contributed by structural demotion. */
  demotion_penalty: number;
}

/** Human-readable, NON-numeric rationale fragments for the card. */
export interface Rationale {
  /** "왜 후보인가" bullet fragments (Korean). */
  why: string[];
  /** Matched outline/topic keywords (schema fit). */
  matched_keywords: string[];
  /** Detected assertion verbs (surface forms). */
  claim_verbs: string[];
  /** "주의 / 경계" fragments — what this source can NOT establish. */
  boundary: string[];
  /** Demotion reason fragments (if any). */
  demotion: string[];
}

export interface ScoredCandidate {
  candidate: CandidateItem;
  sub: SubScores;
  /** Internal total = sum(sub) including the (negative) demotion penalty. */
  total: number;
  /** The deterministic classification (create/update/link/ignore). */
  recommended_action: RecommendedAction;
  /** Target existing entry id/title when update_existing or link_only. */
  target_entry_id: string | null;
  target_entry_title: string | null;
  rationale: Rationale;
  /** Raw demotion signal (kept for tests / card "주의"). */
  demote: DemoteSignal;
}

export interface ScoreInput {
  /** Deterministic candidate items from the existing extractor. */
  candidates: CandidateItem[];
  /** Chunks for the same source (evidence-quality / heading-proximity signal). */
  chunks: Chunk[];
  /**
   * Outline + topic keywords (AC-SCHEMA-INPUT). Already a flat string list:
   * outline node titles and/or user topic terms. Tokenized + synonym-expanded
   * inside.
   */
  outlineKeywords: string[];
  /** Existing wiki entries (AC-DEDUP / novelty). May be empty. */
  existingEntries: WikiEntry[];
}

/* ----------------------- thresholds (internal only) ----------------------- */
// These are INTERNAL engine constants, not user-facing acceptance thresholds.
// They shape the deterministic classification; they are never shown in the UI.
const SIM_UPDATE = 0.5; // ≥ this → strong duplicate → update_existing
const SIM_LINK = 0.2; // ≥ this (and < SIM_UPDATE) → related → link_only
const IGNORE_TOTAL = 1; // total ≤ this (after demotion) → ignore

/* --------------------------- evidence helpers --------------------------- */

/** Find the chunk that contains a candidate's span (by char overlap). */
function chunkForCandidate(c: CandidateItem, chunks: Chunk[]): Chunk | null {
  for (const ch of chunks) {
    if (c.span.start >= ch.location.char_start && c.span.start < ch.location.char_end) {
      return ch;
    }
  }
  return null;
}

/* ------------------------------ criteria ------------------------------ */

function scoreSchemaFit(
  c: CandidateItem,
  needle: Set<string>,
): { score: number; matched: string[] } {
  if (needle.size === 0) return { score: 0, matched: [] };
  const hay = `${c.title}\n${c.summary}\n${c.evidence_text}\n${(c.original_terms ?? []).join('\n')}`;
  const n = overlapCount(needle, hay);
  const matched = overlapTerms(needle, hay);
  // 0 matches → 0; 1 → 1; 2 → 2; 3+ → 3 (capped, deterministic).
  const score = Math.min(n, 3);
  return { score, matched };
}

function scoreClaimStrength(c: CandidateItem): { score: number; verbs: string[] } {
  const hay = `${c.title}\n${c.summary}\n${c.evidence_text}`;
  const hits = detectClaimVerbs(hay);
  const verbs = hits.map((h) => h.match);
  // 0 → 0; 1 → 1; 2 → 2; 3+ → 3 (capped).
  const score = Math.min(countClaimVerbs(hay), 3);
  return { score, verbs };
}

function scoreEvidenceQuality(
  c: CandidateItem,
  chunks: Chunk[],
): { score: number; note: string } {
  let score = 0;
  const parts: string[] = [];
  const ch = chunkForCandidate(c, chunks);
  if (ch) {
    score += 1; // anchored to a chunk_id
    parts.push(`청크 ${ch.chunk_id}`);
    if (ch.text.trim().length >= 200) {
      score += 1; // sufficient surrounding context
      parts.push('충분한 주변 문맥');
    }
  }
  if (typeof c.page === 'number') {
    score += 1; // page reference present
    parts.push(`p.${c.page}`);
  }
  // multiple evidence refs → higher confidence
  if (c.evidence_refs.length >= 2) {
    score += 1;
    parts.push('복수 근거');
  }
  return { score: Math.min(score, 3), note: parts.join(' · ') };
}

function scoreReusability(
  c: CandidateItem,
  chunks: Chunk[],
): { score: number; note: string } {
  let score = 0;
  const parts: string[] = [];
  // A concept/argument/method/objection is a knowledge unit; a bare quotation
  // is closer to summary material (upstream "prefer reusable knowledge units
  // over summary").
  if (c.type === 'concept' || c.type === 'argument' || c.type === 'method' || c.type === 'objection') {
    score += 1;
    parts.push('지식 단위(요약 아님)');
  }
  // Heading-proximity: candidate sits inside a chunk that carries a heading
  // path → likely a titled, reusable point.
  const ch = chunkForCandidate(c, chunks);
  if (ch && ch.heading_path.length > 0) {
    score += 1;
    parts.push(`제목 맥락: ${ch.heading_path.join(' › ')}`);
  }
  // Title length sanity: a too-short title is rarely a reusable unit.
  if (c.title.trim().length >= 6) score += 1;
  return { score: Math.min(score, 3), note: parts.join(' · ') };
}

function containedTokenSimilarity(aText: string, bText: string): number {
  const a = tokenize(aText);
  const b = tokenize(bText);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  if (inter === 0) return 0;
  // One shared term is useful for "related", but two or more shared identity
  // terms are needed before we treat an existing hub as a likely update target.
  if (inter === 1) return 0.25;
  return inter / Math.min(a.size, b.size);
}

function scoreNovelty(
  c: CandidateItem,
  existingEntries: WikiEntry[],
): { score: number; bestSim: number; target: WikiEntry | null } {
  if (existingEntries.length === 0) {
    return { score: 2, bestSim: 0, target: null }; // brand-new wiki → novel
  }
  let bestSim = 0;
  let target: WikiEntry | null = null;
  const candText = `${c.title} ${c.summary} ${(c.original_terms ?? []).join(' ')}`;
  for (const e of existingEntries) {
    // Compare against the entry's title + tags + original terms + related
    // identity surface, mirroring the promoted local wiki shape.
    const entryText = [
      e.title,
      e.tags.join(' '),
      (e.original_terms ?? []).join(' '),
      e.related.join(' '),
      e.summary ?? '',
    ].join(' ');
    const sim = Math.max(
      tokenSimilarity(candText, entryText),
      tokenSimilarity((c.original_terms ?? []).join(' '), entryText),
      containedTokenSimilarity(
        [c.title, ...(c.original_terms ?? [])].join(' '),
        [e.title, ...e.tags, ...(e.original_terms ?? []), ...e.related].join(' '),
      ),
    );
    if (sim > bestSim) {
      bestSim = sim;
      target = e;
    }
  }
  // Higher similarity → lower novelty.
  let score = 2;
  if (bestSim >= SIM_UPDATE) score = 0;
  else if (bestSim >= SIM_LINK) score = 1;
  return { score, bestSim, target };
}

function scoreBoundary(c: CandidateItem): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  const hay = `${c.title}\n${c.summary}\n${c.evidence_text}`;
  if (
    /\b(not by itself|does not prove|cannot establish|requires?|must not|should not|do not|without|rather than|not as)\b/i.test(hay) ||
    /(?:만으로는|증명하지|입증하지|요구|필요|한계|경계|검증)/.test(hay)
  ) {
    notes.push('경계 신호 — 이 후보는 무엇을 증명하지 못하는지도 함께 보존하세요');
    score += 1;
  }
  // A single-source, single-evidence candidate has a clear (narrow) boundary:
  // it can only speak for THIS passage. Naming that boundary is itself valuable.
  if (c.evidence_refs.length <= 1) {
    notes.push('단일 근거 — 이 구절 범위로만 말할 수 있습니다');
    score += 1;
  } else {
    notes.push('복수 근거 — 출처 범위 안에서만 일반화하세요');
    score += 1;
  }
  // Quotation type: boundary = "직접 인용일 뿐 저자의 주장으로 확대 금지".
  if (c.type === 'quotation') {
    notes.push('직접 인용입니다 — 저자의 결론으로 확대하지 마세요');
    score += 1;
  }
  return { score: Math.min(score, 3), notes };
}

/* --------------------------- classification --------------------------- */

function classify(
  total: number,
  novelty: { bestSim: number; target: WikiEntry | null },
  demote: DemoteSignal,
  structuralReason: string | null,
): { action: RecommendedAction; target: WikiEntry | null } {
  // AC-DEMOTE: a structural chunk (footnote / bibliography / toc / index /
  // copyright) is NEVER a wiki candidate. Demotion is a hard override — it
  // ignores the item regardless of its other (incidental) sub-scores.
  if (demote.demoted || structuralReason) {
    return { action: 'ignore', target: null };
  }
  if (total <= IGNORE_TOTAL) {
    return { action: 'ignore', target: null };
  }
  if (novelty.target && novelty.bestSim >= SIM_UPDATE) {
    return { action: 'update_existing', target: novelty.target };
  }
  if (novelty.target && novelty.bestSim >= SIM_LINK) {
    return { action: 'link_only', target: novelty.target };
  }
  return { action: 'create_new', target: null };
}

/* ------------------------------ public ------------------------------ */

/**
 * Score one candidate against the source chunks, the outline/topic keywords,
 * and the existing wiki. Pure + deterministic.
 */
export function scoreCandidate(
  c: CandidateItem,
  chunks: Chunk[],
  needle: Set<string>,
  existingEntries: WikiEntry[],
): ScoredCandidate {
  const sf = scoreSchemaFit(c, needle);
  const cs = scoreClaimStrength(c);
  const eq = scoreEvidenceQuality(c, chunks);
  const ru = scoreReusability(c, chunks);
  const nv = scoreNovelty(c, existingEntries);
  const bd = scoreBoundary(c);
  const demote = detectDemotion(`${c.title}\n${c.summary}\n${c.evidence_text}`);
  const structuralReason = structuralReasonForCandidate(c);
  const demotion_penalty = structuralReason ? -99 : demote.demoted ? -(demote.kinds.length * 3) : 0;

  const sub: SubScores = {
    schema_fit: sf.score,
    claim_strength: cs.score,
    evidence_quality: eq.score,
    reusability: ru.score,
    novelty: nv.score,
    boundary: bd.score,
    demotion_penalty,
  };
  const total =
    sub.schema_fit +
    sub.claim_strength +
    sub.evidence_quality +
    sub.reusability +
    sub.novelty +
    sub.boundary +
    sub.demotion_penalty;

  const cls = classify(total, nv, demote, structuralReason);

  // Build the NON-numeric, Korean rationale.
  const why: string[] = [];
  if (sf.matched.length) why.push(`목차/주제어 일치: ${sf.matched.join(', ')}`);
  if (c.original_terms?.length) why.push(`핵심 원어/용어: ${c.original_terms.slice(0, 6).join(', ')}`);
  if (cs.verbs.length) why.push(`주장 동사 탐지: ${Array.from(new Set(cs.verbs)).join(', ')}`);
  if (eq.note) why.push(`근거: ${eq.note}`);
  if (ru.note) why.push(ru.note);
  if (cls.action === 'create_new') why.push('기존 위키에 없는 새 항목으로 보입니다');
  if (cls.action === 'update_existing' && cls.target) why.push(`기존 항목 「${cls.target.title}」과 유사 — 보강 권장`);
  if (cls.action === 'link_only' && cls.target) why.push(`기존 항목 「${cls.target.title}」과 관련 — 링크 권장`);

  const rationale: Rationale = {
    why,
    matched_keywords: sf.matched,
    claim_verbs: Array.from(new Set(cs.verbs)),
    boundary: bd.notes,
    demotion: structuralReason ? [structuralReason, ...demote.reasons] : demote.reasons,
  };

  return {
    candidate: c,
    sub,
    total,
    recommended_action: cls.action,
    target_entry_id: cls.target?.id ?? null,
    target_entry_title: cls.target?.title ?? null,
    rationale,
    demote,
  };
}

/**
 * Score a whole bundle of candidates. Deterministic: candidates are processed
 * in their incoming (document) order; the result array preserves that order.
 */
export function scoreCandidates(input: ScoreInput): ScoredCandidate[] {
  const needle = expandSynonyms(
    tokenize(input.outlineKeywords.join('\n')),
  );
  return input.candidates.map((c) =>
    scoreCandidate(c, input.chunks, needle, input.existingEntries),
  );
}
