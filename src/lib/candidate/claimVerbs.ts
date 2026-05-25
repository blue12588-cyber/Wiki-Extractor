/**
 * Claim-verb lexicon — bilingual (English / Korean) detection of *assertion*
 * verbs, used by the rule-based scoring engine's "주장 강도" (claim strength)
 * criterion.
 *
 * Authority: agreed_contract.json#AC-RULE-ENGINE (criterion 2 — 주장 강도) +
 *            forbidden_side_effects(no network / no LLM).
 *
 * Ported from: harness-core/domains/academic/source-extractor.md §"Extraction
 *   Units" (`argument`: claim with grounds) + candidate-evaluator.md §"Review
 *   Criteria" (standalone reuse value). The upstream prose role-prompt expects
 *   an LLM to *judge* whether a chunk asserts a claim; here we collapse that
 *   judgement into a deterministic verb lexicon — no model call.
 *   (adaptation recorded in docs/adaptation-from-harness-core.md §"Slice 5a")
 *
 * Determinism contract:
 *   - Pure: same text → same matches → same count. No I/O, no Date, no random.
 *   - Matching is case-insensitive for English; Korean verbs match on their
 *     dictionary + common conjugated endings.
 *   - Word-boundary anchored for English so "arguably" does not match "argues".
 */

/** English assertion verbs (lemmas). Matched with \b…(s|es|ed|ing)? \b. */
export const EN_CLAIM_VERBS = [
  'argue',
  'suggest',
  'define',
  'distinguish',
  'conclude',
  'claim',
  'maintain',
  'propose',
  'contend',
  'demonstrate',
  'show',
  'assert',
] as const;

/**
 * Korean assertion verbs. Korean conjugates the stem, so we match the stem
 * followed by any of the common declarative/connective endings. The stems are
 * the dictionary forms requested by the contract plus close synonyms.
 */
export const KO_CLAIM_STEMS = [
  '주장', // 주장한다 / 주장하며 / 주장했다
  '제안', // 제안한다
  '정의', // 정의한다
  '구분', // 구분한다
  '구별', // 구별한다
  '결론', // 결론짓는다 / 결론내린다
  '지적', // 지적한다
  '논증', // 논증한다
  '강조', // 강조한다
  '제시', // 제시한다
] as const;

// Korean verb endings that turn a 하다-stem into an assertion. We keep this
// list explicit (not a greedy .*) so the match stays deterministic and tight.
const KO_ENDINGS = [
  '한다',
  '하며',
  '하고',
  '했다',
  '하였다',
  '하는',
  '하기',
  '함',
];

// 결론 is special: it pairs with 짓다/내리다 rather than 하다.
const KO_SPECIAL = [
  '결론짓는다',
  '결론지었다',
  '결론내린다',
  '결론내렸다',
];

function buildEnRegex(): RegExp {
  // e.g. \b(argue|suggest|...)(s|es|ed|ing|d)?\b
  const alt = EN_CLAIM_VERBS.join('|');
  return new RegExp(`\\b(?:${alt})(?:s|es|ed|ing|d)?\\b`, 'gi');
}

function buildKoRegexes(): RegExp[] {
  const out: RegExp[] = [];
  for (const stem of KO_CLAIM_STEMS) {
    if (stem === '결론') continue; // handled by KO_SPECIAL below
    const endingAlt = KO_ENDINGS.join('|');
    out.push(new RegExp(`${stem}(?:${endingAlt})`, 'g'));
  }
  for (const sp of KO_SPECIAL) out.push(new RegExp(sp, 'g'));
  return out;
}

const EN_RE = buildEnRegex();
const KO_RES = buildKoRegexes();

export interface ClaimVerbHit {
  /** The matched surface form (verbatim from the text). */
  match: string;
  /** 'en' | 'ko' language bucket. */
  lang: 'en' | 'ko';
}

function keepEnglishHit(text: string, start: number, end: number, match: string): boolean {
  const lower = match.toLocaleLowerCase();
  const before = text.slice(Math.max(0, start - 24), start).toLocaleLowerCase();
  const after = text.slice(end, end + 24).toLocaleLowerCase();

  if (/^shows?$|^showed$|^showing$/.test(lower) && /^\s+up\b/.test(after)) return false;
  if (/^claims?$/.test(lower) && /\b(?:the|a|an|this|that|these|those|no)\s+$/.test(before)) {
    return false;
  }
  if ((lower === 'defined' || lower === 'defining') && /-\s*$/.test(before)) return false;
  if (lower === 'proposed' && /\b(?:the|a|an|this|that|these|those)\s+$/.test(before)) {
    return false;
  }
  return true;
}

/**
 * Detect every assertion-verb occurrence in `text`. Deterministic and pure.
 * Returns hits in left-to-right document order (English scan then Korean scan,
 * each in match order); the *count* is what the scorer consumes, while the
 * surface forms feed the human-readable card rationale.
 */
export function detectClaimVerbs(text: string): ClaimVerbHit[] {
  const hits: ClaimVerbHit[] = [];
  if (!text) return hits;

  EN_RE.lastIndex = 0;
  for (let m = EN_RE.exec(text); m !== null; m = EN_RE.exec(text)) {
    if (!keepEnglishHit(text, m.index, m.index + m[0].length, m[0])) continue;
    hits.push({ match: m[0], lang: 'en' });
  }
  for (const re of KO_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      hits.push({ match: m[0], lang: 'ko' });
    }
  }
  return hits;
}

/** Convenience: number of assertion-verb occurrences. */
export function countClaimVerbs(text: string): number {
  return detectClaimVerbs(text).length;
}
