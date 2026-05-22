/**
 * Candidate engine driver — turns the pipeline's deterministic extraction
 * (bundle + chunks) plus the user outline and the existing wiki into a list of
 * SCORED, CLASSIFIED candidate cards. Offline, deterministic, NO LLM.
 *
 * Authority: agreed_contract.json#AC-RULE-ENGINE + AC-CLASSIFY + AC-DEDUP +
 *            AC-DEMOTE + AC-SCHEMA-INPUT + AC-OFFLINE.
 *
 * This is the single seam the UI calls. It does NOT touch the network, the
 * LLM, or any OS-user directory; all inputs are already in memory.
 *
 * Determinism contract: pure transform of its inputs (no Date, no random).
 */

import type { CandidateBundle } from '../extract/candidateExtractor';
import type { Chunk } from '../chunk/chunker';
import type { ParsedOutline } from '../outline/outlineParser';
import type { WikiEntry } from '../wiki/wikiTypes';
import { scoreCandidates, type ScoredCandidate } from './scoringEngine';

/** Per-candidate user decision (UI state). Persisted only in memory for 5a. */
export type CandidateDecision = 'pending' | 'approved' | 'held' | 'discarded';

export interface CandidateCardModel {
  scored: ScoredCandidate;
  decision: CandidateDecision;
}

export interface EngineInput {
  bundle: CandidateBundle | null;
  chunks: Chunk[];
  outline: ParsedOutline | null;
  /** Free-text topic keywords (optional, augments outline node titles). */
  topicKeywords?: string[];
  existingEntries: WikiEntry[];
}

/** Collect outline node titles + topic keywords as the schema-fit keyword set. */
export function outlineKeywords(
  outline: ParsedOutline | null,
  topicKeywords: string[] = [],
): string[] {
  const fromOutline = (outline?.nodes ?? []).map((n) => n.title);
  return [...fromOutline, ...topicKeywords];
}

/**
 * Run the rule engine and wrap each scored candidate with an initial decision.
 * Returns [] when there is no bundle yet. Pure + deterministic.
 */
export function runCandidateEngine(input: EngineInput): CandidateCardModel[] {
  if (!input.bundle) return [];
  const keywords = outlineKeywords(input.outline, input.topicKeywords ?? []);
  const scored = scoreCandidates({
    candidates: input.bundle.candidate_items,
    chunks: input.chunks,
    outlineKeywords: keywords,
    existingEntries: input.existingEntries,
  });
  return scored.map((s) => ({ scored: s, decision: 'pending' as CandidateDecision }));
}

/** Korean label for a recommended action (UI). */
export const ACTION_LABEL: Record<ScoredCandidate['recommended_action'], string> = {
  create_new: '생성',
  update_existing: '보강',
  link_only: '링크',
  ignore: '무시',
};

/** Korean label for a user decision (UI). */
export const DECISION_LABEL: Record<CandidateDecision, string> = {
  pending: '미결정',
  approved: '승인됨',
  held: '보류됨',
  discarded: '폐기됨',
};
