/**
 * ChatGPT response validator — Slice 5b (AC-VALIDATE + AC-EVIDENCE-BIND).
 *
 * Authority: agreed_contract.json#AC-VALIDATE + AC-EVIDENCE-BIND + AC-OFFLINE-CORE.
 *
 * The SAFETY LAYER of the copy-paste bridge. A pasted ChatGPT reply is
 * untrusted: the model can hallucinate fake `chunk_id`s, drop required fields,
 * or emit the wrong shape. This module rejects anything that does not bind to
 * the REAL uploaded chunks, so forged evidence can never enter the wiki.
 *
 * Checks (each violation carries a clear Korean message):
 *   1. shape          — top-level `{ wiki_candidates: [...] }` array.
 *   2. required fields — each candidate has a non-empty `title` and at least
 *                        one `evidence` entry.
 *   3. evidence binding — EVERY `evidence[].chunk_id` exists in the set of REAL
 *                        chunk_ids the user actually uploaded (chunks.jsonl),
 *                        scoped to the candidate's own source. A candidate with
 *                        ANY unknown/forged chunk_id is REJECTED (not importable)
 *                        — this is the anti-forgery gate. Forged refs are
 *                        QUARANTINED into `rejectedEvidence`; only refs that bind
 *                        to a real chunk are kept on the consumable `evidence`.
 *   4. confidence enum — `confidence` ∈ {high, medium, low} when present.
 *   5. structure-only filter — TOC/section headings, standalone names, and
 *                        bibliography fragments are kept as source structure,
 *                        not importable wiki knowledge cards.
 *
 * Pure: no I/O, no network, no LLM. Same (parsed, knownChunkIds) → same result.
 */
import { structuralReasonForCandidate } from '../candidate/structuralFilter';
import type { CandidateType } from '../extract/candidateExtractor';
import { MAX_EVIDENCE_QUOTE_CHARS } from './evidenceLimits';

export type Confidence = 'high' | 'medium' | 'low';
const CONFIDENCE_VALUES: Confidence[] = ['high', 'medium', 'low'];
const CANDIDATE_TYPES: CandidateType[] = [
  'concept',
  'argument',
  'method',
  'scholar',
  'religious_text',
  'objection',
  'quotation',
  'other',
];
type CatholicTermRule = {
  term: string;
  preferred: string;
  skipWhenAlsoPresent?: string;
  religiousOnly?: boolean;
};
const CATHOLIC_TERM_RULES: CatholicTermRule[] = [
  { term: '하나님', preferred: '하느님' },
  { term: '여호와', preferred: '주님/하느님' },
  { term: '이신칭의', preferred: '의화' },
  { term: '칭의', preferred: '의화', skipWhenAlsoPresent: '이신칭의' },
  { term: '은혜', preferred: '은총', religiousOnly: true },
  { term: '사사기', preferred: '판관기' },
  { term: '출애굽기', preferred: '탈출기' },
  { term: '출애굽', preferred: '탈출', skipWhenAlsoPresent: '출애굽기' },
  { term: '마가복음', preferred: '마르코 복음' },
  { term: '마가 복음', preferred: '마르코 복음' },
  { term: '마태복음', preferred: '마태오 복음' },
  { term: '마태 복음', preferred: '마태오 복음' },
  { term: '누가복음', preferred: '루카 복음' },
  { term: '누가 복음', preferred: '루카 복음' },
  { term: '요한복음', preferred: '요한 복음' },
];
const RELIGIOUS_CONTEXT_MARKERS = [
  'religious_text',
  '성서',
  '성경',
  '종교',
  '신학',
  '가톨릭',
  '교회',
  '하느님',
  '하나님',
  '예수',
  '그리스도',
  '구원',
  '은총',
  '의화',
  '칭의',
  '판관기',
  '탈출기',
  '마르코',
  '마태오',
  '루카',
  '여호와',
  '시편',
  '복음',
];

