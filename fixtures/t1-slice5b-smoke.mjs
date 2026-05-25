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
 *   structural-reject   TOC/section headings and standalone author names are
 *                       rejected even with real chunk_id evidence.
 *   offline-no-network  bridge modules import zero net/LLM symbols (static).
 *
 *   --- slice5b-repair (defense-in-depth hardening) ---
 *   source-scope        a real chunk_id from a DIFFERENT source is treated as
 *                       unknown when knownChunkIds is scoped to the candidate's
 *                       own source → candidate rejected (provenance integrity).
 *   rejected-evidence   a forged chunk_id is QUARANTINED into rejectedEvidence;
 *                       the consumable `evidence` array never carries the forged
 *                       ref or its model quote.
 *   quote-length-cap    validator enforces the same 600-char quote cap as prompt.
 *   fallback-refusal    importing a validated candidate whose chunk_id cannot be
 *                       resolved to verbatim text REFUSES (hard throw); the
 *                       model quote is NEVER written into original_text.
 *   bridge-manual-bind  the manual copy-paste bridge validates against full
 *                       chunk objects, not a string-only chunk_id seam.
 *   catholic-terms      model-authored Korean fields using Protestant terms
 *                       are rejected before import.
 *   domain-neutral-guidance
 *                       prompt + validator preserve cross-discipline judgment
 *                       fields for useful diagnostic feedback.
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
    // Slice-9 strengthened the role block (academic 7-type extraction + 목차
    // classification). The role wording evolved from "후보 정리 도우미" to
    // "원문 추출·분류 도우미"; this assertion tracks the new, superseding text.
    has_role: p1.includes('원문 추출·분류 도우미'),
    has_no_guess: p1.includes('추측하지 말고'),
    has_catholic: p1.includes('가톨릭 용어 우선'),
    has_schema: p1.includes('[SCHEMA]') && p1.includes('탄식 시편'),
    has_chunks: p1.includes('[CANDIDATE_CHUNKS]') && p1.includes('chunk_id: chunk-real-0'),
    has_chunk_text_verbatim: p1.includes('하느님께 대한 신뢰의 표현이라고 주장한다'),
    has_output_format: p1.includes('[OUTPUT_FORMAT]') && p1.includes('wiki_candidates'),
    // Slice-9 (AC-AUTO-EXTRACT-CONFIRM): the prompt now enumerates the academic
    // 7 candidate types and asks for 목차(table-of-contents) classification.
    has_seven_types:
      p1.includes('concept') && p1.includes('argument') && p1.includes('religious_text') &&
      p1.includes('objection') && p1.includes('quotation'),
    has_outline_classification: p1.includes('schema_field') && (p1.includes('목차') || p1.includes('분류')),
    has_domain_profile: p1.includes('discipline_profile') && p1.includes('전공/자료 성격'),
    has_discipline_unit: p1.includes('discipline_unit') && p1.includes('판례 원칙'),
    has_mapping_reason: p1.includes('mapping_reason'),
    has_reuse_boundary: p1.includes('reuse_reason') && p1.includes('boundary_note'),
    has_standard_terms: p1.includes('standard_terms') && p1.includes('해당 전공의 표준 한국어 용어'),
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
  if (!report.has_seven_types) return fail(report, 'academic 7-type extraction instruction missing (Slice-9)');
  if (!report.has_outline_classification) return fail(report, '목차 classification instruction missing (Slice-9)');
  if (!report.has_domain_profile) return fail(report, 'domain/discipline profile guidance missing');
  if (!report.has_discipline_unit) return fail(report, 'discipline-specific unit guidance missing');
  if (!report.has_mapping_reason) return fail(report, 'mapping reason output missing');
  if (!report.has_reuse_boundary) return fail(report, 'reuse/boundary reasoning outputs missing');
  if (!report.has_standard_terms) return fail(report, 'standard terms guidance missing');
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

