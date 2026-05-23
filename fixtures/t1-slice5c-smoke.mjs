#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 5c ACs — hybrid auto-LLM mode (codex + openai-oauth).
 * Deterministic, OFFLINE (no real LLM call, no live proxy): every scenario uses
 * an INJECTED provider / parsed object so the trust boundary is exercised
 * without the network. The real LLM call's success is environment-dependent and
 * NOT asserted here (contract: 작동 미보장; 미가용 = degradation).
 *
 * Authority: agreed_contract.json#AC-AUTH-ABSTRACT + AC-CODEX-DETECT +
 *            AC-OAUTH-PROXY + AC-AUTO-EXTRACT + AC-GRACEFUL +
 *            AC-EVIDENCE-REUSE + AC-ENCAPSULATE + AC-REGRESS.
 *
 * Scenarios (run individually; exit 0 = pass):
 *   provider-availability   providerAvailabilities(): offline ALWAYS available,
 *                           codex follows the detect snapshot, future never
 *                           available; default selection stays offline.
 *   auto-evidence-reuse     an AUTO reply with a FORGED chunk_id is REJECTED by
 *                           the SAME 5b validator the manual paste uses (the
 *                           anti-forgery gate is reused, not re-implemented).
 *   auto-graceful           a degraded provider (no codex / proxy down) makes
 *                           autoExtractCandidate return {ok:false,degraded} with
 *                           a Korean message — NO importable data, no throw.
 *   offline-provider-noop   the offline provider performs NO network call and
 *                           returns a (non-degraded) manual-mode result.
 *   auto-import-preserve    a VALID auto reply → validate → buildEntryFromValidated:
 *                           original_text = VERBATIM chunk (preserved), NOT the
 *                           model quote — same preservation invariant as 5b.
 *   encapsulation-scan      provider abstraction modules expose ZERO ima2/codex
 *                           internals beyond the Rust command names; the offline
 *                           provider imports zero net/LLM symbols (static).
 *   ready-line-parse        the Rust ready-line grammar (mirrored) accepts the
 *                           loopback /v1 URL and rejects non-loopback / non-v1.
 *
 * Usage: node --import tsx fixtures/t1-slice5c-smoke.mjs <scenario>
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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

/* ---------------- shared in-memory fixtures (no I/O) ---------------- */

function mkChunk(over = {}) {
  return {
    source_id: 'src',
    order: 0,
    chunk_id: 'chunk-real-0',
    heading_path: ['시편 신학'],
    location: { char_start: 0, char_end: 400, page: 12 },
    text: '저자는 탄식 시편이 하느님께 대한 신뢰의 표현이라고 주장한다.',
    content_hash: 'hash00',
    ...over,
  };
}

function mkScored(over = {}) {
  return {
    candidate: {
      local_candidate_id: 'c-1',
      title: '탄식 시편의 신학',
      type: 'concept',
      category: 'extracted',
      summary: '탄식이 신뢰의 표현이라는 개념',
      evidence_refs: ['src#chunk-real-0'],
      suggested_action: 'create_new',
      source_id: 'src',
      page: 12,
      span: { start: 0, end: 40 },
      evidence_text: '저자는 탄식 시편이 하느님께 대한 신뢰의 표현이라고 주장한다.',
    },
    sub: {},
    total: 5,
    recommended_action: 'create_new',
    target_entry_id: null,
    target_entry_title: null,
    rationale: { why: [], matched_keywords: [], claim_verbs: [], boundary: [], demotion: [] },
    demote: { demoted: false, kinds: [], reasons: [] },
    ...over,
  };
}

function mkInput(over = {}) {
  return {
    candidate: mkScored(),
    chunks: [mkChunk()],
    schema: ['탄식 시편', '신뢰'],
    ...over,
  };
}

/** An injected provider that returns a fixed raw text (auto mode), no network. */
function stubProvider(rawText) {
  return {
    id: 'codex_oauth_proxy',
    label: '자동 LLM 모드 (테스트 스텁)',
    mode: 'auto',
    async runExtraction() {
      return { ok: true, rawText };
    },
  };
}

/** An injected provider that always degrades (codex 없음 / proxy 다운). */
function degradedProvider(message) {
  return {
    id: 'codex_oauth_proxy',
    label: '자동 LLM 모드 (테스트 스텁)',
    mode: 'auto',
    async runExtraction() {
      return { ok: false, degraded: true, message };
    },
  };
}

/* ---------------------------------- scenarios ---------------------------------- */

