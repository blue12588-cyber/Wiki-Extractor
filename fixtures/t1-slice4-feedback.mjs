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