async function partialJsonRecovery() {
  const { parseResponse } = await import('../src/lib/bridge/responseParser.ts');
  const raw = [
    '{ "wiki_candidates": [',
    '{"title":"완성 후보 1","schema_field":"시편","summary_ko":"요약","evidence":[{"chunk_id":"chunk-real-0","quote":"q"}],"confidence":"high"},',
    '{"title":"완성 후보 2","schema_field":"시편","summary_ko":"요약","evidence":[{"chunk_id":"chunk-real-1","quote":"q"}],"confidence":"medium"},',
    '{"title":"잘린 후보","schema_field":"시편","summary_ko":"요',
  ].join('');
  const res = parseResponse(raw);
  const report = {
    scenario: 'partial-json-recovery',
    ok: res.ok,
    marked_recovered: res.ok && res.recovered === true,
    recovered_count: res.ok ? res.recoveredCount : 0,
    candidates_count: res.ok && Array.isArray(res.value.wiki_candidates) ? res.value.wiki_candidates.length : 0,
    first_title: res.ok ? res.value.wiki_candidates?.[0]?.title : null,
  };
  if (!report.ok) return fail(report, 'truncated wiki_candidates reply was not recovered');
  if (!report.marked_recovered) return fail(report, 'recovered reply not marked as recovered');
  if (report.recovered_count !== 2) return fail(report, `expected 2 recovered candidates, got ${report.recovered_count}`);
  if (report.candidates_count !== 2) return fail(report, `expected 2 candidates, got ${report.candidates_count}`);
  if (report.first_title !== '완성 후보 1') return fail(report, 'first recovered candidate title mismatch');
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
    original_terms_is_array: Array.isArray(entry.original_terms),
  };
  if (!report.status_draft) return fail(report, 'imported entry not draft');
  if (!report.has_llm_tag) return fail(report, 'LLM provenance tag missing (출처 표시)');
  if (!report.original_is_verbatim_chunk) return fail(report, 'original_text is NOT the verbatim chunk (preservation broken)');
  if (!report.original_not_chatgpt_quote) return fail(report, 'original_text leaked the ChatGPT quote');
  if (!report.translated_is_summary_ko) return fail(report, 'translated_text is not the Catholic summary_ko');
  if (!report.evidence_bound_to_chunk) return fail(report, 'evidence not bound to real chunk_id');
  if (!report.original_terms_is_array) return fail(report, 'original_terms field missing on imported entry');
  pass(report);
}

async function importEvidenceTranslation() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const { buildEntryFromValidated } = await import('../src/lib/bridge/wikiImport.ts');
  const quote = '탄식 시편이 하느님께 대한 신뢰의 표현이라고 주장한다';
  const chunk = mkChunk({
    text: `저자는 ${quote}. 이 문장은 더 긴 청크 안에 있다.`,
  });
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '탄식 시편의 신학',
          schema_field: '시편 신학',
          summary_ko: '짧은 요약',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote,
              translation_ko: '탄식 시편은 하느님께 대한 신뢰의 표현이라는 뜻이다.',
            },
          ],
          confidence: 'high',
        },
      ],
    },
    ['chunk-real-0'],
  );
  const entry = buildEntryFromValidated(res.importable[0], {
    source_id: 'src',
    chunks: [chunk],
    now: '2026-05-23T00:00:00Z',
  });
  const claim = entry.claims[0];
  const report = {
    scenario: 'import-evidence-translation',
    original_is_exact_source_quote: claim.original_text === quote,
    original_not_whole_chunk_when_quote_binds: claim.original_text !== chunk.text,
    translated_is_evidence_translation: claim.translated_text === '탄식 시편은 하느님께 대한 신뢰의 표현이라는 뜻이다.',
    translated_not_summary_fallback: claim.translated_text !== '짧은 요약',
  };
  if (!report.original_is_exact_source_quote) return fail(report, 'original_text did not use exact source quote');
  if (!report.original_not_whole_chunk_when_quote_binds) return fail(report, 'original_text stayed whole chunk despite exact quote');
  if (!report.translated_is_evidence_translation) return fail(report, 'translation_ko did not populate translated_text');
  if (!report.translated_not_summary_fallback) return fail(report, 'summary fallback used despite evidence translation');
  pass(report);
}