/** One evidence binding inside a validated candidate (binds to a REAL chunk). */
export interface ValidatedEvidence {
  chunk_id: string;
  quote: string;
  /** Standard Korean translation of the cited quote/passage when the LLM supplies it. */
  translation_ko: string;
}

/**
 * One evidence ref that FAILED binding (forged/unknown chunk_id, or empty id).
 * Kept SEPARATE from `evidence` so the forged ref (and its model-authored quote)
 * never travels on the consumable evidence list and can never be read off a
 * candidate object downstream — only its rejection reason is exposed.
 */
export interface RejectedEvidence {
  /** The raw chunk_id the model claimed (display-only; not trusted). */
  claimed_chunk_id: string;
  /** Korean reason this ref was rejected. */
  reason: string;
}

/** A ChatGPT-proposed wiki candidate after validation. */
export interface ValidatedCandidate {
  index: number;
  title: string;
  type: CandidateType | null;
  discipline_profile: string;
  discipline_unit: string;
  schema_field: string;
  mapping_reason: string;
  summary_ko: string;
  standard_terms: string[];
  reuse_reason: string;
  boundary_note: string;
  /** ONLY evidence that binds to a real uploaded chunk_id. Safe to consume. */
  evidence: ValidatedEvidence[];
  /** Evidence refs that failed binding — quarantined, never imported. */
  rejectedEvidence: RejectedEvidence[];
  confidence: Confidence | null;
  reason: string;
  /** True = passes ALL checks and is importable. */
  importable: boolean;
  /** Korean violation messages (empty when importable). */
  violations: string[];
}

export interface ValidationResult {
  /** Top-level shape ok? (false → candidates is empty, topLevelError set). */
  shapeOk: boolean;
  topLevelError: string | null;
  candidates: ValidatedCandidate[];
  /** Convenience: only the importable candidates. */
  importable: ValidatedCandidate[];
}

