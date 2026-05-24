/**
 * Demotion patterns — detect chunk text that is structurally NOT a reusable
 * knowledge unit (각주 / 참고문헌 / 목차 / 색인 / 판권 — footnotes, bibliography,
 * table of contents, index, copyright page).
 *
 * Authority: agreed_contract.json#AC-DEMOTE.
 * Ported from: harness-core/domains/academic/candidate-evaluator.md §"Action
 *   Guidance" — `reject` when "too source-specific" / "not reusable". The
 *   upstream LLM reviewer makes this judgement in prose; here it is a
 *   deterministic regex layer, so the demotion is reproducible and offline.
 *   (adaptation recorded in docs/adaptation-from-harness-core.md §"Slice 5a")
 *
 * Determinism contract:
 *   - Pure: same text → same DemoteSignal. No I/O, no LLM.
 *   - Each rule reports WHICH structural pattern fired, so the card rationale
 *     can name it ("참고문헌 패턴으로 감점") rather than showing a number.
 */

export type DemoteKind =
  | 'footnote'
  | 'bibliography'
  | 'table_of_contents'
  | 'index'
  | 'copyright';

export interface DemoteSignal {
  /** True when at least one structural demotion pattern fired. */
  demoted: boolean;
  /** Which patterns fired (stable order: footnote, biblio, toc, index, copyright). */
  kinds: DemoteKind[];
  /** Korean human-readable reason fragments for the card "주의/감점" line. */
  reasons: string[];
}

// --- Footnote: leading superscript-ish number marker + reference, or a run of
//     "1  Author, Title, p.NN" lines. Heuristic but deterministic.
const FOOTNOTE_RE =
  /(^|\n)\s*(\[?\d{1,3}\]?[.)]\s+).{0,40}(?:p\.|pp\.|쪽|면|참조|cf\.|ibid|op\. cit)/i;

// --- Bibliography / 참고문헌 heading or a dense "Author (Year). Title." run.
const BIBLIO_HEADING_RE =
  /(참고\s*문헌|인용\s*문헌|references|bibliography|works\s+cited)/i;
const BIBLIO_ENTRY_RE =
  /[A-Z][a-z]+,\s+[A-Z]\.?(?:\s*[A-Z]\.?)*\s*\(\d{4}\)/; // "Smith, J. (1999)"
const BIBLIO_CITATION_FRAGMENT_RE =
  /(?:see|cf\.|참조)\s+[A-Z][A-Za-z.'-]+|[A-Z][A-Za-z.'-]+,\s+[“"][^”"]{4,}[”"],?\s*\d{1,4}|[“"][^”"]{4,}[”"],?\s*\d{1,4}\s*[-–]\s*\d{1,4}/u;

// --- Table of contents / 목차 heading, or a dotted-leader + page-number line.
const TOC_HEADING_RE = /(목\s*차|table\s+of\s+contents|차\s*례)/i;
const TOC_LEADER_RE = /\.{4,}\s*\d{1,4}\s*$/m; // "Introduction ........ 12"

// --- Index / 색인 heading, or "term, 12, 45, 78" comma-number runs.
const INDEX_HEADING_RE = /(색\s*인|찾아보기|^\s*index\s*$)/im;
const INDEX_ENTRY_RE = /\S+,\s+\d{1,4}(?:,\s*\d{1,4}){2,}/; // "grace, 12, 45, 78"

// --- Copyright / 판권 / ISBN / 저작권.
const COPYRIGHT_RE =
  /(판\s*권|저작권|copyright|©|all\s+rights\s+reserved|ISBN[\s:]*[\d-]{10,})/i;

interface Rule {
  kind: DemoteKind;
  test: (t: string) => boolean;
  reason: string;
}

const RULES: Rule[] = [
  {
    kind: 'footnote',
    test: (t) => FOOTNOTE_RE.test(t),
    reason: '각주 패턴(번호 + 서지 약물)으로 위키 후보가 아닙니다',
  },
  {
    kind: 'bibliography',
    test: (t) => BIBLIO_HEADING_RE.test(t) || BIBLIO_ENTRY_RE.test(t) || BIBLIO_CITATION_FRAGMENT_RE.test(t),
    reason: '참고문헌/인용문헌 패턴으로 위키 후보가 아닙니다',
  },
  {
    kind: 'table_of_contents',
    test: (t) => TOC_HEADING_RE.test(t) || TOC_LEADER_RE.test(t),
    reason: '목차 패턴(점선 리더 + 쪽번호)으로 위키 후보가 아닙니다',
  },
  {
    kind: 'index',
    test: (t) => INDEX_HEADING_RE.test(t) || INDEX_ENTRY_RE.test(t),
    reason: '색인/찾아보기 패턴으로 위키 후보가 아닙니다',
  },
  {
    kind: 'copyright',
    test: (t) => COPYRIGHT_RE.test(t),
    reason: '판권/저작권/ISBN 패턴으로 위키 후보가 아닙니다',
  },
];

/**
 * Detect structural demotion patterns in chunk/candidate text. Pure.
 */
export function detectDemotion(text: string): DemoteSignal {
  const kinds: DemoteKind[] = [];
  const reasons: string[] = [];
  if (text) {
    for (const r of RULES) {
      if (r.test(text)) {
        kinds.push(r.kind);
        reasons.push(r.reason);
      }
    }
  }
  return { demoted: kinds.length > 0, kinds, reasons };
}
