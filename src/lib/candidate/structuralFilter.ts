/**
 * Structural-candidate filter.
 *
 * 목차/장 제목/저자명/참고문헌 조각은 소스 구조를 이해하기 위한 메타데이터이지,
 * 위키에 저장할 재사용 지식 카드가 아니다. 이 모듈은 오프라인 후보와 LLM 후보에
 * 공통으로 적용되는 낮은 권위의 방어막이다.
 */

import { countClaimVerbs } from './claimVerbs';
import { detectDemotion } from './demotePatterns';

export interface StructuralEvidenceLike {
  quote?: string;
  translation_ko?: string;
}

export interface StructuralCandidateLike {
  title?: string;
  type?: string | null;
  schema_field?: string;
  summary?: string;
  summary_ko?: string;
  reason?: string;
  evidence_text?: string;
  evidence?: StructuralEvidenceLike[];
}

export interface StructuralScreen {
  structural: boolean;
  reason: string | null;
}

const SECTION_MARKER_RE =
  /^\s*(?:(?:chapter|chap\.?|part|section|appendix)\s+[\divxlcdm]+|postscript\b|introduction\b|conclusion\b|\d+(?:\.\d+)*[.)]?\s+\S|제\s*\d+\s*(?:장|절|부|편))/i;

const ALL_CAPS_AUTHOR_LINE_RE =
  /^\s*[A-Z][A-Z.'-]+(?:\s+[A-Z][A-Z.'-]+){1,5}\s*$/;

const BIBLIO_CITATION_RE =
  /(?:see|cf\.|참조)\s+[A-Z][A-Za-z.'-]+|[A-Z][A-Za-z.'-]+,\s+[“"][^”"]{4,}[”"],?\s*\d{1,4}|[“"][^”"]{4,}[”"],?\s*\d{1,4}\s*[-–]\s*\d{1,4}/u;

const PERSON_STOPWORDS = new Set([
  'and',
  'of',
  'the',
  'in',
  'on',
  'for',
  'with',
  'land',
  'death',
  'bible',
  'biblical',
  'hebrew',
]);

const PERSON_NAME_PARTICLES = new Set(['de', 'del', 'der', 'la', 'le', 'van', 'von']);

const ACADEMIC_CONCEPT_STOPWORDS = new Set([
  'apocalypse',
  'canon',
  'christology',
  'church',
  'covenant',
  'criticism',
  'deuteronomistic',
  'divine',
  'ecclesiology',
  'eschatology',
  'exile',
  'form',
  'gospel',
  'holy',
  'kingship',
  'law',
  'literature',
  'mount',
  'narrative',
  'priestly',
  'prophecy',
  'redaction',
  'ritual',
  'sacrifice',
  'scripture',
  'sinai',
  'source',
  'spirit',
  'temple',
  'theology',
  'tradition',
  'wisdom',
]);

const SHORT_QUOTATION_FRAGMENT_MAX = 32;

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function firstLine(text: string): string {
  return lines(text)[0] ?? '';
}

