import type { CandidateDecision } from './candidateEngine';

export interface CandidateReviewRecord {
  source_id: string;
  local_candidate_id: string;
  decision: CandidateDecision;
  updated_at: string;
}

export type CandidateReviewState = Record<string, CandidateReviewRecord>;

export function candidateReviewKey(source_id: string, local_candidate_id: string): string {
  return `${source_id}\u0000${local_candidate_id}`;
}
