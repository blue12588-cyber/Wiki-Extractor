/**
 * Feedback submission — validation, payload shaping, POST, and graceful
 * degradation classification.
 *
 * Authority: agreed_contract.json (Slice 4)#AC-FEEDBACK-FORM +
 *            AC-FEEDBACK-SUBMIT + AC-FEEDBACK-DEGRADE + AC-FEEDBACK-RATE.
 *
 * Design split (so Tier-1 can test the logic without a network):
 *   - validateFeedback / buildPayload  — pure, no I/O.
 *   - classifyFailure                  — pure mapping (offline / 4xx / 5xx /
 *                                        throw) → a Korean user message + a
 *                                        machine `kind`.
 *   - submitFeedback                   — the only impure function; it calls the
 *                                        injected `fetch` so tests can drive it
 *                                        with a stub. On any failure the input
 *                                        is preserved by the caller (this fn
 *                                        never clears the form) and the app
 *                                        stays alive (no throw escapes).
 *
 * All user-facing strings are Korean (AC-KOREAN-UI). Login is NOT required to
 * submit feedback (AC-FEEDBACK-FORM).
 */

import type { ExtractionDiagnosticReport } from '$lib/diagnostics/extractionReport';

export const DIAGNOSTIC_REPORT_MAX_JSON_CHARS = 48_000;

const SUMMARY_PRESETS = [
  { candidates: 24, batches: 12, batchCandidates: 6, outlineNodes: 80, entries: 40 },
  { candidates: 14, batches: 8, batchCandidates: 4, outlineNodes: 60, entries: 25 },
  { candidates: 8, batches: 5, batchCandidates: 2, outlineNodes: 40, entries: 15 },
  { candidates: 3, batches: 3, batchCandidates: 1, outlineNodes: 24, entries: 8 },
  { candidates: 0, batches: 2, batchCandidates: 0, outlineNodes: 16, entries: 5 },
] as const;

export interface FeedbackInput {
  /** Optional subject line. */
  title: string;
  /** Required body. Empty / whitespace-only is rejected before any POST. */
  message: string;
  /** Optional reply-to address. When present it is sent as `email`. */
  email: string;
  /** Optional extraction diagnostic report, already redacted by the caller. */
  diagnosticReport?: ExtractionDiagnosticReport | null;
}

export interface FeedbackPayload {
  message: string;
  title?: string;
  /** Formspree treats `email` / `_replyto` as the reply-to address. */
  email?: string;
  /** Quiet Formspree's own e-mail notification subject when a title is set. */
  _subject?: string;
  /** Opt-in extraction report for algorithm debugging. */
  diagnostic_report?: ExtractionDiagnosticReport | Record<string, unknown>;
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; field: 'message'; message: string };

/** AC-FEEDBACK-FORM: content (message) is required; title/email are optional. */
export function validateFeedback(raw: FeedbackInput): FeedbackValidation {
  const message = raw.message.trim();
  if (message.length === 0) {
    return {
      ok: false,
      field: 'message',
      message: '내용을 입력해 주세요. 내용은 필수 항목입니다.',
    };
  }
  return {
    ok: true,
    value: {
        title: raw.title.trim(),
        message,
        email: raw.email.trim(),
        diagnosticReport: raw.diagnosticReport ?? null,
      },
  };
}

function fitDiagnosticReportForPayload(report: ExtractionDiagnosticReport): Record<string, unknown> {
  for (const preset of SUMMARY_PRESETS) {
    const summary = buildDiagnosticReportSummary(report, preset);
    const jsonChars = JSON.stringify(summary).length;
    if (jsonChars <= DIAGNOSTIC_REPORT_MAX_JSON_CHARS) {
      return {
        ...summary,
        summary_json_chars: jsonChars,
      };
    }
  }

  const minimal = buildDiagnosticReportSummary(report, SUMMARY_PRESETS[SUMMARY_PRESETS.length - 1]);
  const jsonChars = JSON.stringify(minimal).length;
  return {
    ...minimal,
    summary_json_chars: jsonChars,
    summary_over_target: jsonChars > DIAGNOSTIC_REPORT_MAX_JSON_CHARS,
  };
}

