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
 *
 * Pure: no I/O, no network, no LLM. Same (parsed, knownChunkIds) → same result.
 */

export type Confidence = 'high' | 'medium' | 'low';
const CONFIDENCE_VALUES: Confidence[] = ['high', 'medium', 'low'];

/** One evidence binding inside a validated candidate (binds to a REAL chunk). */
export interface ValidatedEvidence {
  chunk_id: string;
  quote: string;
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
  schema_field: string;
  summary_ko: string;
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
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
  knownChunkIds: Iterable<string>,
): ValidationResult {
  const known = new Set<string>(knownChunkIds);

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
        schema_field: '',
        summary_ko: '',
        evidence: [],
        rejectedEvidence: [],
        confidence: null,
        reason: '',
        importable: false,
        violations: [`후보 #${index + 1}이(가) 객체가 아닙니다.`],
      };
    }

    const title = asString(item.title).trim();
    const schema_field = asString(item.schema_field).trim();
    const summary_ko = asString(item.summary_ko).trim();
    const reason = asString(item.reason).trim();

    // 2. required fields.
    if (title.length === 0) violations.push('필수 필드 누락: title(제목)이 비어 있습니다.');

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
    for (let ei = 0; ei < rawEvidence.length; ei++) {
      const ev = rawEvidence[ei];
      const chunk_id = isObject(ev) ? asString(ev.chunk_id).trim() : '';
      const quote = isObject(ev) ? asString(ev.quote) : '';
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
      // Real, bound chunk_id: safe to keep as consumable evidence.
      evidence.push({ chunk_id, quote });
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

    return {
      index,
      title,
      schema_field,
      summary_ko,
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