async function structuralReject() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: 'CHAPTER 7 - Postscript: Portraits of Yahweh',
          schema_field: '1.2 선행 연구 검토',
          summary_ko: '제7장 - 후기: Yahweh의 초상들',
          evidence: [{ chunk_id: 'chunk-real-0', quote: 'CHAPTER 7 - Postscript: Portraits of Yahweh' }],
          confidence: 'medium',
        },
        {
          title: 'David Noel Freedman',
          schema_field: '1.2 선행 연구 검토',
          summary_ko: 'DAVID NOEL FREEDMAN',
          evidence: [{ chunk_id: 'chunk-real-0', quote: 'DAVID NOEL FREEDMAN' }],
          confidence: 'low',
        },
        {
          title: 'Israelite cultural identity',
          type: 'quotation',
          schema_field: '1.2 선행 연구 검토',
          summary_ko: 'The material culture of the region exhibits numerous common points between the Israelites and Canaanites.',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote:
                'The material culture of the region exhibits numerous common points between the Israelites and Canaanites in the Iron I period.',
            },
          ],
          confidence: 'medium',
        },
        {
          title: '이스라엘 문화의 가나안적 연속성',
          schema_field: '1.2 선행 연구 검토',
          summary_ko: '저자는 이스라엘 문화가 가나안 문화와 연속성을 보인다고 주장한다.',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote: '저자는 탄식 시편이 하느님께 대한 신뢰의 표현이라고 주장한다.',
            },
          ],
          confidence: 'high',
        },
      ],
    },
    ['chunk-real-0'],
  );
  const chapter = res.candidates[0];
  const author = res.candidates[1];
  const quoteOnly = res.candidates[2];
  const real = res.candidates[3];
  const report = {
    scenario: 'structural-reject',
    chapter_rejected: !chapter.importable,
    chapter_structural_reason: chapter.violations.some((v) => v.includes('구조 정보 후보 제외')),
    author_rejected: !author.importable,
    author_structural_reason: author.violations.some((v) => v.includes('구조 정보 후보 제외')),
    quote_only_rejected: !quoteOnly.importable,
    quote_only_structural_reason: quoteOnly.violations.some((v) => v.includes('구조 정보 후보 제외')),
    knowledge_importable: real.importable,
    importable_count: res.importable.length,
  };
  if (!report.chapter_rejected || !report.chapter_structural_reason) return fail(report, 'chapter/TOC label was not structurally rejected');
  if (!report.author_rejected || !report.author_structural_reason) return fail(report, 'standalone author name was not structurally rejected');
  if (!report.quote_only_rejected || !report.quote_only_structural_reason) return fail(report, 'quote-only candidate was not structurally rejected by validator');
  if (!report.knowledge_importable) return fail(report, 'real knowledge candidate was wrongly rejected');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
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
    'src/lib/candidate/structuralFilter.ts',
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

