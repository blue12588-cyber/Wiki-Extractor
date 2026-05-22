/**
 * Keyword + synonym matching — the substrate of the "스키마 적합도" (schema-fit)
 * criterion and of the dedup similarity check.
 *
 * Authority: agreed_contract.json#AC-RULE-ENGINE(criterion 1) + AC-SCHEMA-INPUT
 *            + AC-DEDUP.
 * Ported from: harness-core/knowledge/academic/index.json record shape
 *   (title / tags / original_terms) — those fields are the comparison surface
 *   the upstream wiki uses for relatedness; here we reuse the same surface for a
 *   deterministic, offline token-overlap score (no embeddings, no LLM).
 *   (adaptation recorded in docs/adaptation-from-harness-core.md §"Slice 5a")
 *
 * Determinism contract:
 *   - Pure: same inputs → same tokens / same overlap. No I/O, no LLM.
 *   - Tokenization is locale-light: it lowercases, splits on non-(letter|digit|
 *     CJK) runs, drops 1-char ASCII tokens and a small stopword set, and keeps
 *     CJK runs whole. This is intentionally simple and reproducible.
 */

// A compact bilingual stopword set. Kept small on purpose: over-aggressive
// stopwording hurts recall on short academic titles.
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'as', 'is', 'are',
  'for', 'with', 'by', 'at', 'be', 'this', 'that', 'it', 'its', 'from',
  // Korean particles / light words (whole-token)
  '그리고', '또는', '그', '이', '저', '것', '수', '등', '및', '에', '의',
]);

/** A modest synonym map (academic-leaning). Bidirectional expansion. */
const SYNONYMS: Record<string, string[]> = {
  // English ↔ Korean conceptual pairs relevant to the academic wiki domain.
  typology: ['모형론', '예표론'],
  hermeneutic: ['해석학', 'hermeneutics'],
  hermeneutics: ['해석학', 'hermeneutic'],
  allusion: ['암시', '인유'],
  intertextuality: ['상호텍스트성', 'intertextual'],
  intertextual: ['상호텍스트성', 'intertextuality'],
  exile: ['유배', '포로'],
  covenant: ['계약', '언약'],
  kingdom: ['나라', '왕국'],
  passion: ['수난'],
  psalm: ['시편'],
  // Korean → English back-pointers (so an outline pasted in Korean still hits
  // English source terms).
  해석학: ['hermeneutic', 'hermeneutics'],
  모형론: ['typology'],
  예표론: ['typology'],
  상호텍스트성: ['intertextuality', 'intertextual'],
  유배: ['exile'],
  계약: ['covenant'],
  언약: ['covenant'],
  수난: ['passion'],
  시편: ['psalm'],
};

const TOKEN_SPLIT_RE = /[^\p{L}\p{N}]+/u;

/**
 * Tokenize text into a normalized, deduped token set. Pure + deterministic.
 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  const parts = text.toLowerCase().split(TOKEN_SPLIT_RE);
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    // Drop 1-char ASCII tokens (noise) but keep 1-char CJK (meaningful).
    if (t.length === 1 && /[a-z0-9]/.test(t)) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

/** Expand a token set with known synonyms (one hop). Pure. */
export function expandSynonyms(tokens: Set<string>): Set<string> {
  const out = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) out.add(s.toLowerCase());
  }
  return out;
}

/**
 * Count how many of `needleTokens` (synonym-expanded) appear in `haystackText`.
 * Used by the schema-fit criterion: needle = outline/topic keywords, haystack =
 * candidate title + evidence text.
 */
export function overlapCount(needleTokens: Set<string>, haystackText: string): number {
  const hay = tokenize(haystackText);
  const expanded = expandSynonyms(needleTokens);
  let n = 0;
  for (const t of expanded) if (hay.has(t)) n += 1;
  return n;
}

/** The matched terms (for human-readable rationale), in needle order. */
export function overlapTerms(needleTokens: Set<string>, haystackText: string): string[] {
  const hay = tokenize(haystackText);
  const expanded = expandSynonyms(needleTokens);
  const matched: string[] = [];
  for (const t of expanded) if (hay.has(t)) matched.push(t);
  return matched;
}

/**
 * Jaccard-style overlap ratio between two texts' token sets (synonym-expanded
 * on both sides). Range [0, 1]. Used by the dedup similarity check.
 */
export function tokenSimilarity(a: string, b: string): number {
  const ta = expandSynonyms(tokenize(a));
  const tb = expandSynonyms(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}
