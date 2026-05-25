#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 3 ACs (deterministic, no LLM, no network).
 *
 * Authority: agreed_contract.json#AC-CHUNK + AC-OUTLINE + AC-WIKI-PERSIST +
 *            AC-EDIT-PERSIST + AC-TRANSLATE(원문 보존) + AC-CLASSIFY-MAP.
 *
 * Scenarios (run individually; exit 0 = pass):
 *   chunk-determinism      same input -> byte-identical chunks + ids
 *   outline-parse          paste text -> node tree with stable ids
 *   wiki-roundtrip         WikiEntry -> markdown -> WikiEntry preserves fields
 *   original-preserved     translation never mutates original_text
 *   catholic-terminology   translate prompt forbids Protestant terms (Rust-side
 *                          prompt mirrored here as a doc check via config file)
 *   classify-fallback      no-LLM path still yields editable mappings/entries
 *   chunk-crlf-defense     direct CRLF input is normalized before chunking so
 *                          markdown headings and block text remain stable
 *   chunk-pdf-page-break   PDF form-feed page boundary prevents cross-page chunks
 *
 * Usage: node --import tsx fixtures/t1-slice3-smoke.mjs <scenario>
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

async function chunkDeterminism() {
  const { extractCandidates } = await import('../src/lib/extract/candidateExtractor.ts');
  const { chunksFromBundle } = await import('../src/lib/chunk/chunkFromBundle.ts');
  const { chunksToJsonl } = await import('../src/lib/chunk/chunker.ts');
  const fp = resolve(ROOT, 'fixtures/markdown/concept-quotation-sample.md');
  const buf = new Uint8Array(readFileSync(fp));
  const b1 = await extractCandidates({ source_id: 'det', filename: 'concept-quotation-sample.md', buffer: buf });
  const b2 = await extractCandidates({ source_id: 'det', filename: 'concept-quotation-sample.md', buffer: new Uint8Array(readFileSync(fp)) });
  const c1 = chunksToJsonl(await chunksFromBundle(b1));
  const c2 = chunksToJsonl(await chunksFromBundle(b2));
  const chunks1 = await chunksFromBundle(b1);
  const report = {
    scenario: 'chunk-determinism',
    chunk_count: chunks1.length,
    identical: c1 === c2,
    every_chunk_has_id_and_source: chunks1.every((c) => c.chunk_id && c.source_id && typeof c.location.char_start === 'number'),
    sample_chunk_id: chunks1[0]?.chunk_id ?? null,
  };
  if (!report.identical) return fail(report, 'chunk re-parse not byte-identical');
  if (chunks1.length < 1) return fail(report, 'no chunks produced');
  if (!report.every_chunk_has_id_and_source) return fail(report, 'a chunk is missing id/source/location');
  pass(report);
}

async function chunkCrlfDefense() {
  const { chunkSource } = await import('../src/lib/chunk/chunker.ts');
  const text = [
    '# Covenant',
    '',
    'Concept: Covenant Theology - The source defines covenant theology as a reusable interpretive category.',
    '',
    'The author argues that covenant theology should be distinguished from a mere list of treaty parallels because the concept organizes claims about divine-human relationship.',
  ].join('\r\n');
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const chunks = await chunkSource({
    source_id: 'crlf',
    kind: 'markdown',
    normalized_text: text,
  });
  const report = {
    scenario: 'chunk-crlf-defense',
    chunk_count: chunks.length,
    no_cr_chars: chunks.every((chunk) => !chunk.text.includes('\r')),
    heading_path_kept: chunks.some((chunk) => chunk.heading_path.includes('Covenant')),
    has_concept_chunk: chunks.some((chunk) => chunk.text.includes('Covenant Theology')),
    stable_locations: chunks.every((chunk) => chunk.location.char_end > chunk.location.char_start),
    slice_matches_text: chunks.every((chunk) => normalizedText.slice(chunk.location.char_start, chunk.location.char_end) === chunk.text),
  };
  if (chunks.length < 1) return fail(report, 'CRLF input produced no chunks');
  if (!report.no_cr_chars) return fail(report, 'CR characters leaked into chunk text');
  if (!report.heading_path_kept) return fail(report, 'markdown heading path was not retained under CRLF input');
  if (!report.has_concept_chunk) return fail(report, 'expected content chunk missing under CRLF input');
  if (!report.stable_locations) return fail(report, 'CRLF chunk locations are invalid');
  if (!report.slice_matches_text) return fail(report, 'chunk char ranges do not slice back to exact chunk text');
  pass(report);
}

