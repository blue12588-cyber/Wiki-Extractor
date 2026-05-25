/**
 * Wiki domain types — the persistent, editable knowledge surface.
 *
 * Authority: agreed_contract.json#AC-WIKI-PERSIST + AC-EDIT-PERSIST +
 *            AC-TRANSLATE + AC-ANNOTATION.
 * Ported structure from: harness-core/knowledge/academic/wiki layout
 *   (<entry>.md + index.json + links.json) and schemas/knowledge_entry.
 *
 * Original-text preservation invariant (HARD):
 *   `Claim.original_text` is a verbatim slice of the source. It is NEVER
 *   mutated. The Catholic-terminology translation lives in the separate
 *   `Claim.translated_text` field. The annotation shows translated-original
 *   ABOVE and untranslated-original BELOW.
 */

export type WikiStatus = 'draft' | 'reviewed' | 'verified' | 'deprecated' | 'superseded';

/** One evidence-bearing claim inside a wiki entry. */
export interface WikiClaim {
  /** Stable id within the entry. */
  claim_id: string;
  /** The Korean (Catholic-terminology) statement the user reads/edits. */
  statement: string;
  /**
   * Catholic-terminology Korean translation of the source passage. Shown ABOVE
   * in the annotation. May be empty when translation degraded (offline) — the
   * original is still shown.
   */
  translated_text: string;
  /**
   * VERBATIM original source passage. PRESERVED — never mutated by translation.
   * Shown BELOW in the annotation.
   */
  original_text: string;
  /** Source evidence locators (chunk id / page / line). */
  evidence_refs: string[];
  /** Originating candidate id, for lineage. */
  candidate_id: string | null;
}

export interface WikiEntry {
  id: string;
  title: string;
  category: string;
  status: WikiStatus;
  /** Outline node this entry maps to, or null. */
  outline_node_id: string | null;
  summary: string | null;
  claims: WikiClaim[];
  source_ids: string[];
  /** Source-visible original/core terms carried over from promoted candidates. */
  original_terms: string[];
  tags: string[];
  related: string[];
  created_from_candidates: string[];
  created_at: string | null;
  updated_at: string;
  review_notes: string | null;
}

/** index.json record (lightweight search projection). */
export interface WikiIndexRecord {
  id: string;
  title: string;
  category: string;
  status: WikiStatus;
  outline_node_id: string | null;
  source_ids: string[];
  updated_at: string;
}

/** links.json record (relation graph). */
export interface WikiLink {
  source_ref: string;
  target_ref: string;
  relation: string;
  status: 'proposed' | 'reviewed';
  rationale: string | null;
}
