#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 4 feedback ACs (deterministic, NO network).
 *
 * Authority: agreed_contract.json (Slice 4)#AC-FEEDBACK-CONFIG +
 *            AC-FEEDBACK-SUBMIT + AC-FEEDBACK-DEGRADE + AC-FEEDBACK-FORM.
 *
 * Scenarios (run individually; exit 0 = pass):
 *   feedback-config-singlesource  endpoint comes from ONE config module and is
 *                                 the agreed Formspree form action.
 *   payload-shape                 buildPayload omits empty optional fields,
 *                                 always carries trimmed `message`, and the
 *                                 required-content validator blocks empty body.
 *   degrade-classify              offline / 4xx / 5xx map to distinct Korean
 *                                 messages + kinds; submitFeedback NEVER throws
 *                                 and PRESERVES input on failure (returns a
 *                                 failure result, no reset side-effect here).
 *   submit-success                a stub fetch returning ok:true yields the
 *                                 Korean success message (form reset is the
 *                                 view's job; logic returns ok:true).
 *
 * Usage: node --import tsx fixtures/t1-slice4-feedback.mjs <scenario>
 */

function pass(report) {
  console.log(JSON.stringify(report, null, 2));
  console.log('[ok]');
  process.exit(0);
}
function fail(report, msg) {
  console.log(JSON.stringify(report, null, 2));
  console.error(`[fail] ${msg}`);
  process.exit(1);
}

const EXPECTED_ENDPOINT = 'https://formspree.io/f/xjgzryoe';

async function feedbackConfigSingleSource() {
  const { FEEDBACK_ENDPOINT, feedbackConfig } = await import('../src/lib/feedback/config.ts');
  const cfg = feedbackConfig();
  const report = {
    scenario: 'feedback-config-singlesource',
    endpoint_constant: FEEDBACK_ENDPOINT,
    config_endpoint: cfg.endpoint,
    accept_header: cfg.accept,
    matches_agreed: FEEDBACK_ENDPOINT === EXPECTED_ENDPOINT,
    single_source: FEEDBACK_ENDPOINT === cfg.endpoint,
  };
  if (!report.matches_agreed) return fail(report, `endpoint is not the agreed Formspree action: ${FEEDBACK_ENDPOINT}`);
  if (!report.single_source) return fail(report, 'config.endpoint diverged from FEEDBACK_ENDPOINT (not single-source)');
  if (cfg.accept !== 'application/json') return fail(report, 'Accept header is not application/json');
  pass(report);
}

async function payloadShape() {
  const { validateFeedback, buildPayload } = await import('../src/lib/feedback/submit.ts');

  // Empty content is rejected (AC-FEEDBACK-FORM).
  const emptyVal = validateFeedback({ title: 'x', message: '   ', email: '' });
  // Full payload omits empty optionals; keeps trimmed message.
  const full = buildPayload({ title: '  버그 제목  ', message: '  본문 내용  ', email: '  a@b.com ' });
  // Minimal payload: only message, no title/email keys.
  const minimal = buildPayload({ title: '', message: '내용만', email: '' });

  const report = {
    scenario: 'payload-shape',
    empty_blocked: emptyVal.ok === false && emptyVal.field === 'message',
    empty_message_is_korean: emptyVal.ok === false && /내용/.test(emptyVal.message),
    full_message_trimmed: full.message === '본문 내용',
    full_has_title: full.title === '버그 제목',
    full_has_subject: typeof full._subject === 'string' && full._subject.includes('버그 제목'),
    full_has_email: full.email === 'a@b.com',
    minimal_only_message: minimal.message === '내용만' && !('title' in minimal) && !('email' in minimal) && !('_subject' in minimal),
  };
  if (!report.empty_blocked) return fail(report, 'empty/whitespace message was not blocked');
  if (!report.empty_message_is_korean) return fail(report, 'empty-content error is not Korean');
  if (!report.full_message_trimmed) return fail(report, 'message was not trimmed');
  if (!report.full_has_title || !report.full_has_email) return fail(report, 'optional title/email not carried when present');
  if (!report.minimal_only_message) return fail(report, 'empty optionals were sent instead of omitted');
  pass(report);
}

async function diagnosticReportPayload() {
  const { buildPayload, submitFeedback } = await import('../src/lib/feedback/submit.ts');
  const { readFileSync } = await import('node:fs');

  const diagnosticReport = {
    schema: 'llmwiki.extraction_diagnostic_report.v1',
    privacy_guards: {
      local_absolute_paths_included: false,
      api_keys_included: false,
      oauth_tokens_included: false,
      auth_json_included: false,
      file_name_included: false,
    },
    offline_candidates: [
      {
        title: 'T',
        type: 'argument',
        mapped_outline: { title: '1. 서론' },
        evidence: [{ chunk_id: 'chunk-1', page: 1, line: 2, context_excerpt: '짧은 문맥' }],
        step_judgment: [{ step: 'wiki_import', status: 'passed', reason: '저장됨' }],
      },
    ],
    llm_failure_summary: [{ reason: 'JSON 파싱 실패', parse_ok: false }],
    llm_batches: [
      {
        provider_ok: true,
        parse_ok: false,
        parse_error: 'JSON 파싱 실패',
        advanced_debug: null,
      },
    ],
  };
  const withReport = buildPayload({
    title: '리포트',
    message: '본문',
    email: '',
    diagnosticReport,
  });
  const noReport = buildPayload({
    title: '',
    message: '본문',
    email: '',
    diagnosticReport: null,
  });
  let sentBody = '';
  await submitFeedback(
    {
      title: '리포트',
      message: '본문',
      email: '',
      diagnosticReport,
    },
    'https://formspree.io/f/xjgzryoe',
    async (_url, init) => {
      sentBody = String(init?.body ?? '');
      return { ok: true, status: 200 };
    },
  );
  const sent = sentBody ? JSON.parse(sentBody) : {};
  const tab = readFileSync(new URL('../src/lib/components/views/FeedbackTab.svelte', import.meta.url), 'utf8');

  const report = {
    scenario: 'diagnostic-report-payload',
    attaches_report: withReport.diagnostic_report?.schema === 'llmwiki.extraction_diagnostic_report.v1',
    submit_attaches_report: sent.diagnostic_report?.schema === 'llmwiki.extraction_diagnostic_report.v1',
    omits_when_null: !('diagnostic_report' in noReport),
    includes_candidate_evidence_shape:
      withReport.diagnostic_report?.offline_candidates?.[0]?.evidence?.[0]?.context_excerpt === '짧은 문맥',
    includes_failure_reason:
      withReport.diagnostic_report?.llm_failure_summary?.[0]?.reason === 'JSON 파싱 실패',
    keeps_report_as_supplied:
      withReport.diagnostic_report?.llm_batches?.[0]?.advanced_debug === null,
    view_has_single_default_checked_report_checkbox:
      /id="fb-report"/.test(tab) &&
      !/id="fb-report-basic"/.test(tab) &&
      !/id="fb-report-advanced"/.test(tab) &&
      /추출 진단 리포트 포함/.test(tab) &&
      /let include_report = \$state\(true\)/.test(tab),
    view_sends_full_report_when_checked:
      /if \(!include_report\) return null;/.test(tab) &&
      /includeAdvancedDebug: true/.test(tab) &&
      /raw LLM 응답/.test(tab) &&
      /일부 원문 청크 발췌/.test(tab),
    view_resets_to_checked_after_success:
      /include_report = true;/.test(tab),
    view_mentions_report_can_be_disabled:
      /체크를 끄면 진단 리포트 전체를 보내지 않습니다/.test(tab),
    view_mentions_redaction:
      /API 키/.test(tab) && /OAuth 토큰/.test(tab) && /auth\.json/.test(tab) && /원본 파일명/.test(tab),
  };
  if (!report.attaches_report) return fail(report, 'diagnostic report not attached to payload');
  if (!report.submit_attaches_report) return fail(report, 'submitFeedback dropped diagnostic_report from the actual POST body');
  if (!report.omits_when_null) return fail(report, 'null diagnostic report should be omitted');
  if (!report.includes_candidate_evidence_shape) return fail(report, 'candidate evidence/context shape missing');
  if (!report.includes_failure_reason) return fail(report, 'LLM parse/failure reason missing');
  if (!report.keeps_report_as_supplied) return fail(report, 'payload should attach the already-built report without reshaping it');
  if (!report.view_has_single_default_checked_report_checkbox) return fail(report, 'FeedbackTab should expose one checked-by-default diagnostic checkbox');
  if (!report.view_sends_full_report_when_checked) return fail(report, 'checked diagnostic report should include advanced/raw debug fields');
  if (!report.view_resets_to_checked_after_success) return fail(report, 'FeedbackTab should reset the diagnostic checkbox to checked after success');
  if (!report.view_mentions_report_can_be_disabled) return fail(report, 'FeedbackTab should disclose that unchecking omits the full report');
  if (!report.view_mentions_redaction) return fail(report, 'FeedbackTab does not disclose redacted sensitive fields');
  pass(report);
}

async function diagnosticReportSourceFilter() {
  const { buildExtractionDiagnosticReport } = await import('../src/lib/diagnostics/extractionReport.ts');

  const makeEntry = (id, sourceId) => ({
    id,
    title: `entry-${id}`,
    category: 'extracted',
    status: 'draft',
    outline_node_id: null,
    summary: null,
    claims: [],
    source_ids: [sourceId],
    original_terms: [],
    tags: [],
    related: [],
    created_from_candidates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    review_notes: null,
  });
  const report = buildExtractionDiagnosticReport({
    bundle: {
      source_id: 'src-current',
      source_kind: 'plaintext',
      candidate_items: [],
      normalized_text: '',
    },
    chunks: [],
    textQuality: null,
    outline: null,
    entries: [makeEntry('keep', 'src-current'), makeEntry('drop', 'src-other')],
    candidateCards: [],
    llmCfg: {
      model: 'gpt-5.4',
      auth: 'oauth_subscription',
      endpoint_base: null,
      reachable: false,
    },
    autoWikiProgress: null,
    autoLlmTraces: [],
    includeAdvancedDebug: true,
  });
  const reportNoSource = buildExtractionDiagnosticReport({
    bundle: null,
    chunks: [],
    textQuality: null,
    outline: null,
    entries: [makeEntry('drop-nosource', 'src-other')],
    candidateCards: [],
    llmCfg: {
      model: 'gpt-5.4',
      auth: 'oauth_subscription',
      endpoint_base: null,
      reachable: false,
    },
    autoWikiProgress: null,
    autoLlmTraces: [],
    includeAdvancedDebug: true,
  });
  const result = {
    scenario: 'diagnostic-report-source-filter',
    keeps_current_source_only:
      report.persisted_entries_summary.length === 1 &&
      report.persisted_entries_summary[0].id === 'keep',
    no_source_sends_no_entries: reportNoSource.persisted_entries_summary.length === 0,
  };
  if (!result.keeps_current_source_only) return fail(result, 'report leaked entries from a different source');
  if (!result.no_source_sends_no_entries) return fail(result, 'report without a current source should not attach persisted wiki entries');
  pass(result);
}

async function diagnosticReportCompaction() {
  const { buildPayload, DIAGNOSTIC_REPORT_MAX_JSON_CHARS } = await import('../src/lib/feedback/submit.ts');
  const diagnosticReport = {
    schema: 'llmwiki.extraction_diagnostic_report.v1',
    created_at: '2026-01-01T00:00:00.000Z',
    consent: {},
    privacy_guards: {},
    app_context: {},
    source: {},
    text_quality: null,
    outline: { node_count: 0, root_count: 0, nodes: [] },
    counts: {},
    auto_wiki_progress: null,
    offline_candidates: [],
    llm_failure_summary: [],
    llm_batches: [
      {
        source_id: 'src',
        provider_ok: true,
        provider_error: null,
        parse_ok: true,
        parse_error: null,
        parse_recovered: false,
        parse_recovered_count: null,
        validation_shape_ok: true,
        validation_top_level_error: null,
        candidates: [],
        advanced_debug: {
          batch_index: 1,
          total_batches: 1,
          chunk_orders: [0],
          chunk_ids: ['chunk-1'],
          prompt_version: 'v',
          prompt_char_count: 1,
          raw_response: 'x'.repeat(DIAGNOSTIC_REPORT_MAX_JSON_CHARS + 10_000),
          source_chunk_samples: [],
        },
      },
    ],
    persisted_entries_summary: [],
    redaction_note: '',
  };
  const payload = buildPayload({
    title: '',
    message: '본문',
    email: '',
    diagnosticReport,
  });
  const report = {
    scenario: 'diagnostic-report-compaction',
    compacted: payload.diagnostic_report?.truncated === true,
    keeps_raw_excerpt:
      typeof payload.diagnostic_report?.llm_batches?.[0]?.advanced_debug?.raw_response_excerpt === 'string',
    drops_full_raw:
      !('raw_response' in (payload.diagnostic_report?.llm_batches?.[0]?.advanced_debug ?? {})),
  };
  if (!report.compacted) return fail(report, 'oversized diagnostic report was not compacted');
  if (!report.keeps_raw_excerpt) return fail(report, 'compacted report did not keep a raw response excerpt');
  if (!report.drops_full_raw) return fail(report, 'compacted report still carries the full raw response');
  pass(report);
}

async function degradeClassify() {
  const { classifyFailure, submitFeedback } = await import('../src/lib/feedback/submit.ts');

  const offline = classifyFailure(undefined);
  const c404 = classifyFailure(404);
  const c429 = classifyFailure(429);
  const s500 = classifyFailure(503);

  // submitFeedback must NEVER throw, even when fetch throws.
  const throwingFetch = async () => { throw new Error('network down'); };
  const onThrow = await submitFeedback(
    { title: '', message: '본문', email: '' },
    'https://formspree.io/f/xjgzryoe',
    throwingFetch,
  );

  // A 500 response (not a throw) classifies as server_5xx.
  const fiveHundredFetch = async () => ({ ok: false, status: 500 });
  const on500 = await submitFeedback(
    { title: '', message: '본문', email: '' },
    'https://formspree.io/f/xjgzryoe',
    fiveHundredFetch,
  );

  const allKorean = [offline, c404, c429, s500].every((r) => /[가-힣]/.test(r.message));

  const report = {
    scenario: 'degrade-classify',
    offline_kind: offline.kind,
    c404_kind: c404.kind,
    c429_kind: c429.kind,
    s500_kind: s500.kind,
    on_throw_offline: onThrow.ok === false && onThrow.kind === 'offline',
    on_500_server: on500.ok === false && on500.kind === 'server_5xx',
    all_messages_korean: allKorean,
    input_preserved_signal: onThrow.ok === false, // failure result -> caller keeps input
  };
  if (offline.kind !== 'offline') return fail(report, 'undefined status did not classify as offline');
  if (c404.kind !== 'client_4xx' || c429.kind !== 'client_4xx') return fail(report, '4xx not classified as client_4xx');
  if (s500.kind !== 'server_5xx') return fail(report, '5xx not classified as server_5xx');
  if (!report.on_throw_offline) return fail(report, 'thrown fetch did not become an offline failure (or threw)');
  if (!report.on_500_server) return fail(report, '500 response not classified as server_5xx via submitFeedback');
  if (!allKorean) return fail(report, 'a degrade message was not Korean');
  pass(report);
}

async function submitSuccess() {
  const { submitFeedback, SUCCESS_MESSAGE } = await import('../src/lib/feedback/submit.ts');
  let sentBody = null;
  let sentHeaders = null;
  const okFetch = async (url, init) => {
    sentBody = init?.body ?? null;
    sentHeaders = init?.headers ?? null;
    return { ok: true, status: 200 };
  };
  const res = await submitFeedback(
    { title: '제목', message: '  내용  ', email: 'me@x.io' },
    'https://formspree.io/f/xjgzryoe',
    okFetch,
  );
  const body = sentBody ? JSON.parse(sentBody) : {};
  const report = {
    scenario: 'submit-success',
    ok: res.ok === true,
    success_message: res.ok ? res.message : null,
    matches_constant: res.ok && res.message === SUCCESS_MESSAGE,
    accept_json: sentHeaders?.Accept === 'application/json',
    content_type_json: sentHeaders?.['Content-Type'] === 'application/json',
    body_message_trimmed: body.message === '내용',
  };
  if (!report.ok) return fail(report, 'ok:true fetch did not yield success');
  if (!report.matches_constant) return fail(report, 'success message diverged from SUCCESS_MESSAGE');
  if (!report.accept_json) return fail(report, 'Accept: application/json header missing');
  if (!report.body_message_trimmed) return fail(report, 'POST body message was not trimmed');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  'feedback-config-singlesource': feedbackConfigSingleSource,
  'payload-shape': payloadShape,
  'diagnostic-report-payload': diagnosticReportPayload,
  'diagnostic-report-source-filter': diagnosticReportSourceFilter,
  'diagnostic-report-compaction': diagnosticReportCompaction,
  'degrade-classify': degradeClassify,
  'submit-success': submitSuccess,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice4-feedback.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