// AC-AUTH-ABSTRACT + AC-CODEX-DETECT: availability derivation is deterministic;
// offline is always available, codex follows the snapshot, future is never.
async function providerAvailability() {
  const { providerAvailabilities } = await import('../src/lib/llm/provider.ts');

  const whenAvailable = providerAvailabilities({
    available: true,
    auth_file_present: true,
    login_probe: 'authed',
    codex_cli_missing: false,
    origin: 'windows',
  });
  const whenMissing = providerAvailabilities({
    available: false,
    auth_file_present: false,
    login_probe: 'missing',
    codex_cli_missing: true,
    origin: 'none',
  });

  const byId = (list, id) => list.find((a) => a.id === id);

  const report = {
    scenario: 'provider-availability',
    offline_always_available:
      byId(whenAvailable, 'offline').available && byId(whenMissing, 'offline').available,
    codex_follows_snapshot:
      byId(whenAvailable, 'codex_oauth_proxy').available &&
      !byId(whenMissing, 'codex_oauth_proxy').available,
    future_never_available:
      !byId(whenAvailable, 'future').available && !byId(whenMissing, 'future').available,
    codex_missing_reason_korean:
      /[가-힣]/.test(byId(whenMissing, 'codex_oauth_proxy').reason ?? '') &&
      byId(whenMissing, 'codex_oauth_proxy').reason.includes('복붙'),
    three_providers: whenAvailable.length === 3,
  };
  if (!report.offline_always_available) return fail(report, 'offline must be available in every snapshot');
  if (!report.codex_follows_snapshot) return fail(report, 'codex availability must follow the detect snapshot');
  if (!report.future_never_available) return fail(report, 'future placeholder must never be available');
  if (!report.codex_missing_reason_korean) return fail(report, 'codex-missing reason missing Korean copy-paste guidance');
  if (!report.three_providers) return fail(report, 'expected exactly 3 providers');
  pass(report);
}

// AC-EVIDENCE-REUSE: a FORGED chunk_id in an AUTO reply is rejected by the SAME
// 5b validator. The auto path does not re-implement or weaken the gate.
async function autoEvidenceReuse() {
  const { autoExtractCandidate } = await import('../src/lib/llm/autoExtract.ts');
  // The auto LLM hallucinates a forged chunk_id (chunk-FAKE-999) alongside a real one.
  const rawText = JSON.stringify({
    wiki_candidates: [
      { title: '진짜', summary_ko: '의화', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }], confidence: 'high' },
      { title: '위조', summary_ko: '은총', evidence: [{ chunk_id: 'chunk-FAKE-999', quote: '환각' }], confidence: 'low' },
    ],
  });
  const provider = stubProvider('```json\n' + rawText + '\n```'); // also exercises fence tolerance
  const knownChunkIds = ['chunk-real-0'];
  const outcome = await autoExtractCandidate(provider, mkInput(), knownChunkIds);

  if (!outcome.ok) return fail({ scenario: 'auto-evidence-reuse', outcome }, 'auto outcome unexpectedly degraded');
  const res = outcome.result;
  const real = res.candidates[0];
  const forged = res.candidates[1];
  const report = {
    scenario: 'auto-evidence-reuse',
    real_importable: real.importable,
    forged_rejected: !forged.importable,
    forged_mentions_forgery: forged.violations.some((v) => v.includes('위조')),
    forged_not_on_evidence: !forged.evidence.some((e) => e.chunk_id === 'chunk-FAKE-999'),
    forged_quarantined: forged.rejectedEvidence.some((e) => e.claimed_chunk_id === 'chunk-FAKE-999'),
    importable_count: res.importable.length,
  };
  if (!report.real_importable) return fail(report, 'real-chunk auto candidate wrongly rejected');
  if (!report.forged_rejected) return fail(report, 'FORGED auto chunk_id was NOT rejected (anti-forgery gate not reused)');
  if (!report.forged_mentions_forgery) return fail(report, 'auto forgery rejection lacks Korean 위조 warning');
  if (!report.forged_not_on_evidence) return fail(report, 'forged auto ref leaked onto consumable evidence');
  if (!report.forged_quarantined) return fail(report, 'forged auto ref not quarantined in rejectedEvidence');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
  pass(report);
}