async function chunkPdfPageBreak() {
  const { chunkSource } = await import('../src/lib/chunk/chunker.ts');
  const text = 'Page one claim has no trailing newline\fPage two claim starts immediately';
  const page2Start = text.indexOf('\f') + 1;
  const chunks = await chunkSource({
    source_id: 'pdf-pages',
    kind: 'pdf',
    normalized_text: text,
    page_starts: [0, page2Start],
  });
  const report = {
    scenario: 'chunk-pdf-page-break',
    chunk_count: chunks.length,
    pages: chunks.map((chunk) => chunk.location.page),
    no_form_feed_in_text: chunks.every((chunk) => !chunk.text.includes('\f')),
    no_cross_page_chunk: chunks.every((chunk) => chunk.text.includes('Page one') !== chunk.text.includes('Page two')),
    slice_matches_text: chunks.every((chunk) => text.slice(chunk.location.char_start, chunk.location.char_end) === chunk.text),
  };
  if (chunks.length !== 2) return fail(report, `expected 2 page-bounded chunks, got ${chunks.length}`);
  if (report.pages.join(',') !== '1,2') return fail(report, `expected page attribution 1,2, got ${report.pages.join(',')}`);
  if (!report.no_form_feed_in_text) return fail(report, 'form-feed leaked into chunk text');
  if (!report.no_cross_page_chunk) return fail(report, 'PDF chunk crossed a form-feed page boundary');
  if (!report.slice_matches_text) return fail(report, 'PDF chunk char ranges do not slice back to exact chunk text');
  pass(report);
}

async function outlineParse() {
  const { parseOutline } = await import('../src/lib/outline/outlineParser.ts');
  const text = `1. 서론
  1.1 연구 배경
  1.2 연구 목적
2. 본론
  2.1 시편의 탄식
3. 결론`;
  const o1 = parseOutline(text);
  const o2 = parseOutline(text);
  const report = {
    scenario: 'outline-parse',
    node_count: o1.nodes.length,
    roots: o1.roots,
    deterministic: JSON.stringify(o1) === JSON.stringify(o2),
    levels: o1.nodes.map((n) => ({ id: n.id, level: n.level, title: n.title })),
  };
  if (o1.nodes.length !== 6) return fail(report, `expected 6 nodes, got ${o1.nodes.length}`);
  if (o1.roots.length !== 3) return fail(report, `expected 3 roots, got ${o1.roots.length}`);
  if (!report.deterministic) return fail(report, 'outline parse not deterministic');
  // 1.1 should nest under 1.
  const n2 = o1.nodes.find((n) => n.id === 'n2');
  if (!n2 || n2.parent !== 'n1') return fail(report, '1.1 did not nest under 1');
  pass(report);
}

async function wikiRoundtrip() {
  const { entryToMarkdown, markdownToEntry } = await import('../src/lib/wiki/wikiMarkdown.ts');
  const entry = {
    id: 'src1-n2',
    title: '시편의 탄식',
    category: 'extracted',
    status: 'draft',
    outline_node_id: 'n2',
    summary: '저장 왕복에서 사라지면 안 되는 항목 요약',
    claims: [
      {
        claim_id: 'c1',
        statement: '탄식 시편은 의화의 맥락에서 읽힌다.',
        translated_text: '주께서 의화의 은총을 베푸신다.',
        original_text: 'The LORD justifies by grace — line spanning\nmultiple lines.',
        evidence_refs: ['src1#chunk-3', 'page-2'],
        candidate_id: 'cand-abc',
      },
    ],
    source_ids: ['src1'],
    original_terms: ['Psalm', 'justifies by grace'],
    tags: ['psalm'],
    related: [],
    created_from_candidates: ['cand-abc'],
    created_at: '2026-05-22T00:00:00.000Z',
    updated_at: '2026-05-22T00:00:00.000Z',
    review_notes: null,
  };
  const md = entryToMarkdown(entry);
  const back = markdownToEntry(md);
  const claimOk =
    back.claims.length === 1 &&
    back.claims[0].statement === entry.claims[0].statement &&
    back.claims[0].translated_text === entry.claims[0].translated_text &&
    back.claims[0].original_text === entry.claims[0].original_text &&
    JSON.stringify(back.claims[0].evidence_refs) === JSON.stringify(entry.claims[0].evidence_refs);
  const report = {
    scenario: 'wiki-roundtrip',
    title_ok: back.title === entry.title,
    outline_ok: back.outline_node_id === entry.outline_node_id,
    status_ok: back.status === entry.status,
    summary_ok: back.summary === entry.summary,
    original_terms_ok: JSON.stringify(back.original_terms) === JSON.stringify(entry.original_terms),
    claim_ok: claimOk,
    human_readable: md.includes('# 시편의 탄식') && md.includes('## 주장'),
  };
  if (!report.title_ok || !report.outline_ok || !report.status_ok || !report.summary_ok || !report.original_terms_ok) return fail(report, 'frontmatter/body round-trip lost a field');
  if (!claimOk) return fail(report, 'claim round-trip lost a field (statement/translation/original/evidence)');
  if (!report.human_readable) return fail(report, 'markdown is not human-readable (missing heading/claims section)');
  pass(report);
}