function text(value: unknown, max = 220): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function arrayOf<T>(value: T[] | undefined, limit: number): T[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

type SummaryPreset = (typeof SUMMARY_PRESETS)[number];

function buildDiagnosticReportSummary(
  report: ExtractionDiagnosticReport,
  preset: SummaryPreset,
): Record<string, unknown> {
  const outline = report.outline ?? { node_count: 0, root_count: 0, nodes: [] };
  const offlineCandidateSource = arrayOf(report.offline_candidates, Number.MAX_SAFE_INTEGER);
  const llmBatchSource = arrayOf(report.llm_batches, Number.MAX_SAFE_INTEGER);
  const persistedEntrySource = arrayOf(report.persisted_entries_summary, Number.MAX_SAFE_INTEGER);
  const offlineCandidates = arrayOf(report.offline_candidates, preset.candidates).map((cand) => ({
    candidate_id: cand.candidate_id,
    title: text(cand.title, 180),
    type: cand.type,
    recommended_action: cand.recommended_action,
    user_decision: cand.user_decision,
    target_entry_title: text(cand.target_entry_title, 160),
    mapped_outline: cand.mapped_outline
      ? {
          node_id: cand.mapped_outline.node_id,
          title: text(cand.mapped_outline.title, 180),
          score: cand.mapped_outline.score,
        }
      : null,
    original_terms: arrayOf(cand.original_terms, 10).map((term) => text(term, 60)).filter(Boolean),
    evidence: arrayOf(cand.evidence, 2).map((ev) => ({
      evidence_refs: arrayOf(ev.evidence_refs, 3),
      chunk_id: ev.chunk_id,
      page: ev.page,
      line: ev.line,
      context_excerpt: text(ev.context_excerpt, 240),
    })),
    rationale: {
      why: arrayOf(cand.rationale?.why, 4).map((item) => text(item, 160)).filter(Boolean),
      matched_keywords: arrayOf(cand.rationale?.matched_keywords, 8),
      claim_verbs: arrayOf(cand.rationale?.claim_verbs, 8),
      boundary: arrayOf(cand.rationale?.boundary, 3).map((item) => text(item, 140)).filter(Boolean),
      demotion: arrayOf(cand.rationale?.demotion, 3).map((item) => text(item, 140)).filter(Boolean),
    },
    step_judgment: arrayOf(cand.step_judgment, 5).map((step) => ({
      step: step.step,
      status: step.status,
      reason: text(step.reason, 160),
    })),
  }));

  const llmBatches = arrayOf(report.llm_batches, preset.batches).map((batch) => {
    const candidates = arrayOf(batch.candidates, preset.batchCandidates).map((cand) => ({
      index: cand.index,
      title: text(cand.title, 160),
      type: cand.type,
      importable: cand.importable,
      confidence: cand.confidence,
      discipline_profile: text(cand.discipline_profile, 100),
      discipline_unit: text(cand.discipline_unit, 100),
      mapped_schema_field: text(cand.mapped_schema_field, 100),
      mapping_reason: text(cand.mapping_reason, 180),
      violations: arrayOf(cand.violations, 4).map((item) => text(item, 140)).filter(Boolean),
      evidence: arrayOf(cand.evidence, 2).map((ev) => ({
        chunk_id: ev.chunk_id,
        page: ev.page,
        quote_excerpt: text(ev.quote_excerpt, 180),
        translation_ko_excerpt: text(ev.translation_ko_excerpt, 180),
        context_excerpt: text(ev.context_excerpt, 200),
      })),
      rejected_evidence_count: count(cand.rejected_evidence),
    }));

    return {
      source_id: batch.source_id,
      provider_ok: batch.provider_ok,
      provider_error: text(batch.provider_error, 220),
      parse_ok: batch.parse_ok,
      parse_error: text(batch.parse_error, 220),
      parse_recovered: batch.parse_recovered,
      parse_recovered_count: batch.parse_recovered_count,
      validation_shape_ok: batch.validation_shape_ok,
      validation_top_level_error: text(batch.validation_top_level_error, 220),
      candidate_count: count(batch.candidates),
      importable_count: Array.isArray(batch.candidates)
        ? batch.candidates.filter((cand) => cand.importable).length
        : 0,
      candidates,
      omitted_candidate_count: Math.max(count(batch.candidates) - candidates.length, 0),
      advanced_debug_summary: batch.advanced_debug
        ? {
            batch_index: batch.advanced_debug.batch_index,
            total_batches: batch.advanced_debug.total_batches,
            prompt_version: text(batch.advanced_debug.prompt_version, 80),
            prompt_char_count: batch.advanced_debug.prompt_char_count,
            chunk_ids: arrayOf(batch.advanced_debug.chunk_ids, 12),
            raw_response_included: false,
            source_chunk_samples_included: false,
          }
        : null,
    };
  });

  return {
    schema: report.schema,
    report_kind: 'summary',
    summary_only: true,
    created_at: report.created_at,
    summary_notice:
      '무료 피드백 전송을 위해 전체 로그 대신 핵심 요약 진단만 전송합니다. 사용자 피드백 본문은 요약하지 않습니다.',
    consent: {
      basic_diagnostic_included: true,
      advanced_debug_included: false,
      full_report_included: false,
    },
    privacy_guards: report.privacy_guards,
    app_context: report.app_context,
    source: report.source,
    text_quality: report.text_quality,
    outline: {
      node_count: outline.node_count,
      root_count: outline.root_count,
      nodes: arrayOf(outline.nodes, preset.outlineNodes),
      omitted_node_count: Math.max(outline.nodes.length - preset.outlineNodes, 0),
    },
    counts: report.counts ?? {},
    auto_wiki_progress: report.auto_wiki_progress,
    offline_candidates: offlineCandidates,
    omitted_offline_candidate_count: Math.max(
      offlineCandidateSource.length - offlineCandidates.length,
      0,
    ),
    llm_failure_summary: arrayOf(report.llm_failure_summary, 24).map((failure) => ({
      ...failure,
      reason: text(failure.reason, 240),
    })),
    llm_batches: llmBatches,
    omitted_llm_batch_count: Math.max(llmBatchSource.length - llmBatches.length, 0),
    persisted_entries_summary: arrayOf(report.persisted_entries_summary, preset.entries),
    omitted_persisted_entry_count: Math.max(
      persistedEntrySource.length - preset.entries,
      0,
    ),
    redaction_note: report.redaction_note,
    original_report_shape: {
      offline_candidate_count: offlineCandidateSource.length,
      llm_batch_count: llmBatchSource.length,
      persisted_entry_count: persistedEntrySource.length,
    },
    truncation_reason:
      '전체 진단 리포트가 길어질 수 있어 후보·배치·문맥은 대표 항목과 개수 요약으로 전송합니다.',
  };
}

/** Shape the JSON body. Optional fields are omitted (not sent as empty). */
export function buildPayload(input: FeedbackInput): FeedbackPayload {
  const payload: FeedbackPayload = { message: input.message.trim() };
  const title = input.title.trim();
  const email = input.email.trim();
  if (title.length > 0) {
    payload.title = title;
    payload._subject = `[llmwiki 피드백] ${title}`;
  }
  if (email.length > 0) payload.email = email;
  if (input.diagnosticReport) {
    payload.diagnostic_report = fitDiagnosticReportForPayload(input.diagnosticReport);
  }
  return payload;
}

export type FailureKind = 'offline' | 'client_4xx' | 'server_5xx' | 'unknown';

export interface SubmitFailure {
  ok: false;
  kind: FailureKind;
  /** Korean, user-facing. The app stays usable; input is preserved by caller. */
  message: string;
  /** Optional HTTP status for diagnostics (absent for offline / throw). */
  status?: number;
}

export interface SubmitSuccess {
  ok: true;
  /** Korean success notice; the caller resets the form after showing this. */
  message: string;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

/**
 * AC-FEEDBACK-DEGRADE: map a failure cause to a Korean message + kind.
 * `status` undefined ⇒ a thrown error / network unreachable (offline).
 */
export function classifyFailure(status: number | undefined): SubmitFailure {
  if (status === undefined) {
    return {
      ok: false,
      kind: 'offline',
      message:
        '네트워크에 연결할 수 없어 피드백을 전송하지 못했습니다. 입력하신 내용은 그대로 남겨 두었으니, 연결을 확인한 뒤 다시 시도해 주세요.',
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      kind: 'server_5xx',
      message:
        '피드백 서버에 일시적인 오류가 발생했습니다(서버 응답 ' +
        status +
        '). 입력 내용은 보존했습니다. 잠시 후 다시 시도해 주세요.',
      status,
    };
  }
  if (status >= 400) {
    return {
      ok: false,
      kind: 'client_4xx',
      message:
        '피드백을 전송하지 못했습니다(응답 ' +
        status +
        '). 입력 내용은 보존했습니다. 이메일 형식 등을 확인한 뒤 다시 시도해 주세요.',
      status,
    };
  }
  // Any other non-2xx we did not special-case.
  return {
    ok: false,
    kind: 'unknown',
    message:
      '피드백 전송 중 알 수 없는 응답을 받았습니다(응답 ' +
      status +
      '). 입력 내용은 보존했습니다. 다시 시도해 주세요.',
    status,
  };
}

const SUCCESS_MESSAGE = '피드백 전송 완료. 소중한 의견 감사합니다.';

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number }>;

/**
 * AC-FEEDBACK-SUBMIT: POST the JSON payload with `Accept: application/json`.
 * `fetchImpl` is injectable for tests; defaults to the global `fetch`.
 *
 * This function NEVER throws — a thrown network error is caught and mapped to
 * the offline classification, so the app never crashes (AC-FEEDBACK-DEGRADE).
 */
export async function submitFeedback(
  input: FeedbackInput,
  endpoint: string,
  fetchImpl?: FetchLike,
): Promise<SubmitResult> {
  const validation = validateFeedback(input);
  if (!validation.ok) {
    return { ok: false, kind: 'client_4xx', message: validation.message };
  }

  const doFetch: FetchLike =
    fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);

  const body = JSON.stringify(buildPayload(validation.value));

  let res: { ok: boolean; status: number };
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch {
    // Network unreachable / thrown error → offline degrade. App survives.
    return classifyFailure(undefined);
  }

  if (res.ok) {
    return { ok: true, message: SUCCESS_MESSAGE };
  }
  return classifyFailure(res.status);
}

export { SUCCESS_MESSAGE };