// Fix 4 — quote binding. When the validator receives real chunk text, a quote
// must be non-empty and verbatim inside that chunk. A real chunk_id alone is no
// longer enough to make evidence importable.
async function quoteBinding() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const chunk = mkChunk();
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '빈 quote',
          summary_ko: '요약',
          evidence: [{ chunk_id: 'chunk-real-0', quote: '' }],
          confidence: 'high',
        },
        {
          title: '비축자 quote',
          summary_ko: '요약',
          evidence: [{ chunk_id: 'chunk-real-0', quote: '원문에 없는 모델 요약' }],
          confidence: 'high',
        },
        {
          title: '축자 quote',
          summary_ko: '요약',
          evidence: [{ chunk_id: 'chunk-real-0', quote: '탄식 시편이 하느님께 대한 신뢰의 표현' }],
          confidence: 'high',
        },
      ],
    },
    [chunk],
  );
  const empty = res.candidates[0];
  const paraphrase = res.candidates[1];
  const verbatim = res.candidates[2];
  const report = {
    scenario: 'quote-binding',
    empty_rejected: !empty.importable && empty.violations.some((v) => v.includes('quote가 비어')),
    nonverbatim_rejected:
      !paraphrase.importable && paraphrase.violations.some((v) => v.includes('축자로 포함되지 않습니다')),
    verbatim_importable: verbatim.importable,
    importable_count: res.importable.length,
  };
  if (!report.empty_rejected) return fail(report, 'empty quote was importable');
  if (!report.nonverbatim_rejected) return fail(report, 'non-verbatim quote was importable');
  if (!report.verbatim_importable) return fail(report, 'verbatim quote was rejected');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
  pass(report);
}

async function quoteLengthCap() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const { MAX_EVIDENCE_QUOTE_CHARS } = await import('../src/lib/bridge/evidenceLimits.ts');
  const quote600 = 'a'.repeat(MAX_EVIDENCE_QUOTE_CHARS);
  const quote601 = `${quote600}b`;
  const chunk = mkChunk({
    text: `${quote601}\n짧은 문맥도 함께 둔다.`,
    location: { char_start: 0, char_end: quote601.length + 20, page: 12 },
  });
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '600자 근거',
          summary_ko: '정확히 600자 근거는 허용된다.',
          evidence: [{ chunk_id: 'chunk-real-0', quote: quote600 }],
          confidence: 'high',
        },
        {
          title: '601자 근거',
          summary_ko: '601자 근거는 너무 길어 거부된다.',
          evidence: [{ chunk_id: 'chunk-real-0', quote: quote601 }],
          confidence: 'high',
        },
      ],
    },
    [chunk],
  );
  const boundary = res.candidates[0];
  const overlong = res.candidates[1];
  const report = {
    scenario: 'quote-length-cap',
    cap: MAX_EVIDENCE_QUOTE_CHARS,
    boundary_importable: boundary.importable,
    overlong_rejected: !overlong.importable,
    overlong_absent_from_evidence: overlong.evidence.length === 0,
    rejected_reason_mentions_cap: overlong.rejectedEvidence.some(
      (ev) => ev.reason.includes('quote가 너무 깁니다') && ev.reason.includes(`${MAX_EVIDENCE_QUOTE_CHARS}자 이하`),
    ),
    importable_count: res.importable.length,
  };
  if (!report.boundary_importable) return fail(report, 'exactly capped quote was rejected');
  if (!report.overlong_rejected) return fail(report, 'overlong quote was importable');
  if (!report.overlong_absent_from_evidence) return fail(report, 'overlong quote leaked into consumable evidence');
  if (!report.rejected_reason_mentions_cap) return fail(report, 'overlong rejection reason does not mention quote cap');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
  pass(report);
}

