#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 5b ACs — the ChatGPT copy-paste bridge.
 * Deterministic, OFFLINE, no LLM, no network (the app never calls ChatGPT;
 * 'ChatGPT 열기' is OS browser delegation only).
 *
 * Authority: agreed_contract.json#AC-PROMPT-BUILD + AC-PASTE-PARSE +
 *            AC-VALIDATE + AC-EVIDENCE-BIND + AC-IMPORT + AC-APPROVE +
 *            AC-KOREAN-UI + AC-OFFLINE-CORE.
 *
 * Scenarios (run individually; exit 0 = pass):
 *   prompt-build        candidate+chunks+schema → text with role/SCHEMA/
 *                       CANDIDATE_CHUNKS/OUTPUT_FORMAT + Catholic instruction;
 *                       deterministic (same in → byte-identical out).
 *   paste-parse         ```json fenced + prose-wrapped replies parse; junk fails
 *                       with a Korean message (never throws).
 *   validate-shape      missing wiki_candidates / missing title → Korean reject.
 *   evidence-bind       forged chunk_id → candidate REJECTED (not importable);
 *                       real chunk_id → importable. (anti-forgery gate)
 *   confidence-enum     bad confidence → reject; high/medium/low → ok.
 *   import-build        validated → WikiEntry: original_text = VERBATIM chunk
 *                       text (preserved), translated_text = summary_ko
 *                       (Catholic), evidence bound to real chunk_id, LLM tag.
 *   offline-no-network  bridge modules import zero net/LLM symbols (static).
 *
 *   --- slice5b-repair (defense-in-depth hardening) ---
 *   source-scope        a real chunk_id from a DIFFERENT source is treated as
 *                       unknown when knownChunkIds is scoped to the candidate's
 *                       own source → candidate rejected (provenance integrity).
 *   rejected-evidence   a forged chunk_id is QUARANTINED into rejectedEvidence;
 *                       the consumable `evidence` array never carries the forged
 *                       ref or its model quote.
 *   fallback-refusal    importing a validated candidate whose chunk_id cannot be
 *                       resolved to verbatim text REFUSES (hard throw); the
 *                       model quote is NEVER written into original_text.
 *
 * Usage: node --import tsx fixtures/t1-slice5b-smoke.mjs <scenario>
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

/* ---------------------------------- scenarios ---------------------------------- */

async function promptBuild() {
  const { buildPrompt, promptChunkIds } = await import('../src/lib/bridge/promptBuilder.ts');
  const input = {
    candidate: mkScored(),
    chunks: [mkChunk()],
    schema: ['탄식 시편', '신뢰'],
  };
  const p1 = buildPrompt(input);
  const p2 = buildPrompt(input);
  const report = {
    scenario: 'prompt-build',
    deterministic: p1 === p2,
    has_role: p1.includes('개인 학술 위키 후보 정리 도우미'),
    has_no_guess: p1.includes('추측하지 말고'),
    has_catholic: p1.includes('가톨릭 용어 우선'),
    has_schema: p1.includes('[SCHEMA]') && p1.includes('탄식 시편'),
    has_chunks: p1.includes('[CANDIDATE_CHUNKS]') && p1.includes('chunk_id: chunk-real-0'),
    has_chunk_text_verbatim: p1.includes('하느님께 대한 신뢰의 표현이라고 주장한다'),
    has_output_format: p1.includes('[OUTPUT_FORMAT]') && p1.includes('wiki_candidates'),
    prompt_chunk_ids: promptChunkIds(input),
  };
  if (!report.deterministic) return fail(report, 'prompt not deterministic');
  if (!report.has_role) return fail(report, 'role instruction missing');
  if (!report.has_no_guess) return fail(report, 'no-guess instruction missing');
  if (!report.has_catholic) return fail(report, 'Catholic-terminology instruction missing');
  if (!report.has_schema) return fail(report, 'SCHEMA block / user terms missing');
  if (!report.has_chunks) return fail(report, 'CANDIDATE_CHUNKS / chunk_id missing');
  if (!report.has_chunk_text_verbatim) return fail(report, 'verbatim chunk text not preserved in prompt');
  if (!report.has_output_format) return fail(report, 'OUTPUT_FORMAT / wiki_candidates missing');
  pass(report);
}

async function pasteParse() {
  const { parseResponse } = await import('../src/lib/bridge/responseParser.ts');
  const fenced = '여기 결과입니다:\n```json\n{ "wiki_candidates": [] }\n```\n감사합니다.';
  const prose = 'Sure! { "wiki_candidates": [ {"title":"x"} ] } — done';
  const junk = '이건 JSON이 아닙니다';
  const r1 = parseResponse(fenced);
  const r2 = parseResponse(prose);
  const r3 = parseResponse(junk);
  const r4 = parseResponse('');
  const report = {
    scenario: 'paste-parse',
    fenced_ok: r1.ok && Array.isArray(r1.value.wiki_candidates),
    prose_ok: r2.ok && r2.value.wiki_candidates[0].title === 'x',
    junk_rejected: !r3.ok && typeof r3.message === 'string',
    empty_rejected: !r4.ok && typeof r4.message === 'string',
    junk_message_korean: !r3.ok && /[가-힣]/.test(r3.message),
  };
  if (!report.fenced_ok) return fail(report, 'code-fence JSON not parsed');
  if (!report.prose_ok) return fail(report, 'prose-wrapped JSON not parsed');
  if (!report.junk_rejected) return fail(report, 'junk not rejected');
  if (!report.empty_rejected) return fail(report, 'empty not rejected');
  if (!report.junk_message_korean) return fail(report, 'reject message not Korean');
  pass(report);
}

async function validateShape() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const known = ['chunk-real-0'];
  const noArr = validateResponse({ foo: 1 }, known);
  const notObj = validateResponse([1, 2, 3], known);
  const noTitle = validateResponse(
    { wiki_candidates: [{ title: '', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }] }] },
    known,
  );
  const report = {
    scenario: 'validate-shape',
    no_array_rejected: !noArr.shapeOk && /[가-힣]/.test(noArr.topLevelError),
    not_object_rejected: !notObj.shapeOk,
    no_title_rejected: noTitle.shapeOk && !noTitle.candidates[0].importable &&
      noTitle.candidates[0].violations.some((v) => v.includes('title')),
  };
  if (!report.no_array_rejected) return fail(report, 'missing wiki_candidates not rejected');
  if (!report.not_object_rejected) return fail(report, 'non-object not rejected');
  if (!report.no_title_rejected) return fail(report, 'empty title not flagged');
  pass(report);
}

async function evidenceBind() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const known = ['chunk-real-0', 'chunk-real-1'];
  const res = validateResponse(
    {
      wiki_candidates: [
        { title: '진짜 근거', summary_ko: '의화', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }], confidence: 'high' },
        { title: '위조 근거', summary_ko: '은총', evidence: [{ chunk_id: 'chunk-FAKE-999', quote: 'fabricated' }], confidence: 'low' },
      ],
    },
    known,
  );
  const real = res.candidates[0];
  const forged = res.candidates[1];
  const report = {
    scenario: 'evidence-bind',
    real_importable: real.importable,
    forged_rejected: !forged.importable,
    forged_violation: forged.violations.find((v) => v.includes('chunk-FAKE-999')) ?? null,
    forged_mentions_forgery: forged.violations.some((v) => v.includes('위조')),
    importable_count: res.importable.length,
    // repair fix 2: forged ref is quarantined off the consumable evidence list.
    real_evidence_bound: real.evidence.some((e) => e.chunk_id === 'chunk-real-0'),
    forged_not_on_evidence: !forged.evidence.some((e) => e.chunk_id === 'chunk-FAKE-999'),
    forged_on_rejected: forged.rejectedEvidence.some((e) => e.claimed_chunk_id === 'chunk-FAKE-999'),
  };
  if (!report.real_importable) return fail(report, 'real chunk_id candidate wrongly rejected');
  if (!report.forged_rejected) return fail(report, 'FORGED chunk_id candidate was NOT rejected (anti-forgery gate broken)');
  if (!report.forged_mentions_forgery) return fail(report, 'forgery rejection lacks Korean 위조 warning');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
  if (!report.real_evidence_bound) return fail(report, 'real evidence not present on consumable evidence list');
  if (!report.forged_not_on_evidence) return fail(report, 'FORGED ref leaked onto consumable evidence array (quarantine broken)');
  if (!report.forged_on_rejected) return fail(report, 'forged ref not recorded in rejectedEvidence');
  pass(report);
}

async function confidenceEnum() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const known = ['chunk-real-0'];
  const res = validateResponse(
    {
      wiki_candidates: [
        { title: 'ok', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }], confidence: 'medium' },
        { title: 'bad-conf', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }], confidence: 'super-high' },
        { title: 'no-conf', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }] },
      ],
    },
    known,
  );
  const report = {
    scenario: 'confidence-enum',
    valid_conf_importable: res.candidates[0].importable && res.candidates[0].confidence === 'medium',
    bad_conf_rejected: !res.candidates[1].importable &&
      res.candidates[1].violations.some((v) => v.includes('confidence')),
    no_conf_importable: res.candidates[2].importable && res.candidates[2].confidence === null,
  };
  if (!report.valid_conf_importable) return fail(report, 'valid confidence not accepted');
  if (!report.bad_conf_rejected) return fail(report, 'invalid confidence not rejected');
  if (!report.no_conf_importable) return fail(report, 'absent confidence (optional) wrongly rejected');
  pass(report);
}

async function importBuild() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const { buildEntryFromValidated, LLM_SOURCE_TAG } = await import('../src/lib/bridge/wikiImport.ts');
  const chunk = mkChunk();
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '탄식 시편의 신학',
          schema_field: '시편 신학',
          summary_ko: '탄식은 하느님께 대한 신뢰의 표현이다(의화·은총 가톨릭 용어).',
          evidence: [{ chunk_id: 'chunk-real-0', quote: 'ChatGPT가 만든 인용(원문 아님)' }],
          confidence: 'high',
          reason: '본문이 신뢰 개념을 직접 진술함',
        },
      ],
    },
    ['chunk-real-0'],
  );
  const cand = res.importable[0];
  const entry = buildEntryFromValidated(cand, {
    source_id: 'src',
    chunks: [chunk],
    now: '2026-05-23T00:00:00Z',
  });
  const claim = entry.claims[0];
  const report = {
    scenario: 'import-build',
    status_draft: entry.status === 'draft',
    has_llm_tag: entry.tags.includes(LLM_SOURCE_TAG),
    // PRESERVATION: original_text must equal the VERBATIM chunk text, NOT the
    // ChatGPT-authored quote.
    original_is_verbatim_chunk: claim.original_text === chunk.text,
    original_not_chatgpt_quote: claim.original_text !== 'ChatGPT가 만든 인용(원문 아님)',
    // Catholic translation lives in the separate translated_text field.
    translated_is_summary_ko: claim.translated_text === cand.summary_ko,
    evidence_bound_to_chunk: claim.evidence_refs.some((r) => r.includes('chunk-real-0')),
    deterministic_now: entry.created_at === '2026-05-23T00:00:00Z',
  };
  if (!report.status_draft) return fail(report, 'imported entry not draft');
  if (!report.has_llm_tag) return fail(report, 'LLM provenance tag missing (출처 표시)');
  if (!report.original_is_verbatim_chunk) return fail(report, 'original_text is NOT the verbatim chunk (preservation broken)');
  if (!report.original_not_chatgpt_quote) return fail(report, 'original_text leaked the ChatGPT quote');
  if (!report.translated_is_summary_ko) return fail(report, 'translated_text is not the Catholic summary_ko');
  if (!report.evidence_bound_to_chunk) return fail(report, 'evidence not bound to real chunk_id');
  pass(report);
}

async function offlineNoNetwork() {
  // Static guard: the bridge modules must not import network/LLM symbols. The
  // app NEVER calls ChatGPT in 5b (copy-paste only). 'ChatGPT 열기' is
  // window.open (OS delegation) and lives in the .svelte component, not these
  // pure modules.
  const files = [
    'src/lib/bridge/promptBuilder.ts',
    'src/lib/bridge/responseParser.ts',
    'src/lib/bridge/responseValidator.ts',
    'src/lib/bridge/wikiImport.ts',
  ];
  const forbidden = ['fetch(', 'XMLHttpRequest', 'llmClient', 'llm_cmd', 'llm_extract', 'WebSocket', 'http://', 'https://', 'invoke(', 'openai', 'api.'];
  const violations = [];
  for (const rel of files) {
    const text = readFileSync(resolve(ROOT, rel), 'utf8');
    for (const f of forbidden) {
      if (text.includes(f)) violations.push({ file: rel, token: f });
    }
  }
  const report = { scenario: 'offline-no-network', files_scanned: files.length, violations };
  if (violations.length > 0) return fail(report, `network/LLM token found in bridge module: ${JSON.stringify(violations)}`);
  pass(report);
}

/* ----------------- slice5b-repair: defense-in-depth scenarios ----------------- */

// Fix 1 — source scoping. When the known-chunk set is scoped to the candidate's
// OWN source, a REAL chunk_id from a DIFFERENT source must be treated as unknown
// (rejected), so evidence can only bind within the candidate's source.
async function sourceScope() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  // knownChunkIds is scoped to source A only (the candidate's source).
  const knownForSourceA = ['A-chunk-0', 'A-chunk-1'];
  const res = validateResponse(
    {
      wiki_candidates: [
        // binds within its own source A → importable
        { title: '같은 출처', summary_ko: '의화', evidence: [{ chunk_id: 'A-chunk-0', quote: 'q' }], confidence: 'high' },
        // a REAL chunk_id but from a DIFFERENT loaded source B → must be unknown here
        { title: '다른 출처', summary_ko: '은총', evidence: [{ chunk_id: 'B-chunk-0', quote: 'q' }], confidence: 'low' },
      ],
    },
    knownForSourceA,
  );
  const sameSrc = res.candidates[0];
  const crossSrc = res.candidates[1];
  const report = {
    scenario: 'source-scope',
    same_source_importable: sameSrc.importable,
    cross_source_rejected: !crossSrc.importable,
    cross_source_on_rejected: crossSrc.rejectedEvidence.some((e) => e.claimed_chunk_id === 'B-chunk-0'),
    cross_source_not_on_evidence: !crossSrc.evidence.some((e) => e.chunk_id === 'B-chunk-0'),
    importable_count: res.importable.length,
  };
  if (!report.same_source_importable) return fail(report, 'same-source candidate wrongly rejected');
  if (!report.cross_source_rejected) return fail(report, 'cross-source chunk_id was NOT rejected (source scoping broken)');
  if (!report.cross_source_on_rejected) return fail(report, 'cross-source ref not quarantined into rejectedEvidence');
  if (!report.cross_source_not_on_evidence) return fail(report, 'cross-source ref leaked onto consumable evidence');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
  pass(report);
}

// Fix 2 — rejected-evidence separation. A candidate mixing one real and one
// forged ref keeps ONLY the real ref on `evidence`; the forged ref (and its
// model quote) lives solely in rejectedEvidence and never on evidence.
async function rejectedEvidence() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '혼합 근거',
          summary_ko: '의화·은총',
          evidence: [
            { chunk_id: 'chunk-real-0', quote: '실제 인용' },
            { chunk_id: 'chunk-FAKE-1', quote: '환각 인용(원문 행세)' },
            { chunk_id: '', quote: '빈 id 인용' },
          ],
          confidence: 'high',
        },
      ],
    },
    ['chunk-real-0'],
  );
  const c = res.candidates[0];
  const evIds = c.evidence.map((e) => e.chunk_id);
  const evQuotes = c.evidence.map((e) => e.quote);
  const rejIds = c.rejectedEvidence.map((e) => e.claimed_chunk_id);
  const report = {
    scenario: 'rejected-evidence',
    candidate_rejected: !c.importable,
    evidence_only_real: evIds.length === 1 && evIds[0] === 'chunk-real-0',
    forged_quote_not_on_evidence: !evQuotes.includes('환각 인용(원문 행세)'),
    forged_in_rejected: rejIds.includes('chunk-FAKE-1'),
    empty_in_rejected: rejIds.includes(''),
    rejected_carry_reason: c.rejectedEvidence.every((e) => typeof e.reason === 'string' && /[가-힣]/.test(e.reason)),
  };
  if (!report.candidate_rejected) return fail(report, 'mixed-evidence candidate wrongly importable');
  if (!report.evidence_only_real) return fail(report, 'consumable evidence is not exactly the one real ref');
  if (!report.forged_quote_not_on_evidence) return fail(report, 'forged model quote leaked onto consumable evidence');
  if (!report.forged_in_rejected) return fail(report, 'forged ref not quarantined in rejectedEvidence');
  if (!report.empty_in_rejected) return fail(report, 'empty chunk_id ref not quarantined in rejectedEvidence');
  if (!report.rejected_carry_reason) return fail(report, 'rejectedEvidence entries missing Korean reason');
  pass(report);
}

// Fix 3 — fallback refusal. A VALIDATED candidate whose chunk_id is absent from
// the import chunk pool (e.g. source-scoped pool excludes it) must REFUSE the
// import (hard throw); the model quote must NEVER become original_text.
async function fallbackRefusal() {
  const { buildEntryFromValidated } = await import('../src/lib/bridge/wikiImport.ts');
  // Hand-built validated candidate (importable=true) whose chunk_id is NOT in
  // the chunk pool passed to import. Pre-repair this silently substituted the
  // model quote into original_text; post-repair it must throw.
  const cand = {
    index: 0,
    title: '복원 불가',
    schema_field: '시편 신학',
    summary_ko: '가톨릭 요약',
    evidence: [{ chunk_id: 'unresolvable-chunk', quote: 'ChatGPT 인용(원문 행세 시도)' }],
    rejectedEvidence: [],
    confidence: 'high',
    reason: '검증은 통과했으나 청크 풀에 없음',
    importable: true,
    violations: [],
  };
  let threw = false;
  let message = '';
  let leakedQuote = false;
  try {
    const entry = buildEntryFromValidated(cand, {
      source_id: 'src',
      chunks: [mkChunk()], // chunk-real-0 only; does NOT contain unresolvable-chunk
      now: '2026-05-23T00:00:00Z',
    });
    // If we get here the fallback was NOT removed — check whether the model
    // quote leaked into original_text (the preservation break we guard against).
    leakedQuote = entry.claims.some((c) => c.original_text === 'ChatGPT 인용(원문 행세 시도)');
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  const report = {
    scenario: 'fallback-refusal',
    refused_hard_throw: threw,
    message_korean: threw && /[가-힣]/.test(message),
    message_mentions_restore_fail: threw && message.includes('원문 복원 실패'),
    no_quote_leak_into_original: !leakedQuote,
  };
  if (!report.refused_hard_throw) return fail(report, 'unresolvable chunk_id did NOT refuse import (silent fallback still present)');
  if (!report.message_korean) return fail(report, 'refusal message not Korean');
  if (!report.message_mentions_restore_fail) return fail(report, 'refusal message lacks 원문 복원 실패 wording');
  if (!report.no_quote_leak_into_original) return fail(report, 'model quote leaked into original_text (preservation break)');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  'prompt-build': promptBuild,
  'paste-parse': pasteParse,
  'validate-shape': validateShape,
  'evidence-bind': evidenceBind,
  'confidence-enum': confidenceEnum,
  'import-build': importBuild,
  'offline-no-network': offlineNoNetwork,
  'source-scope': sourceScope,
  'rejected-evidence': rejectedEvidence,
  'fallback-refusal': fallbackRefusal,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice5b-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