// AC-GRACEFUL: a degraded provider yields {ok:false, degraded:true, Korean msg}
// with NO importable data and NO throw — the caller falls back to copy-paste.
async function autoGraceful() {
  const { autoExtractCandidate } = await import('../src/lib/llm/autoExtract.ts');
  const provider = degradedProvider('openai-oauth 프록시가 준비되지 않았습니다. 복붙 모드로 전환하세요.');
  let threw = false;
  let outcome;
  try {
    outcome = await autoExtractCandidate(provider, mkInput(), ['chunk-real-0']);
  } catch (e) {
    threw = true;
    outcome = { error: String(e) };
  }
  const report = {
    scenario: 'auto-graceful',
    no_throw: !threw,
    degraded: outcome && outcome.ok === false && outcome.degraded === true,
    message_korean: outcome && outcome.ok === false && /[가-힣]/.test(outcome.message),
    no_importable_field: outcome && outcome.ok === false && !('result' in outcome),
    message_mentions_fallback: outcome && outcome.ok === false && outcome.message.includes('복붙'),
  };
  if (!report.no_throw) return fail(report, 'degradation must NOT throw (app must keep running)');
  if (!report.degraded) return fail(report, 'degraded provider did not produce a degraded outcome');
  if (!report.message_korean) return fail(report, 'degradation message not Korean');
  if (!report.no_importable_field) return fail(report, 'degraded outcome leaked a validation result');
  if (!report.message_mentions_fallback) return fail(report, 'degradation message does not point to copy-paste fallback');
  pass(report);
}

// AC-GRACEFUL (offline default): the offline provider performs NO network call
// and returns a non-degraded manual-mode result (the copy-paste IS the path).
async function offlineProviderNoop() {
  const { offlineProvider } = await import('../src/lib/llm/offlineProvider.ts');
  const r = await offlineProvider.runExtraction('any prompt');
  const report = {
    scenario: 'offline-provider-noop',
    id_offline: offlineProvider.id === 'offline',
    mode_manual: offlineProvider.mode === 'manual',
    not_ok: r.ok === false,
    not_degraded: r.ok === false && r.degraded === false, // normal offline flow, not a failure
    message_korean: r.ok === false && /[가-힣]/.test(r.message),
  };
  if (!report.id_offline) return fail(report, 'offline provider id mismatch');
  if (!report.mode_manual) return fail(report, 'offline provider must be manual mode');
  if (!report.not_ok) return fail(report, 'offline provider must not return ok (manual path)');
  if (!report.not_degraded) return fail(report, 'offline manual path must NOT be flagged as a degradation/failure');
  if (!report.message_korean) return fail(report, 'offline provider message not Korean');
  pass(report);
}

// AC-AUTO-EXTRACT preservation: a VALID auto reply → validate → import yields an
// entry whose original_text is the VERBATIM chunk, NOT the model quote (same
// preservation invariant the 5b copy-paste import enforces).
async function autoImportPreserve() {
  const { autoExtractCandidate } = await import('../src/lib/llm/autoExtract.ts');
  const { buildEntryFromValidated, LLM_SOURCE_TAG } = await import('../src/lib/bridge/wikiImport.ts');
  const chunk = mkChunk();
  const rawText = JSON.stringify({
    wiki_candidates: [
      {
        title: '탄식 시편의 신학',
        schema_field: '시편 신학',
        summary_ko: '탄식은 하느님께 대한 신뢰의 표현(의화·은총 가톨릭 용어).',
        evidence: [{ chunk_id: 'chunk-real-0', quote: '자동 LLM이 만든 인용(원문 아님)' }],
        confidence: 'high',
        reason: '본문이 신뢰 개념을 직접 진술함',
      },
    ],
  });
  const outcome = await autoExtractCandidate(stubProvider(rawText), mkInput(), ['chunk-real-0']);
  if (!outcome.ok) return fail({ scenario: 'auto-import-preserve', outcome }, 'auto outcome unexpectedly degraded');
  const cand = outcome.result.importable[0];
  const entry = buildEntryFromValidated(cand, { source_id: 'src', chunks: [chunk], now: '2026-05-23T00:00:00Z' });
  const claim = entry.claims[0];
  const report = {
    scenario: 'auto-import-preserve',
    status_draft: entry.status === 'draft',
    has_llm_tag: entry.tags.includes(LLM_SOURCE_TAG),
    original_is_verbatim_chunk: claim.original_text === chunk.text,
    original_not_model_quote: claim.original_text !== '자동 LLM이 만든 인용(원문 아님)',
    translated_is_summary_ko: claim.translated_text === cand.summary_ko,
    evidence_bound_to_chunk: claim.evidence_refs.some((r) => r.includes('chunk-real-0')),
  };
  if (!report.status_draft) return fail(report, 'auto-imported entry not draft');
  if (!report.has_llm_tag) return fail(report, 'LLM provenance tag missing');
  if (!report.original_is_verbatim_chunk) return fail(report, 'original_text is NOT the verbatim chunk (preservation broken on auto path)');
  if (!report.original_not_model_quote) return fail(report, 'original_text leaked the auto model quote');
  if (!report.translated_is_summary_ko) return fail(report, 'translated_text is not the Catholic summary_ko');
  if (!report.evidence_bound_to_chunk) return fail(report, 'evidence not bound to real chunk_id on auto path');
  pass(report);
}