function compact(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function wordTokens(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function isLikelyPersonNameOnly(title: string): boolean {
  const tokens = wordTokens(title.replace(/[,:;]+$/g, ''));
  if (tokens.length < 2 || tokens.length > 5) return false;
  let fullNameParts = 0;
  let initialParts = 0;
  let particleParts = 0;
  for (const token of tokens) {
    const cleaned = token.replace(/[.,:;]+$/g, '');
    const lower = cleaned.toLocaleLowerCase();
    if (PERSON_NAME_PARTICLES.has(lower)) {
      particleParts += 1;
      continue;
    }
    if (PERSON_STOPWORDS.has(lower)) return false;
    if (ACADEMIC_CONCEPT_STOPWORDS.has(lower)) return false;
    if (/^[A-Z]$/.test(cleaned)) {
      initialParts += 1;
      continue;
    }
    if (/^[A-Z][a-zA-Z.'-]+$/.test(cleaned)) {
      fullNameParts += 1;
      continue;
    }
    return false;
  }
  return fullNameParts >= 2 || (fullNameParts >= 1 && initialParts >= 1) || (particleParts > 0 && fullNameParts >= 1);
}

function shouldApplyPersonNameFilter(type: string | null | undefined): boolean {
  // The LLM may mislabel a standalone author/editor name as "concept" or
  // "argument". Apply the name-only guard broadly, while the academic concept
  // stopword escape in isLikelyPersonNameOnly keeps short real concepts such as
  // "Divine Kingship" and "Source Criticism" importable.
  return type !== 'quotation';
}

function isAllCapsAuthorList(text: string): boolean {
  const relevant = lines(text).slice(0, 4);
  return relevant.length > 0 && relevant.every((line) => ALL_CAPS_AUTHOR_LINE_RE.test(line));
}

function isNearDuplicate(a: string, b: string): boolean {
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

function hasOnlyShortLabelLines(text: string): boolean {
  const relevant = lines(text);
  if (relevant.length === 0 || relevant.length > 4) return false;
  return relevant.every((line) => line.length <= 150);
}

function evidenceText(input: StructuralCandidateLike): string {
  return [
    input.evidence_text ?? '',
    ...(input.evidence ?? []).flatMap((ev) => [ev.quote ?? '', ev.translation_ko ?? '']),
  ].filter(Boolean).join('\n');
}

function bodyText(input: StructuralCandidateLike): string {
  return [
    input.summary ?? '',
    input.summary_ko ?? '',
    input.reason ?? '',
    evidenceText(input),
  ].filter(Boolean).join('\n');
}

export function structuralReasonForCandidate(input: StructuralCandidateLike): string | null {
  const title = (input.title ?? '').trim();
  const body = bodyText(input);
  const evidence = evidenceText(input);
  const combined = [title, input.schema_field ?? '', body].filter(Boolean).join('\n');
  const claimVerbCount = countClaimVerbs(combined);

  const demote = detectDemotion(combined);
  if (demote.demoted && claimVerbCount === 0) {
    return `구조 정보 후보 제외: ${demote.reasons.join(' / ')}`;
  }

  if (BIBLIO_CITATION_RE.test(combined) && claimVerbCount === 0) {
    return '구조 정보 후보 제외: 참고문헌/각주 인용 조각은 위키 지식 카드가 아닙니다.';
  }

  if (
    input.type === 'quotation' &&
    claimVerbCount === 0 &&
    compact(title).length > 0 &&
    compact(title).length < SHORT_QUOTATION_FRAGMENT_MAX &&
    hasOnlyShortLabelLines(body || evidence || title)
  ) {
    return '구조 정보 후보 제외: 너무 짧은 인용 파편은 위키 지식 카드가 아닙니다.';
  }

  if (input.type === 'quotation' && claimVerbCount === 0) {
    return '구조 정보 후보 제외: 직접 인용만 있는 항목은 위키 지식 카드가 아닙니다. 주장·개념·방법과 연결된 근거로만 사용하세요.';
  }

  const titleLooksSection = SECTION_MARKER_RE.test(title);
  const bodyLooksSection = SECTION_MARKER_RE.test(firstLine(body)) || SECTION_MARKER_RE.test(firstLine(evidence));
  if ((titleLooksSection || bodyLooksSection) && claimVerbCount === 0 && hasOnlyShortLabelLines(body || title)) {
    return '구조 정보 후보 제외: 장·절 제목/목차 항목은 분류용 구조로만 사용합니다.';
  }

  if (
    shouldApplyPersonNameFilter(input.type) &&
    isLikelyPersonNameOnly(title) &&
    claimVerbCount === 0 &&
    (isAllCapsAuthorList(body) || isNearDuplicate(title, body) || hasOnlyShortLabelLines(body))
  ) {
    return '구조 정보 후보 제외: 단독 저자명/편집자명은 위키 지식 카드가 아닙니다.';
  }

  return null;
}

export function screenStructuralCandidate(input: StructuralCandidateLike): StructuralScreen {
  const reason = structuralReasonForCandidate(input);
  return { structural: reason !== null, reason };
}
