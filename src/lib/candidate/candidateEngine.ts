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

/** Per-candidate user decision (UI state, persisted by the pipeline under data/candidates/). */
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

function decisionKey(card: CandidateCardModel): string {
  const c = card.scored.candidate;
  return `${c.source_id}\u0000${c.local_candidate_id}`;
}

/**
 * Re-apply existing review decisions after the deterministic engine refreshes.
 * The score/action may change, but a user's 승인/보류/폐기 choice belongs to
 * the same source-local candidate id and must not be lost during wiki build.
 */
export function carryCandidateDecisions(
  fresh: CandidateCardModel[],
  previous: CandidateCardModel[],
): CandidateCardModel[] {
  const decisions = new Map(previous.map((card) => [decisionKey(card), card.decision]));
  return fresh.map((card) => {
    const decision = decisions.get(decisionKey(card));
    return decision ? { ...card, decision } : card;
  });
}

export function shouldSaveOfflineCard(card: CandidateCardModel): boolean {
  if (card.scored.recommended_action === 'ignore') return false;
  return card.decision !== 'held' && card.decision !== 'discarded';
}

export function selectOfflineWikiCardsForSave(cards: CandidateCardModel[]): CandidateCardModel[] {
  return cards.filter(shouldSaveOfflineCard);
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