async function evidenceDedup() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const { buildEntryFromValidated } = await import('../src/lib/bridge/wikiImport.ts');
  const chunk = mkChunk();
  const quote = '탄식 시편이 하느님께 대한 신뢰의 표현';
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '탄식 시편의 신뢰',
          type: 'concept',
          summary_ko: '탄식 시편은 하느님께 대한 신뢰의 표현으로 읽힌다.',
          evidence: [
            { chunk_id: 'chunk-real-0', quote, translation_ko: '' },
            { chunk_id: 'chunk-real-0', quote, translation_ko: '탄식 시편은 하느님께 대한 신뢰의 표현이다.' },
          ],
          confidence: 'high',
        },
      ],
    },
    [chunk],
  );
  const cand = res.candidates[0];
  const entry = buildEntryFromValidated(cand, {
    source_id: 'src',
    chunks: [chunk],
    now: '2026-05-23T00:00:00Z',
  });
  const report = {
    scenario: 'evidence-dedup',
    candidate_importable: cand.importable,
    evidence_count: cand.evidence.length,
    claim_count: entry.claims.length,
    rich_duplicate_translation_preserved: entry.claims[0]?.translated_text === '탄식 시편은 하느님께 대한 신뢰의 표현이다.',
  };
  if (!report.candidate_importable) return fail(report, 'deduped evidence candidate should remain importable');
  if (report.evidence_count !== 1) return fail(report, `expected 1 validated evidence, got ${report.evidence_count}`);
  if (report.claim_count !== 1) return fail(report, `expected 1 imported claim, got ${report.claim_count}`);
  if (!report.rich_duplicate_translation_preserved) return fail(report, 'non-empty duplicate evidence translation was not preserved');
  pass(report);
}

async function bridgeManualBind() {
  const bridge = readFileSync(resolve(ROOT, 'src/lib/components/BridgePanel.svelte'), 'utf8');
  const main = readFileSync(resolve(ROOT, 'src/lib/components/views/MainTab.svelte'), 'utf8');
  const actions = readFileSync(resolve(ROOT, 'src/lib/pipeline/actions.ts'), 'utf8');
  const report = {
    scenario: 'bridge-manual-bind',
    manual_validate_uses_full_chunks: /validateResponse\(parsed\.value,\s*input\.chunks\)/.test(bridge),
    auto_validate_uses_full_chunks: /autoExtractCandidate\(codexProvider,\s*input,\s*input\.chunks\)/.test(bridge),
    stale_known_chunk_prop_removed: !bridge.includes('knownChunkIds') && !main.includes('knownChunkIds'),
    stale_known_chunk_action_removed: !actions.includes('bridgeKnownChunkIds'),
  };
  if (!report.manual_validate_uses_full_chunks) {
    return fail(report, 'manual paste path no longer validates against full chunk objects');
  }
  if (!report.auto_validate_uses_full_chunks) {
    return fail(report, 'auto bridge path no longer validates against full chunk objects');
  }
  if (!report.stale_known_chunk_prop_removed) {
    return fail(report, 'string-only knownChunkIds bridge prop is still present');
  }
  if (!report.stale_known_chunk_action_removed) {
    return fail(report, 'string-only bridgeKnownChunkIds action is still present');
  }
  pass(report);
}