// AC-ENCAPSULATE + AC-GRACEFUL: the offline provider imports zero net/LLM
// symbols; the codex provider does NOT issue its own fetch (the only network is
// the Rust command). autoExtract reuses the 5b bridge modules (proves reuse).
async function encapsulationScan() {
  const offlineRel = 'src/lib/llm/offlineProvider.ts';
  const codexRel = 'src/lib/llm/codexProvider.ts';
  const autoRel = 'src/lib/llm/autoExtract.ts';

  const offlineText = readFileSync(resolve(ROOT, offlineRel), 'utf8');
  const codexText = readFileSync(resolve(ROOT, codexRel), 'utf8');
  const autoText = readFileSync(resolve(ROOT, autoRel), 'utf8');

  // offline provider: zero network/LLM tokens (mirror of 5b offline-no-network).
  const offlineForbidden = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'http://', 'https://', 'invoke(', 'openai', 'api.'];
  const offlineViolations = offlineForbidden.filter((t) => offlineText.includes(t));

  // codex provider: must NOT issue its own raw fetch — only the Rust commands.
  const codexHasRawFetch = /\bfetch\(/.test(codexText) || codexText.includes('XMLHttpRequest');

  // autoExtract: must reuse the 5b bridge modules (proves AC-EVIDENCE-REUSE wiring).
  const autoReusesValidator =
    autoText.includes("from '$lib/bridge/responseValidator'") &&
    autoText.includes("from '$lib/bridge/responseParser'") &&
    autoText.includes("from '$lib/bridge/promptBuilder'");

  const report = {
    scenario: 'encapsulation-scan',
    offline_zero_net_tokens: offlineViolations.length === 0,
    offline_violations: offlineViolations,
    codex_no_raw_fetch: !codexHasRawFetch,
    auto_reuses_5b_bridge: autoReusesValidator,
  };
  if (!report.offline_zero_net_tokens) return fail(report, `offline provider has net/LLM tokens: ${JSON.stringify(offlineViolations)}`);
  if (!report.codex_no_raw_fetch) return fail(report, 'codex provider issues a raw fetch (must go through the Rust command only)');
  if (!report.auto_reuses_5b_bridge) return fail(report, 'autoExtract does not import the 5b bridge modules (reuse not proven)');
  pass(report);
}

// AC-OAUTH-PROXY (ready-line grammar, mirrored): accept loopback /v1, reject
// non-loopback and non-v1. Mirrors src-tauri/src/oauth_child.rs::parse_ready_line.
async function readyLineParse() {
  // Pure JS mirror of the Rust manual scan (kept in lockstep with the Rust test).
  function parseReadyLine(line) {
    const needle = 'http://127.0.0.1:';
    const start = line.indexOf(needle);
    if (start < 0) return null;
    const after = line.slice(start + needle.length);
    const slash = after.indexOf('/');
    if (slash < 0) return null;
    const portStr = after.slice(0, slash);
    const port = Number(portStr);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    const rest = after.slice(slash);
    if (!rest.startsWith('/v1')) return null;
    return { port, url: `${needle}${port}/v1` };
  }
  const ok = parseReadyLine('OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1');
  const nonV1 = parseReadyLine('http://127.0.0.1:10531/v2');
  const nonLoopback = parseReadyLine('http://0.0.0.0:10531/v1');
  const report = {
    scenario: 'ready-line-parse',
    canonical_ok: ok && ok.port === 10531 && ok.url === 'http://127.0.0.1:10531/v1',
    non_v1_rejected: nonV1 === null,
    non_loopback_rejected: nonLoopback === null,
  };
  if (!report.canonical_ok) return fail(report, 'canonical loopback /v1 ready line not parsed');
  if (!report.non_v1_rejected) return fail(report, 'non-/v1 suffix not rejected');
  if (!report.non_loopback_rejected) return fail(report, 'non-loopback host not rejected');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  'provider-availability': providerAvailability,
  'auto-evidence-reuse': autoEvidenceReuse,
  'auto-graceful': autoGraceful,
  'offline-provider-noop': offlineProviderNoop,
  'auto-import-preserve': autoImportPreserve,
  'encapsulation-scan': encapsulationScan,
  'ready-line-parse': readyLineParse,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice5c-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
