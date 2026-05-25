/**
 * Original/core term extraction.
 *
 * Deterministic helper for source-visible terms that tend to survive local
 * wiki promotion: Greek/Hebrew forms, scholarly abbreviations, hyphenated
 * method labels, and a compact method-term lexicon. No LLM, no I/O.
 */

const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 80;

const GREEK_RE = /[\p{Script=Greek}][\p{Script=Greek}\p{M}\u0300-\u036f·'’-]{1,}/gu;
const HEBREW_RE = /[\p{Script=Hebrew}][\p{Script=Hebrew}\p{M}\u0591-\u05c7־-]{1,}/gu;
const ABBREV_RE = /\b(?:[A-Z]{2,8}\d{0,2}|[A-Z]{1,4}\d{2,4})\b/g;
const HYPHEN_TERM_RE = /\b[A-Za-z][A-Za-z]+(?:-[A-Za-z]+){1,3}\b/g;

const METHOD_TERMS = [
  'figural interpretation',
  'gospel-shaped hermeneutic',
  'inverted allusion',
  'intertextuality',
  'intertextual',
  'metalepsis',
  'metaleptic',
  'leitwortstil',
  'leitwort',
  'narrative poetics',
  'reading backwards',
  'rhetorical situation',
  'socio-rhetorical',
  'inner texture',
  'intertexture',
  'ideological texture',
  'translation technique',
  'textual criticism',
  'sensus plenior',
  'ad hoc',
  'a priori',
  'a posteriori',
  'Sitz im Leben',
  'typology',
  'Old Greek',
  'Septuagint',
  'Masoretic Text',
];

const METHOD_TERMS_LOWER = new Set(METHOD_TERMS.map((term) => term.toLocaleLowerCase()));
const TECHNICAL_HYPHEN_PARTS = new Set([
  'biblical',
  'critical',
  'criticism',
  'exilic',
  'form',
  'gospel',
  'historical',
  'inner',
  'inter',
  'literary',
  'redaction',
  'rhetorical',
  'second',
  'shaped',
  'socio',
  'source',
  'temple',
  'text',
  'textual',
  'theological',
]);
const NOISY_HYPHEN_TERMS = new Set([
  'well-known',
  'well-defined',
  'mother-in-law',
  'father-in-law',
  'brother-in-law',
  'sister-in-law',
]);
const NOISY_ABBREVIATIONS = new Set([
  'API',
  'CSS',
  'EU',
  'FAQ',
  'HTML',
  'HTTP',
  'ISBN',
  'JSON',
  'LLM',
  'NASA',
  'OCR',
  'PDF',
  'SQL',
  'UK',
  'UN',
  'URL',
  'USA',
  'XML',
]);

function normalizeTerm(term: string): string {
  return term
    .replace(/^[\s"'“”‘’.,;:()[\]{}]+|[\s"'“”‘’.,;:()[\]{}]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addTerm(out: string[], seen: Set<string>, term: string) {
  const clean = normalizeTerm(term);
  if (clean.length < 2 || clean.length > MAX_TERM_LENGTH) return;
  if (NOISY_ABBREVIATIONS.has(clean)) return;
  const key = clean.toLocaleLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(clean);
}

function isLikelyTechnicalHyphenTerm(term: string): boolean {
  const lower = normalizeTerm(term).toLocaleLowerCase();
  if (!lower || NOISY_HYPHEN_TERMS.has(lower)) return false;
  if (METHOD_TERMS_LOWER.has(lower)) return true;
  const parts = lower.split('-');
  if (parts.some((part) => part.length < 3)) return false;
  return parts.some((part) => TECHNICAL_HYPHEN_PARTS.has(part));
}

export function extractOriginalTerms(text: string, maxTerms = MAX_TERMS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const source = text ?? '';

  for (const term of METHOD_TERMS) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(source)) addTerm(out, seen, term);
  }
  for (const re of [GREEK_RE, HEBREW_RE, ABBREV_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m !== null; m = re.exec(source)) {
      addTerm(out, seen, m[0]);
      if (out.length >= maxTerms) return out;
    }
  }
  HYPHEN_TERM_RE.lastIndex = 0;
  for (let m = HYPHEN_TERM_RE.exec(source); m !== null; m = HYPHEN_TERM_RE.exec(source)) {
    if (!isLikelyTechnicalHyphenTerm(m[0])) continue;
    addTerm(out, seen, m[0]);
    if (out.length >= maxTerms) return out;
  }
  return out.slice(0, maxTerms);
}