async function catholicTerms() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const chunk = mkChunk();
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: '하나님과 이신칭의',
          summary_ko: '하나님의 은혜로 이신칭의가 이루어진다는 표현',
          reason: '칭의라는 번역을 사용함',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote: '탄식 시편이 하느님께 대한 신뢰의 표현',
              translation_ko: '하나님의 은혜',
            },
          ],
          confidence: 'high',
        },
        {
          title: '하느님과 의화',
          summary_ko: '하느님의 은총과 의화를 가리키는 표현',
          reason: '가톨릭 용어를 사용함',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote: '탄식 시편이 하느님께 대한 신뢰의 표현',
              translation_ko: '하느님의 은총',
            },
          ],
          confidence: 'high',
        },
        {
          title: '은혜',
          type: 'religious_text',
          summary_ko: '은혜라는 번역을 사용함',
          reason: '종교 텍스트 번역',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote: '탄식 시편이 하느님께 대한 신뢰의 표현',
              translation_ko: '은혜',
            },
          ],
          confidence: 'medium',
        },
        {
          title: '사사기와 여호와',
          type: 'religious_text',
          summary_ko: '사사기와 출애굽기는 여호와의 행위를 설명한다고 번역함',
          reason: '마가복음과 마태복음도 개신교식 명칭으로 적음',
          evidence: [
            {
              chunk_id: 'chunk-real-0',
              quote: '탄식 시편이 하느님께 대한 신뢰의 표현',
              translation_ko: '사사기, 출애굽기, 마가복음, 마태복음, 누가복음, 여호와',
            },
          ],
          confidence: 'medium',
        },
      ],
    },
    [chunk],
  );
  const bad = res.candidates[0];
  const good = res.candidates[1];
  const religiousGrace = res.candidates[2];
  const bookNames = res.candidates[3];
  const report = {
    scenario: 'catholic-terms',
    protestant_terms_rejected: !bad.importable,
    violation_mentions_catholic_terms: bad.violations.some((v) => v.includes('가톨릭 용어 표준 위반')),
    standard_terms_importable: good.importable,
    religious_grace_rejected: !religiousGrace.importable && religiousGrace.violations.some((v) => v.includes('"은혜" 대신 "은총"')),
    book_names_rejected:
      !bookNames.importable &&
      ['사사기', '출애굽기', '마가복음', '마태복음', '누가복음', '여호와'].every((term) =>
        bookNames.violations.some((v) => v.includes(`"${term}"`)),
      ),
    importable_count: res.importable.length,
  };
  if (!report.protestant_terms_rejected) return fail(report, 'Protestant terminology was importable');
  if (!report.violation_mentions_catholic_terms) return fail(report, 'Catholic terminology violation was not surfaced');
  if (!report.standard_terms_importable) return fail(report, 'standard Catholic terms were rejected');
  if (!report.religious_grace_rejected) return fail(report, 'religious grace term was not rejected');
  if (!report.book_names_rejected) return fail(report, 'non-Catholic biblical book/divine-name terms were not rejected');
  if (report.importable_count !== 1) return fail(report, `expected exactly 1 importable, got ${report.importable_count}`);
  pass(report);
}