export interface EvidenceAnchor {
  chunk_id: string;
  text?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = asString(item).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const key = s.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

function hasReligiousContext(fields: Array<{ label: string; text: string }>): boolean {
  const haystack = fields.map((field) => `${field.label}\n${field.text}`).join('\n');
  return RELIGIOUS_CONTEXT_MARKERS.some((marker) => haystack.includes(marker));
}

function catholicTermViolations(fields: Array<{ label: string; text: string }>): string[] {
  const violations: string[] = [];
  const religiousContext = hasReligiousContext(fields);
  for (const field of fields) {
    const text = field.text.trim();
    if (!text) continue;
    for (const rule of CATHOLIC_TERM_RULES) {
      if (rule.religiousOnly && !religiousContext) continue;
      if (rule.skipWhenAlsoPresent && text.includes(rule.skipWhenAlsoPresent)) continue;
      if (text.includes(rule.term)) {
        violations.push(
          `가톨릭 용어 표준 위반(${field.label}): "${rule.term}" 대신 "${rule.preferred}" 용어를 사용해야 합니다.`,
        );
      }
    }
  }
  return violations;
}

/**
 * Validate a parsed ChatGPT reply against the REAL uploaded chunk_ids.
 *
 * @param parsed         the object returned by responseParser (unknown shape).
 * @param knownChunkIds  the set/array of chunk_ids actually uploaded for this
 *                       source (from chunks.jsonl). The anti-forgery anchor.
 */
export function validateResponse(
  parsed: unknown,
  knownChunkIds: Iterable<string | EvidenceAnchor>,
): ValidationResult {
  const known = new Map<string, string | null>();
  for (const ref of knownChunkIds) {
    if (typeof ref === 'string') {
      known.set(ref, null);
    } else if (ref && typeof ref.chunk_id === 'string') {
      known.set(ref.chunk_id, typeof ref.text === 'string' ? ref.text : null);
    }
  }

  if (!isObject(parsed)) {
    return {
      shapeOk: false,
      topLevelError: '응답이 JSON 객체가 아닙니다. { "wiki_candidates": [ … ] } 형식이어야 합니다.',
      candidates: [],
      importable: [],
    };
  }
  const arr = (parsed as Record<string, unknown>).wiki_candidates;
  if (!Array.isArray(arr)) {
    return {
      shapeOk: false,
      topLevelError: '"wiki_candidates" 배열이 없습니다. 출력 형식을 확인하세요.',
      candidates: [],
      importable: [],
    };
  }

  const candidates: ValidatedCandidate[] = arr.map((item, index) => {
    const violations: string[] = [];

    if (!isObject(item)) {
      return {
        index,
        title: '',
        type: null,
        discipline_profile: '',
        discipline_unit: '',
        schema_field: '',
        mapping_reason: '',
        summary_ko: '',
        standard_terms: [],
        reuse_reason: '',
        boundary_note: '',
        evidence: [],
        rejectedEvidence: [],
        confidence: null,
        reason: '',
        importable: false,
        violations: [`후보 #${index + 1}이(가) 객체가 아닙니다.`],
      };
    }

    const title = asString(item.title).trim();
    const rawType = asString(item.type).trim();
    const discipline_profile = asString(item.discipline_profile).trim();
    const discipline_unit = asString(item.discipline_unit).trim();
    const schema_field = asString(item.schema_field).trim();
    const mapping_reason = asString(item.mapping_reason).trim();
    const summary_ko = asString(item.summary_ko).trim();
    const standard_terms = asStringArray(item.standard_terms);
    const reuse_reason = asString(item.reuse_reason).trim();
    const boundary_note = asString(item.boundary_note).trim();
    const reason = asString(item.reason).trim();

    // 2. required fields.
    if (title.length === 0) violations.push('필수 필드 누락: title(제목)이 비어 있습니다.');

    let type: CandidateType | null = 'other';
    if (rawType.length > 0) {
      if (CANDIDATE_TYPES.includes(rawType as CandidateType)) {
        type = rawType as CandidateType;
      } else {
        violations.push(
          `type 값이 올바르지 않습니다("${rawType}"). concept / argument / method / scholar / religious_text / objection / quotation / other 중 하나여야 합니다.`,
        );
      }
    }

    // 3. evidence + binding.
    const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
    if (rawEvidence.length === 0) {
      violations.push('필수 필드 누락: evidence(근거)가 비어 있습니다.');
    }
    // Passing evidence (binds to a real chunk) is kept STRICTLY apart from
    // rejected/forged evidence. A forged ref — and the model-authored quote it
    // carries — never lands on the consumable `evidence` array, so no downstream
    // path can read forged data off the candidate even if it forgets the
    // importable guard.
    const evidence: ValidatedEvidence[] = [];
    const rejectedEvidence: RejectedEvidence[] = [];
    const evidenceSeen = new Map<string, number>();
    for (let ei = 0; ei < rawEvidence.length; ei++) {
      const ev = rawEvidence[ei];
      const chunk_id = isObject(ev) ? asString(ev.chunk_id).trim() : '';
      const quote = isObject(ev) ? asString(ev.quote) : '';
      const translation_ko = isObject(ev) ? asString(ev.translation_ko).trim() : '';
      if (chunk_id.length === 0) {
        const reason = `근거 #${ei + 1}: chunk_id가 비어 있습니다.`;
        violations.push(reason);
        rejectedEvidence.push({ claimed_chunk_id: '', reason });
        continue;
      }
      if (!known.has(chunk_id)) {
        // ANTI-FORGERY GATE: a chunk_id that is not in the uploaded source is a
        // hallucinated/forged reference. The whole candidate is rejected and the
        // forged ref is QUARANTINED into rejectedEvidence (never `evidence`).
        const reason = `근거 위조 차단: chunk_id "${chunk_id}" 는 업로드한 원문 청크에 없습니다(존재하지 않는 근거). 이 후보는 가져올 수 없습니다.`;
        violations.push(reason);
        rejectedEvidence.push({ claimed_chunk_id: chunk_id, reason });
        continue;
      }
      const quoteClean = quote.trim();
      if (quoteClean.length === 0) {
        const reason = `근거 #${ei + 1}: quote가 비어 있습니다. 실제 원문에서 축자 인용한 짧은 문맥이 필요합니다.`;
        violations.push(reason);
        rejectedEvidence.push({ claimed_chunk_id: chunk_id, reason });
        continue;
      }
      if (quoteClean.length > MAX_EVIDENCE_QUOTE_CHARS) {
        const reason =
          `근거 #${ei + 1}: quote가 너무 깁니다(${quoteClean.length}자). ` +
          `${MAX_EVIDENCE_QUOTE_CHARS}자 이하의 짧은 주변 문맥만 근거로 사용할 수 있습니다.`;
        violations.push(reason);
        rejectedEvidence.push({ claimed_chunk_id: chunk_id, reason });
        continue;
      }
      const chunkText = known.get(chunk_id);
      if (chunkText != null && !chunkText.includes(quoteClean)) {
        const reason = `근거 #${ei + 1}: quote가 chunk_id "${chunk_id}" 원문에 축자로 포함되지 않습니다. 모델 요약/의역은 원문 근거로 가져올 수 없습니다.`;
        violations.push(reason);
        rejectedEvidence.push({ claimed_chunk_id: chunk_id, reason });
        continue;
      }
      // Real, bound chunk_id: safe to keep as consumable evidence.
      const evidenceKey = `${chunk_id}\u0000${quoteClean}`;
      const existingIndex = evidenceSeen.get(evidenceKey);
      if (existingIndex != null) {
        if (!evidence[existingIndex].translation_ko && translation_ko) {
          evidence[existingIndex] = { ...evidence[existingIndex], translation_ko };
        }
        continue;
      }
      evidenceSeen.set(evidenceKey, evidence.length);
      evidence.push({ chunk_id, quote: quoteClean, translation_ko });
    }

    // 4. confidence enum (optional, but if present must be valid).
    let confidence: Confidence | null = null;
    if (item.confidence != null) {
      const c = asString(item.confidence).trim().toLowerCase();
      if (CONFIDENCE_VALUES.includes(c as Confidence)) {
        confidence = c as Confidence;
      } else {
        violations.push(
          `confidence 값이 올바르지 않습니다("${asString(item.confidence)}"). high / medium / low 중 하나여야 합니다.`,
        );
      }
    }

    const structuralReason = structuralReasonForCandidate({
      title,
      type,
      schema_field,
      summary_ko,
      reason,
      evidence,
    });
    if (structuralReason) violations.push(structuralReason);

    violations.push(
      ...catholicTermViolations([
        { label: 'title', text: title },
        { label: 'type', text: type ?? '' },
        { label: 'discipline_profile', text: discipline_profile },
        { label: 'discipline_unit', text: discipline_unit },
        { label: 'summary_ko', text: summary_ko },
        { label: 'mapping_reason', text: mapping_reason },
        { label: 'reuse_reason', text: reuse_reason },
        { label: 'boundary_note', text: boundary_note },
        { label: 'reason', text: reason },
        ...standard_terms.map((term, ti) => ({
          label: `standard_terms #${ti + 1}`,
          text: term,
        })),
        ...evidence.map((ev, ei) => ({
          label: `evidence #${ei + 1} translation_ko`,
          text: ev.translation_ko,
        })),
      ]),
    );

    return {
      index,
      title,
      type,
      discipline_profile,
      discipline_unit,
      schema_field,
      mapping_reason,
      summary_ko,
      standard_terms,
      reuse_reason,
      boundary_note,
      evidence,
      rejectedEvidence,
      confidence,
      reason,
      importable: violations.length === 0,
      violations,
    };
  });

  return {
    shapeOk: true,
    topLevelError: null,
    candidates,
    importable: candidates.filter((c) => c.importable),
  };
}