async function originalPreserved() {
  // Simulate the translate path: applying a translation must NOT change
  // original_text. We exercise the builder + a translation map.
  const { buildEntriesFromCandidates } = await import('../src/lib/wiki/wikiBuilder.ts');
  const candidates = [
    {
      local_candidate_id: 'k1',
      title: 'Justification by grace',
      type: 'concept',
      category: 'extracted',
      summary: 'A concept.',
      evidence_refs: ['src#1'],
      suggested_action: 'create_new',
      source_id: 'src',
      span: { start: 0, end: 10 },
      evidence_text: 'Justification is by grace alone — VERBATIM ORIGINAL.',
    },
  ];
  const before = candidates[0].evidence_text;
  const withTr = buildEntriesFromCandidates({
    source_id: 'src',
    candidates,
    mappings: [{ local_candidate_id: 'k1', outline_node_id: null, recommended_action: 'create_new', rationale: '' }],
    outlineTitleById: {},
    translations: { k1: '은총만으로 의화된다.' },
  });
  const claim = withTr[0].claims[0];
  const report = {
    scenario: 'original-preserved',
    original_unchanged: claim.original_text === before,
    translation_separate_field: claim.translated_text === '은총만으로 의화된다.',
    original_value: claim.original_text,
  };
  if (!report.original_unchanged) return fail(report, 'original_text was mutated by translation');
  if (!report.translation_separate_field) return fail(report, 'translation not stored in separate field');
  pass(report);
}

async function catholicTerminology() {
  // The translate system prompt lives in the Rust module; the config file is
  // the single source for the model id. We assert the config + the prompt
  // invariants by reading the Rust source as text (doc-level guard) so a
  // regression that strips the Catholic policy is caught in Tier 1.
  const llmSrc = readFileSync(resolve(ROOT, 'src-tauri/src/llm_cmd.rs'), 'utf8');
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'src-tauri/llm.config.json'), 'utf8'));
  const required = ['의화', '판관기', '마르코 복음', 'FORBIDDEN', 'Protestant'];
  const missing = required.filter((t) => !llmSrc.includes(t));
  const protestantBadTerms = ['칭의', '은혜로 의롭'];
  const report = {
    scenario: 'catholic-terminology',
    model_id: cfg.model,
    auth_mode: cfg.auth,
    required_present: missing.length === 0,
    missing,
  };
  if (cfg.model !== 'gpt-5.4') return fail(report, `model id is not the configured gpt-5.4: ${cfg.model}`);
  if (cfg.auth !== 'oauth_subscription') return fail(report, 'auth mode is not oauth_subscription');
  if (missing.length > 0) return fail(report, `Catholic terminology policy missing tokens: ${missing.join(', ')}`);
  // The prompt must NOT instruct the model to USE Protestant terms (it may name
  // them only inside the FORBIDDEN clause). Heuristic: the bad terms must not
  // appear as a "use" instruction.
  for (const bad of protestantBadTerms) {
    if (llmSrc.includes(`Use ${bad}`)) return fail(report, `prompt instructs Protestant term: ${bad}`);
  }
  pass(report);
}

async function classifyFallback() {
  const { fallbackMappings, buildEntriesFromCandidates } = await import('../src/lib/wiki/wikiBuilder.ts');
  const candidates = [
    {
      local_candidate_id: 'a', title: 'A', type: 'concept', category: 'extracted', summary: 's',
      evidence_refs: ['src#1'], suggested_action: 'create_new', source_id: 'src', span: { start: 0, end: 1 }, evidence_text: 'x',
    },
    {
      local_candidate_id: 'b', title: 'B', type: 'quotation', category: 'extracted', summary: 's',
      evidence_refs: ['src#2'], suggested_action: 'defer', source_id: 'src', span: { start: 2, end: 3 }, evidence_text: 'y',
    },
  ];
  const maps = fallbackMappings(candidates);
  const entries = buildEntriesFromCandidates({ source_id: 'src', candidates, mappings: maps, outlineTitleById: {} });
  const report = {
    scenario: 'classify-fallback',
    mapping_count: maps.length,
    every_mapping_editable: maps.every((m) => 'outline_node_id' in m && typeof m.rationale === 'string'),
    entries_produced: entries.length,
    no_candidate_dropped: entries.reduce((n, e) => n + e.claims.length, 0) === candidates.length,
  };
  if (maps.length !== candidates.length) return fail(report, 'fallback dropped a candidate mapping');
  if (!report.no_candidate_dropped) return fail(report, 'a candidate was dropped from entries (upstream rule: do not discard)');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  'chunk-determinism': chunkDeterminism,
  'chunk-crlf-defense': chunkCrlfDefense,
  'chunk-pdf-page-break': chunkPdfPageBreak,
  'outline-parse': outlineParse,
  'wiki-roundtrip': wikiRoundtrip,
  'original-preserved': originalPreserved,
  'catholic-terminology': catholicTerminology,
  'classify-fallback': classifyFallback,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice3-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