async function domainNeutralGuidance() {
  const { buildGlobalPrompt } = await import('../src/lib/bridge/promptBuilder.ts');
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const { validatedCandidateToTrace } = await import('../src/lib/diagnostics/extractionReport.ts');
  const chunk = mkChunk({
    chunk_id: 'law-chunk-1',
    text: 'The court held that consideration requires a bargained-for legal detriment, not merely a moral obligation.',
  });
  const prompt = buildGlobalPrompt({
    schema: ['1. 계약 성립 요건', '2. 판례상 약인 법리'],
    chunks: [chunk],
  });
  const res = validateResponse(
    {
      wiki_candidates: [
        {
          title: 'Consideration requires bargained-for detriment',
          type: 'concept',
          discipline_profile: '법학/계약법 판례',
          discipline_unit: '판례상 법리',
          schema_field: '2. 판례상 약인 법리',
          mapping_reason: '약인 요건을 설명하는 판례 법리라서 해당 목차에 대응한다.',
          summary_ko: '약인은 단순한 도덕적 의무가 아니라 교섭된 법적 불이익을 요구한다.',
          evidence: [
            {
              chunk_id: 'law-chunk-1',
              quote: 'The court held that consideration requires a bargained-for legal detriment, not merely a moral obligation.',
              translation_ko: '법원은 약인이 단순한 도덕적 의무가 아니라 교섭된 법적 불이익을 요구한다고 판시했다.',
            },
          ],
          standard_terms: ['consideration', 'bargained-for legal detriment', 'moral obligation'],
          reuse_reason: '계약법 약인 요건을 설명할 때 반복해서 참조할 수 있는 법리 단위다.',
          boundary_note: '이 청크만으로 모든 관할의 약인 법리를 일반화할 수는 없다.',
          confidence: 'high',
          reason: '원문이 약인의 요건과 한계를 직접 판시한다.',
        },
      ],
    },
    [chunk],
  );
  const cand = res.candidates[0];
  const trace = validatedCandidateToTrace(cand);
  const nonReligiousGrace = validateResponse(
    {
      wiki_candidates: [
        {
          title: 'Grace as social favor',
          type: 'concept',
          discipline_profile: '문학/인물 관계 분석',
          discipline_unit: '서사적 관계 개념',
          schema_field: '인물 관계',
          mapping_reason: '인물 간 호의의 의미를 해석하는 개념이다.',
          summary_ko: '은혜는 여기서 인물 간 호의와 빚의 감각을 가리킨다.',
          evidence: [
            {
              chunk_id: 'law-chunk-1',
              quote: 'The court held that consideration requires a bargained-for legal detriment, not merely a moral obligation.',
              translation_ko: '이 대목은 법적 불이익과 도덕적 의무를 구분한다.',
            },
          ],
          standard_terms: ['grace', 'favor'],
          reuse_reason: '타 전공 자료에서 용어의 분야별 의미를 구분하는 사례다.',
          boundary_note: '이 장면만으로 작품 전체의 관계 구조를 일반화할 수는 없다.',
          confidence: 'medium',
          reason: '문맥상 일반 관계 개념으로 쓰인다.',
        },
      ],
    },
    [chunk],
  ).candidates[0];
  const report = {
    scenario: 'domain-neutral-guidance',
    prompt_has_cross_discipline_examples:
      prompt.includes('법학 판례/요건') && prompt.includes('의학 기전/근거수준') && prompt.includes('역사학 사료/해석'),
    prompt_keeps_catholic_for_religion: prompt.includes('성서학/종교/성경 관련 내용은 가톨릭 용어 우선'),
    candidate_importable: cand.importable,
    preserves_profile: cand.discipline_profile === '법학/계약법 판례',
    preserves_unit: cand.discipline_unit === '판례상 법리',
    preserves_mapping_reason: cand.mapping_reason.includes('약인 요건'),
    preserves_standard_terms: cand.standard_terms.includes('consideration'),
    trace_carries_reuse_boundary:
      trace.reuse_reason.includes('계약법') && trace.boundary_note.includes('일반화'),
    nonreligious_grace_importable: nonReligiousGrace.importable,
    nonreligious_grace_violations: nonReligiousGrace.violations,
  };
  if (!report.prompt_has_cross_discipline_examples) return fail(report, 'prompt lacks cross-discipline examples');
  if (!report.prompt_keeps_catholic_for_religion) return fail(report, 'religious/Catholic terminology guard missing');
  if (!report.candidate_importable) return fail({ ...report, violations: cand.violations }, 'non-religious legal candidate should validate');
  if (!report.preserves_profile) return fail(report, 'discipline_profile not preserved');
  if (!report.preserves_unit) return fail(report, 'discipline_unit not preserved');
  if (!report.preserves_mapping_reason) return fail(report, 'mapping_reason not preserved');
  if (!report.preserves_standard_terms) return fail(report, 'standard_terms not preserved');
  if (!report.trace_carries_reuse_boundary) return fail(report, 'diagnostic trace lacks reuse/boundary judgment');
  if (!report.nonreligious_grace_importable) return fail(report, 'non-religious grace/favor usage was wrongly rejected');
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
  'partial-json-recovery': partialJsonRecovery,
  'validate-shape': validateShape,
  'evidence-bind': evidenceBind,
  'confidence-enum': confidenceEnum,
  'import-build': importBuild,
  'import-evidence-translation': importEvidenceTranslation,
  'structural-reject': structuralReject,
  'offline-no-network': offlineNoNetwork,
  'source-scope': sourceScope,
  'rejected-evidence': rejectedEvidence,
  'quote-binding': quoteBinding,
  'quote-length-cap': quoteLengthCap,
  'evidence-dedup': evidenceDedup,
  'bridge-manual-bind': bridgeManualBind,
  'catholic-terms': catholicTerms,
  'domain-neutral-guidance': domainNeutralGuidance,
  'fallback-refusal': fallbackRefusal,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice5b-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
