#!/usr/bin/env node
/**
 * Node harness for T1-determinism, T1-fixture-extraction, T1-schema-validate.
 *
 * Authority: agreed_contract.json#AC-4 + AC-5 + AC-6 + AC-T1-COVERAGE.
 *
 * Designed to run without a Tauri context. Imports the same TypeScript
 * extraction code via tsx-on-the-fly (we invoke through `node --import tsx`).
 *
 * Usage:
 *   node --import tsx fixtures/t1-extract-and-validate.mjs determinism
 *   node --import tsx fixtures/t1-extract-and-validate.mjs fixture-extraction
 *   node --import tsx fixtures/t1-extract-and-validate.mjs schema-validate
 *   node --import tsx fixtures/t1-extract-and-validate.mjs pdf-text-quality
 *   node --import tsx fixtures/t1-extract-and-validate.mjs ocr-quality-gate
 *   node --import tsx fixtures/t1-extract-and-validate.mjs offline-prose-candidates
 *   node --import tsx fixtures/t1-extract-and-validate.mjs offline-original-preservation
 *   node --import tsx fixtures/t1-extract-and-validate.mjs offline-wiki-evidence-chunk-binding
 *   node --import tsx fixtures/t1-extract-and-validate.mjs short-explicit-prose-candidates
 *   node --import tsx fixtures/t1-extract-and-validate.mjs markdown-bold-definition-candidates
 *   node --import tsx fixtures/t1-extract-and-validate.mjs markdown-heading-evidence-range
 *   node --import tsx fixtures/t1-extract-and-validate.mjs original-terms-boundary-candidates
 *   node --import tsx fixtures/t1-extract-and-validate.mjs offline-candidate-dedup
 *
 * Exit codes:
 *   0 = scenario passed
 *   1 = scenario failed (stdout/stderr contain diagnostic)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function loadExtractor() {
  // Dynamic import of TS via tsx loader.
  return await import('../src/lib/extract/candidateExtractor.ts');
}
async function loadSchemaCheck() {
  return await import('../src/lib/validate/schemaCheck.ts');
}

async function runDeterminism() {
  const { extractCandidates } = await loadExtractor();
  const pdfPath = resolve(ROOT, 'fixtures/pdf/concept-quotation-sample.pdf');
  const buf1 = new Uint8Array(readFileSync(pdfPath));
  const buf2 = new Uint8Array(readFileSync(pdfPath));
  const r1 = await extractCandidates({ source_id: 't1-det', filename: 'concept-quotation-sample.pdf', buffer: buf1 });
  const r2 = await extractCandidates({ source_id: 't1-det', filename: 'concept-quotation-sample.pdf', buffer: buf2 });
  const json1 = JSON.stringify(r1.normalized_text);
  const json2 = JSON.stringify(r2.normalized_text);
  const cands1 = JSON.stringify(r1.candidate_items);
  const cands2 = JSON.stringify(r2.candidate_items);
  const textIdentical = json1 === json2;
  const candsIdentical = cands1 === cands2;
  const report = {
    scenario: 'determinism',
    text_identical: textIdentical,
    candidates_identical: candsIdentical,
    candidate_count_run1: r1.candidate_items.length,
    candidate_count_run2: r2.candidate_items.length,
    normalized_text_length: r1.normalized_text.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!textIdentical || !candsIdentical) {
    console.error('[fail] deterministic re-parse mismatch');
    process.exit(1);
  }
  console.log('[ok] deterministic re-parse byte-identical');
}

async function runFixtureExtraction() {
  const { extractCandidates } = await loadExtractor();
  const inputs = [
    { source_id: 'ptx', path: 'fixtures/plaintext/concept-quotation-sample.txt' },
    { source_id: 'md', path: 'fixtures/markdown/concept-quotation-sample.md' },
    { source_id: 'pdf', path: 'fixtures/pdf/concept-quotation-sample.pdf' },
  ];
  const allItems = [];
  const perFixture = [];
  for (const inp of inputs) {
    const fp = resolve(ROOT, inp.path);
    const buf = new Uint8Array(readFileSync(fp));
    const bundle = await extractCandidates({
      source_id: inp.source_id,
      filename: fp.split(/[\\/]/).pop(),
      buffer: buf,
    });
    perFixture.push({
      source_id: inp.source_id,
      kind: bundle.source_kind,
      item_count: bundle.candidate_items.length,
      types: bundle.candidate_items.map((c) => c.type),
    });
    allItems.push(...bundle.candidate_items);
  }
  const conceptCount = allItems.filter((i) => i.type === 'concept').length;
  const quotationCount = allItems.filter((i) => i.type === 'quotation').length;
  const report = {
    scenario: 'fixture-extraction',
    per_fixture: perFixture,
    total_items: allItems.length,
    concept_count: conceptCount,
    quotation_count: quotationCount,
  };
  console.log(JSON.stringify(report, null, 2));
  if (conceptCount < 1 || quotationCount < 1) {
    console.error('[fail] fixture set must emit at least one concept and one quotation');
    process.exit(1);
  }
  console.log('[ok] concept+quotation coverage met');
}

async function runSchemaValidate() {
  const { extractCandidates } = await loadExtractor();
  const { validateCandidates } = await loadSchemaCheck();
  const inputs = [
    { source_id: 'ptx', path: 'fixtures/plaintext/concept-quotation-sample.txt' },
    { source_id: 'md', path: 'fixtures/markdown/concept-quotation-sample.md' },
    { source_id: 'pdf', path: 'fixtures/pdf/concept-quotation-sample.pdf' },
  ];
  const allItems = [];
  for (const inp of inputs) {
    const fp = resolve(ROOT, inp.path);
    const buf = new Uint8Array(readFileSync(fp));
    const bundle = await extractCandidates({
      source_id: inp.source_id,
      filename: fp.split(/[\\/]/).pop(),
      buffer: buf,
    });
    allItems.push(...bundle.candidate_items);
  }
  const r = validateCandidates(allItems);
  const report = {
    scenario: 'schema-validate',
    total_items: allItems.length,
    valid_count: r.validCount,
    invalid_count: r.invalidCount,
    sample_errors: r.errors.slice(0, 5),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!r.ok) {
    console.error('[fail] schema validation produced errors');
    process.exit(1);
  }
  console.log('[ok] all candidate items validate against shared/schemas/candidate_item.schema.json');
}

async function runUploadMagicBytes() {
  // Round-2 cannot easily invoke the Tauri command outside the Tauri shell;
  // instead we directly exercise the TS magicBytes module via the same code
  // path the renderer uses. Parity with the Rust verifier is tested by the
  // cargo unit tests under src-tauri/src/upload_cmd.rs.
  const { verifyMagicBytes } = await import('../src/lib/upload/magicBytes.ts');
  const cases = [
    {
      name: 'plaintext',
      file: 'fixtures/plaintext/concept-quotation-sample.txt',
      filename: 'concept-quotation-sample.txt',
      expectOk: true,
    },
    {
      name: 'markdown',
      file: 'fixtures/markdown/concept-quotation-sample.md',
      filename: 'concept-quotation-sample.md',
      expectOk: true,
    },
    {
      name: 'pdf',
      file: 'fixtures/pdf/concept-quotation-sample.pdf',
      filename: 'concept-quotation-sample.pdf',
      expectOk: true,
    },
    {
      name: 'mismatched-extension',
      file: 'fixtures/pdf/concept-quotation-sample.pdf',
      filename: 'concept-quotation-sample.txt', // declared .txt but bytes are PDF
      expectOk: false,
    },
  ];
  const results = [];
  let failures = 0;
  for (const c of cases) {
    const buf = new Uint8Array(readFileSync(resolve(ROOT, c.file)));
    const head = buf.slice(0, Math.min(256, buf.length));
    const r = verifyMagicBytes(c.filename, head);
    const passed = r.ok === c.expectOk;
    results.push({ ...c, actual: r, passed });
    if (!passed) failures++;
  }
  const report = { scenario: 'upload-magic-bytes', results, failures };
  console.log(JSON.stringify(report, null, 2));
  if (failures > 0) {
    console.error('[fail] one or more magic-bytes cases mismatched');
    process.exit(1);
  }
  console.log('[ok] all magic-bytes cases matched expectation');
}

async function runWikiDisplayShape() {
  // AC-WIKI-DISPLAY evidence: the bundle the renderer hands to
  // src/lib/components/CandidateList.svelte must carry, for every item, the
  // fields the wiki view binds to (title, type, summary, evidence_text,
  // evidence_refs, local_candidate_id). This scenario asserts the contract
  // between extractCandidates() and the display component without a DOM, so a
  // regression in the extractor that silently drops a display field is caught
  // by the headless Tier-1 run rather than only at runtime in the WebView.
  const { extractCandidates } = await loadExtractor();
  const candidateList = readFileSync(resolve(ROOT, 'src/lib/components/CandidateList.svelte'), 'utf8');
  const inputs = [
    { source_id: 'ptx', path: 'fixtures/plaintext/concept-quotation-sample.txt' },
    { source_id: 'md', path: 'fixtures/markdown/concept-quotation-sample.md' },
    { source_id: 'pdf', path: 'fixtures/pdf/concept-quotation-sample.pdf' },
  ];
  // Fields the CandidateList template reads off each item.
  const REQUIRED_DISPLAY_FIELDS = [
    'local_candidate_id',
    'title',
    'type',
    'summary',
    'evidence_text',
    'evidence_refs',
  ];
  const bundles = [];
  const violations = [];
  let renderableItems = 0;
  for (const inp of inputs) {
    const fp = resolve(ROOT, inp.path);
    const buf = new Uint8Array(readFileSync(fp));
    const bundle = await extractCandidates({
      source_id: inp.source_id,
      filename: fp.split(/[\\/]/).pop(),
      buffer: buf,
    });
    // The view also reads bundle.source_id, bundle.source_kind, bundle.candidate_items.
    if (typeof bundle.source_id !== 'string' || !bundle.source_id.length) {
      violations.push({ source: inp.source_id, field: 'bundle.source_id', issue: 'missing/empty' });
    }
    if (!['plaintext', 'markdown', 'pdf'].includes(bundle.source_kind)) {
      violations.push({ source: inp.source_id, field: 'bundle.source_kind', issue: `unexpected: ${bundle.source_kind}` });
    }
    if (!Array.isArray(bundle.candidate_items)) {
      violations.push({ source: inp.source_id, field: 'bundle.candidate_items', issue: 'not an array' });
    }
    for (const item of bundle.candidate_items) {
      renderableItems++;
      for (const f of REQUIRED_DISPLAY_FIELDS) {
        const v = item[f];
        const ok = f === 'evidence_refs'
          ? Array.isArray(v) && v.length >= 1
          : typeof v === 'string' && v.length >= 1;
        if (!ok) {
          violations.push({ source: inp.source_id, item: item.local_candidate_id ?? '(no id)', field: f, issue: 'missing/empty for display' });
        }
      }
      // Title must not exceed the schema cap that the chip layout assumes.
      if (typeof item.title === 'string' && item.title.length > 240) {
        violations.push({ source: inp.source_id, item: item.local_candidate_id, field: 'title', issue: 'exceeds 240 chars' });
      }
    }
    bundles.push({ source_id: inp.source_id, kind: bundle.source_kind, items: bundle.candidate_items.length });
  }
  const report = {
    scenario: 'wiki-display-shape',
    bundles,
    renderable_items: renderableItems,
    violations,
    candidate_list_korean_ui:
      /아직 추출한 원문이 없습니다/.test(candidateList) &&
      /추출 후보가 없습니다/.test(candidateList) &&
      /후보 \{item_count\}개/.test(candidateList) &&
      /concept: '개념'/.test(candidateList) &&
      !/No source extracted yet|Extracted from|Source Text|No candidate items found/.test(candidateList),
  };
  console.log(JSON.stringify(report, null, 2));
  if (renderableItems < 1) {
    console.error('[fail] no renderable items produced — wiki view would be empty across all fixtures');
    process.exit(1);
  }
  if (violations.length > 0) {
    console.error(`[fail] ${violations.length} display-field violations — CandidateList would render incompletely`);
    process.exit(1);
  }
  if (!report.candidate_list_korean_ui) {
    console.error('[fail] CandidateList still exposes English user-facing copy');
    process.exit(1);
  }
  console.log('[ok] every candidate item carries the fields the wiki view binds to');
}

async function runPdfTextQuality() {
  const { analyzePdfTextQuality } = await import('../src/lib/extract/textQuality.ts');
  const scanned = analyzePdfTextQuality(['', '   ', '']);
  const weak = analyzePdfTextQuality([
    'Title page',
    'Short',
    'This page has a little bit of text but not enough for reliable extraction.',
  ]);
  const good = analyzePdfTextQuality([
    'This page argues that textual evidence can support a reusable academic claim. '.repeat(8),
    'The author defines a method and demonstrates its limits with enough surrounding context. '.repeat(8),
  ]);
  const report = {
    scenario: 'pdf-text-quality',
    scanned_level: scanned.level,
    scanned_has_ocr_hint: scanned.suggestion_ko.includes('OCR'),
    weak_level: weak.level,
    good_level: good.level,
    good_page_counts: good.page_char_counts.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (scanned.level !== 'bad') {
    console.error(`[fail] scanned-like PDF should be bad, got ${scanned.level}`);
    process.exit(1);
  }
  if (!report.scanned_has_ocr_hint) {
    console.error('[fail] scanned-like PDF warning should mention OCR');
    process.exit(1);
  }
  if (weak.level === 'ok') {
    console.error('[fail] weak text extraction should warn or fail');
    process.exit(1);
  }
  if (good.level !== 'ok') {
    console.error(`[fail] good text extraction should be ok, got ${good.level}`);
    process.exit(1);
  }
  if (good.page_char_counts.length !== 2) {
    console.error('[fail] page_char_counts should preserve page count');
    process.exit(1);
  }
  console.log('[ok] PDF text-quality warnings classify scanned/weak/good pages');
}

async function runOcrQualityGate() {
  const extractor = readFileSync(resolve(ROOT, 'src/lib/extract/candidateExtractor.ts'), 'utf8');
  const actions = readFileSync(resolve(ROOT, 'src/lib/pipeline/actions.ts'), 'utf8');
  const report = {
    scenario: 'ocr-quality-gate',
    extractor_blocks_bad_pdf_candidates: /text_quality\.level\s*===\s*['"]bad['"]\s*\?\s*\[\]/.test(extractor),
    actions_has_bad_quality_notice: /function\s+badTextQualityNotice\(\)/.test(actions),
    rule_engine_checks_quality: /export function runRuleEngine\(\)[\s\S]*badTextQualityNotice\(\)/.test(actions),
    build_wiki_checks_quality: /export async function buildWiki\(\)[\s\S]*badTextQualityNotice\(\)/.test(actions),
    notice_mentions_ocr: /OCR 처리된 PDF나 txt\/md/.test(actions),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.extractor_blocks_bad_pdf_candidates) {
    console.error('[fail] bad PDF text quality should block candidate creation');
    process.exit(1);
  }
  if (!report.actions_has_bad_quality_notice) {
    console.error('[fail] pipeline lacks OCR quality blocking notice');
    process.exit(1);
  }
  if (!report.rule_engine_checks_quality) {
    console.error('[fail] offline rule engine should stop on bad OCR quality');
    process.exit(1);
  }
  if (!report.build_wiki_checks_quality) {
    console.error('[fail] wiki build should stop on bad OCR quality');
    process.exit(1);
  }
  if (!report.notice_mentions_ocr) {
    console.error('[fail] OCR quality notice should tell the user how to recover');
    process.exit(1);
  }
  console.log('[ok] bad OCR quality blocks extraction/build before noisy wiki cards');
}

async function runOfflineProseCandidates() {
  const { extractCandidates } = await loadExtractor();
  const text = [
    'Concept: Source criticism — a method for separating compositional layers in a text.',
    'Consideration is a bargained-for exchange.',
    'Validity refers to the degree to which an instrument measures the construct it claims to measure.',
    '',
    'The author argues that Israelite identity should be interpreted through overlapping cultural continuities because the material record does not support a simple ethnic separation.',
    'The author argues that covenant theology shapes the narrative (cf. Genesis 12) because the cited tradition frames promise, kinship, and land as one reusable interpretive pattern.',
    'This method compares royal inscriptions, biblical poetry, and archaeological patterns to distinguish textual memory from later theological synthesis.',
    'However, the chapter challenges the older conquest model because several regional continuities make a single abrupt replacement unlikely.',
    'The next line is a short quotation shard.',
    '"other deities"',
    'The surrounding sentence explains why the short shard should not become a standalone wiki card.',
    '"Practice without feedback is rehearsal of mediocrity, not improvement."',
    'The following sentence gives enough local context for the quotation evidence.',
  ].join('\n');
  const bundle = await extractCandidates({
    source_id: 'offline-prose',
    filename: 'offline-prose.txt',
    buffer: new TextEncoder().encode(text),
  });
  const types = bundle.candidate_items.map((i) => i.type);
  const titles = bundle.candidate_items.map((i) => i.title);
  const longQuote = bundle.candidate_items.find((i) => i.type === 'quotation');
  const conceptTitles = bundle.candidate_items.filter((i) => i.type === 'concept').map((i) => i.title);
  const conceptOriginalTerms = Array.from(new Set(bundle.candidate_items
    .filter((i) => i.type === 'concept')
    .flatMap((i) => i.original_terms ?? [])));
  const report = {
    scenario: 'offline-prose-candidates',
    item_count: bundle.candidate_items.length,
    types,
    titles,
    concept_titles: conceptTitles,
    concept_original_terms: conceptOriginalTerms,
    has_argument: types.includes('argument'),
    has_method: types.includes('method'),
    has_objection: types.includes('objection'),
    short_english_definitions_kept:
      conceptTitles.includes('Consideration') && conceptTitles.includes('Validity'),
    short_english_definition_terms_kept:
      conceptOriginalTerms.includes('Consideration') && conceptOriginalTerms.includes('Validity'),
    citation_argument_kept: bundle.candidate_items.some((i) => i.type === 'argument' && i.summary.includes('(cf. Genesis 12)')),
    short_quote_filtered: !titles.includes('other deities'),
    quote_context_expanded: !!longQuote?.evidence_text.includes('following sentence'),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.has_argument) {
    console.error('[fail] conservative prose extraction should emit an argument candidate');
    process.exit(1);
  }
  if (!report.has_method) {
    console.error('[fail] conservative prose extraction should emit a method candidate');
    process.exit(1);
  }
  if (!report.has_objection) {
    console.error('[fail] conservative prose extraction should emit an objection candidate');
    process.exit(1);
  }
  if (!report.short_english_definitions_kept) {
    console.error('[fail] short domain-neutral English definitions should emit concept candidates');
    process.exit(1);
  }
  if (!report.short_english_definition_terms_kept) {
    console.error('[fail] short domain-neutral English concept titles should survive original_terms');
    process.exit(1);
  }
  if (!report.citation_argument_kept) {
    console.error('[fail] prose with a citation fragment and a real claim should remain extractable');
    process.exit(1);
  }
  if (!report.short_quote_filtered) {
    console.error('[fail] short quotation shard should be filtered before candidate creation');
    process.exit(1);
  }
  if (!report.quote_context_expanded) {
    console.error('[fail] quotation evidence should include local context');
    process.exit(1);
  }
  console.log('[ok] conservative offline prose candidates and quotation context behave as expected');
}

async function runMarkdownBoldDefinitionCandidate() {
  const { extractCandidates } = await loadExtractor();
  const text = [
    '# Notes',
    '',
    '**Sensus plenior** — A fuller textual sense recognized through later canonical reception and careful source evidence. The author argues that later canonical reception should be treated as a controlled interpretive context because source evidence requires explicit limits.',
  ].join('\n');
  const bundle = await extractCandidates({
    source_id: 'markdown-bold-definition',
    filename: 'markdown-bold-definition.md',
    buffer: new TextEncoder().encode(text),
  });
  const concept = bundle.candidate_items.find((item) => item.type === 'concept' && item.title === 'Sensus plenior');
  const argument = bundle.candidate_items.find((item) => item.type === 'argument');
  const report = {
    scenario: 'markdown-bold-definition-candidates',
    item_count: bundle.candidate_items.length,
    concept_title: concept?.title ?? null,
    summary_has_definition: concept?.summary.includes('fuller textual sense') ?? false,
    mixed_argument_kept: !!argument && argument.summary.includes('controlled interpretive context'),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!concept) {
    console.error('[fail] Markdown bold-term definition should emit a concept candidate');
    process.exit(1);
  }
  if (!report.summary_has_definition) {
    console.error('[fail] Markdown bold-term definition summary was not preserved');
    process.exit(1);
  }
  if (!report.mixed_argument_kept) {
    console.error('[fail] Markdown bold-term definition should not suppress a prose argument in the same paragraph');
    process.exit(1);
  }
  console.log('[ok] Markdown bold-term definitions survive candidate extraction');
}

async function runMarkdownHeadingEvidenceRange() {
  const { extractCandidates } = await loadExtractor();
  const text = [
    '# Definition: Sensus plenior',
    '',
    'A fuller textual sense recognized through later canonical reception and careful source evidence.',
  ].join('\n');
  const bundle = await extractCandidates({
    source_id: 'markdown-heading-definition',
    filename: 'markdown-heading-definition.md',
    buffer: new TextEncoder().encode(text),
  });
  const concept = bundle.candidate_items.find((item) => item.type === 'concept' && item.title === 'Sensus plenior');
  const report = {
    scenario: 'markdown-heading-evidence-range',
    found: !!concept,
    evidence_refs: concept?.evidence_refs ?? [],
    evidence_has_body: concept?.evidence_text.includes('fuller textual sense') ?? false,
    source_text_exact: concept?.source_text === text,
    span_covers_body: concept?.span.end === text.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!concept) {
    console.error('[fail] Markdown definition heading should emit a concept candidate');
    process.exit(1);
  }
  if (!report.evidence_has_body) {
    console.error('[fail] heading concept evidence should include the definition body paragraph');
    process.exit(1);
  }
  if (!report.source_text_exact || !report.span_covers_body) {
    console.error('[fail] heading concept span/source_text should cover heading + body exactly');
    process.exit(1);
  }
  if (!report.evidence_refs.includes('markdown-heading-definition#md-block-0') || !report.evidence_refs.includes('markdown-heading-definition#md-block-1')) {
    console.error('[fail] heading concept evidence_refs should include both heading and body blocks');
    process.exit(1);
  }
  console.log('[ok] Markdown heading definitions bind evidence to heading plus body');
}

async function runLineBrokenProseCandidates() {
  const { extractCandidates } = await loadExtractor();
  const oneLine =
    'The author argues that Israelite identity should be interpreted through overlapping cultural continuities because the material record does not support a simple ethnic separation.';
  const broken = [
    'The author argues that Israelite identity should be interpreted through overlapping',
    'cultural continuities because the material record does not support a simple',
    'ethnic separation.',
  ].join('\n');
  const singleBundle = await extractCandidates({
    source_id: 'single-prose',
    filename: 'single-prose.txt',
    buffer: new TextEncoder().encode(oneLine),
  });
  const brokenBundle = await extractCandidates({
    source_id: 'broken-prose',
    filename: 'broken-prose.txt',
    buffer: new TextEncoder().encode(broken),
  });
  const singleArguments = singleBundle.candidate_items.filter((i) => i.type === 'argument');
  const brokenArguments = brokenBundle.candidate_items.filter((i) => i.type === 'argument');
  const report = {
    scenario: 'line-broken-prose-candidates',
    single_argument_count: singleArguments.length,
    broken_argument_count: brokenArguments.length,
    broken_evidence_has_joined_lines: brokenArguments[0]?.evidence_text.includes('\n') ?? false,
    broken_ref_spans_lines: brokenArguments[0]?.evidence_refs[0]?.includes('lines-1-3') ?? false,
  };
  console.log(JSON.stringify(report, null, 2));
  if (singleArguments.length < 1) {
    console.error('[fail] single-line prose should emit an argument candidate');
    process.exit(1);
  }
  if (brokenArguments.length < 1) {
    console.error('[fail] PDF/TXT-style line-broken prose should still emit an argument candidate');
    process.exit(1);
  }
  if (!report.broken_evidence_has_joined_lines) {
    console.error('[fail] broken prose evidence should preserve short surrounding line context');
    process.exit(1);
  }
  if (!report.broken_ref_spans_lines) {
    console.error('[fail] broken prose evidence ref should record a line range');
    process.exit(1);
  }
  console.log('[ok] line-broken prose is grouped before offline candidate classification');
}

async function runOfflineOriginalPreservation() {
  const { extractCandidates } = await loadExtractor();
  const { buildEntriesFromCandidates } = await import('../src/lib/wiki/wikiBuilder.ts');
  const quoteLine = '"Practice with  multiple   spaces\tand source fidelity should remain exactly as written in the source."';
  const prose = 'The author argues that covenant theology should preserve source spacing\tand multiple   spaces because exact wording can matter when a user checks the original evidence.';
  const text = [
    'Short setup line before the quote.',
    quoteLine,
    'Short context line after the quote.',
    '',
    prose,
  ].join('\n');
  const bundle = await extractCandidates({
    source_id: 'offline-preserve',
    filename: 'offline-preserve.txt',
    buffer: new TextEncoder().encode(text),
  });
  const quoteCandidate = bundle.candidate_items.find((item) => item.type === 'quotation');
  const proseCandidate = bundle.candidate_items.find((item) => item.type === 'argument' && item.summary.includes('source spacing'));
  const entries = buildEntriesFromCandidates({
    source_id: bundle.source_id,
    candidates: [quoteCandidate, proseCandidate].filter(Boolean),
    mappings: [quoteCandidate, proseCandidate].filter(Boolean).map((item) => ({
      local_candidate_id: item.local_candidate_id,
      outline_node_id: null,
      recommended_action: item.suggested_action,
      rationale: '',
    })),
    outlineTitleById: {},
  });
  const claims = entries.flatMap((entry) => entry.claims);
  const quoteClaim = claims.find((claim) => claim.candidate_id === quoteCandidate?.local_candidate_id);
  const proseClaim = claims.find((claim) => claim.candidate_id === proseCandidate?.local_candidate_id);
  const report = {
    scenario: 'offline-original-preservation',
    quote_source_text_exact: quoteCandidate?.source_text === quoteLine,
    quote_evidence_has_context: quoteCandidate?.evidence_text.includes('Short context line after the quote') ?? false,
    quote_original_exact: quoteClaim?.original_text === quoteLine,
    prose_source_text_exact: proseCandidate?.source_text === prose,
    prose_original_exact: proseClaim?.original_text === prose,
    source_spacing_preserved:
      !!proseClaim?.original_text.includes('spacing\tand multiple   spaces') &&
      !!quoteClaim?.original_text.includes('multiple   spaces\tand'),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!quoteCandidate || !proseCandidate || !quoteClaim || !proseClaim) {
    console.error('[fail] expected quote and prose candidates plus wiki claims');
    process.exit(1);
  }
  if (!report.quote_source_text_exact || !report.quote_original_exact) {
    console.error('[fail] quotation original_text should use exact source line, not context excerpt');
    process.exit(1);
  }
  if (!report.prose_source_text_exact || !report.prose_original_exact || !report.source_spacing_preserved) {
    console.error('[fail] prose original_text should preserve exact source spacing and tabs');
    process.exit(1);
  }
  console.log('[ok] offline wiki original_text uses exact source_text rather than display evidence excerpts');
}

async function runOfflineWikiEvidenceChunkBinding() {
  const { extractCandidates } = await loadExtractor();
  const { chunkSource } = await import('../src/lib/chunk/chunker.ts');
  const { buildEntriesFromCandidates } = await import('../src/lib/wiki/wikiBuilder.ts');
  const text =
    'The author argues that covenant theology should preserve source spacing because exact wording can matter when a user checks the original evidence.';
  const bundle = await extractCandidates({
    source_id: 'offline-chunk-bind',
    filename: 'offline-chunk-bind.txt',
    buffer: new TextEncoder().encode(text),
  });
  const chunks = await chunkSource({
    source_id: bundle.source_id,
    kind: bundle.source_kind,
    normalized_text: bundle.normalized_text,
  });
  const candidate = bundle.candidate_items.find((item) => item.type === 'argument');
  const entries = buildEntriesFromCandidates({
    source_id: bundle.source_id,
    candidates: candidate ? [candidate] : [],
    mappings: candidate
      ? [
          {
            local_candidate_id: candidate.local_candidate_id,
            outline_node_id: null,
            recommended_action: candidate.suggested_action,
            rationale: '',
          },
        ]
      : [],
    outlineTitleById: {},
    chunks,
  });
  const refs = entries[0]?.claims[0]?.evidence_refs ?? [];
  const report = {
    scenario: 'offline-wiki-evidence-chunk-binding',
    found_candidate: !!candidate,
    chunk_count: chunks.length,
    refs,
    first_ref_has_real_chunk_id:
      chunks.length > 0 && typeof refs[0] === 'string' && refs[0].includes(chunks[0].chunk_id),
    first_ref_has_line_locator: typeof refs[0] === 'string' && /#line\d+$/.test(refs[0]),
    keeps_legacy_line_ref: refs.some((ref) => ref.includes('#line-1')),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.found_candidate) {
    console.error('[fail] expected an offline argument candidate');
    process.exit(1);
  }
  if (!report.first_ref_has_real_chunk_id || !report.first_ref_has_line_locator) {
    console.error('[fail] offline wiki claim evidence should start with a real chunk_id locator');
    process.exit(1);
  }
  if (!report.keeps_legacy_line_ref) {
    console.error('[fail] offline wiki claim should preserve the original line/md-block evidence ref as auxiliary provenance');
    process.exit(1);
  }
  console.log('[ok] offline wiki claims bind to real chunk_id evidence while preserving auxiliary refs');
}

async function runShortExplicitProseCandidates() {
  const { extractCandidates } = await loadExtractor();
  const text = [
    'The author argues that grace precedes merit.',
    'This method compares two manuscripts.',
  ].join('\n');
  const bundle = await extractCandidates({
    source_id: 'short-explicit',
    filename: 'short-explicit.txt',
    buffer: new TextEncoder().encode(text),
  });
  const report = {
    scenario: 'short-explicit-prose-candidates',
    item_count: bundle.candidate_items.length,
    types: bundle.candidate_items.map((item) => item.type),
    summaries: bundle.candidate_items.map((item) => item.summary),
    has_short_argument: bundle.candidate_items.some(
      (item) => item.type === 'argument' && item.summary.includes('grace precedes merit'),
    ),
    has_short_method: bundle.candidate_items.some(
      (item) => item.type === 'method' && item.summary.includes('compares two manuscripts'),
    ),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.has_short_argument) {
    console.error('[fail] short explicit argument should survive offline extraction');
    process.exit(1);
  }
  if (!report.has_short_method) {
    console.error('[fail] short explicit method should survive offline extraction');
    process.exit(1);
  }
  console.log('[ok] short explicit argument/method prose survives offline extraction');
}

async function runOriginalTermsBoundaryCandidates() {
  const { extractCandidates } = await loadExtractor();
  const text = [
    'Greek lexical contact with ἀκάνθας and ῥάμνος can identify comparison points, but it cannot establish evangelist intention by itself; stronger claims require textual criticism and independent interpretive evidence.',
    'This method uses inverted allusion, sensus plenior, and leitwort controls rather than loose typology; it is well-known in some NASA reports that a mother-in-law example is not a technical source term.',
  ].join('\n');
  const bundle = await extractCandidates({
    source_id: 'original-terms-boundary',
    filename: 'original-terms-boundary.txt',
    buffer: new TextEncoder().encode(text),
  });
  const terms = Array.from(new Set(bundle.candidate_items.flatMap((item) => item.original_terms ?? [])));
  const types = bundle.candidate_items.map((item) => item.type);
  const report = {
    scenario: 'original-terms-boundary-candidates',
    item_count: bundle.candidate_items.length,
    types,
    terms,
    has_method: types.includes('method'),
    has_greek_terms: terms.includes('ἀκάνθας') && terms.includes('ῥάμνος'),
    has_method_terms: terms.some((term) => /inverted allusion|leitwort|textual criticism/i.test(term)),
    has_latin_term: terms.includes('sensus plenior'),
    noisy_terms_filtered: !terms.some((term) => /well-known|mother-in-law|NASA/.test(term)),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.has_method) {
    console.error('[fail] boundary/method prose should emit a method candidate');
    process.exit(1);
  }
  if (!report.has_greek_terms) {
    console.error('[fail] Greek source terms should survive extraction');
    process.exit(1);
  }
  if (!report.has_method_terms) {
    console.error('[fail] promoted-style method terms should survive extraction');
    process.exit(1);
  }
  if (!report.has_latin_term) {
    console.error('[fail] Latin technical term should survive extraction');
    process.exit(1);
  }
  if (!report.noisy_terms_filtered) {
    console.error('[fail] noisy abbreviation/common hyphen terms should not be promoted as original terms');
    process.exit(1);
  }
  console.log('[ok] original/core terms and boundary-method prose survive offline extraction');
}

async function runOfflineCandidateDedup() {
  const { extractCandidates } = await loadExtractor();
  const repeated =
    'The author argues that Israelite identity should be interpreted through overlapping cultural continuities because the material record does not support a simple ethnic separation.';
  const bundle = await extractCandidates({
    source_id: 'offline-dedup',
    filename: 'offline-dedup.txt',
    buffer: new TextEncoder().encode([repeated, repeated].join('\n')),
  });
  const argumentsOnly = bundle.candidate_items.filter((item) => item.type === 'argument');
  const report = {
    scenario: 'offline-candidate-dedup',
    item_count: bundle.candidate_items.length,
    argument_count: argumentsOnly.length,
    merged_evidence_refs: argumentsOnly[0]?.evidence_refs ?? [],
    merged_ref_count: argumentsOnly[0]?.evidence_refs.length ?? 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (argumentsOnly.length !== 1) {
    console.error(`[fail] repeated identical prose should collapse to 1 argument candidate, got ${argumentsOnly.length}`);
    process.exit(1);
  }
  if (report.merged_ref_count !== 2) {
    console.error(`[fail] collapsed candidate should retain both evidence refs, got ${report.merged_ref_count}`);
    process.exit(1);
  }
  console.log('[ok] offline extractor collapses duplicate candidates while retaining refs');
}

const scenario = process.argv[2];
if (scenario === 'determinism') await runDeterminism();
else if (scenario === 'fixture-extraction') await runFixtureExtraction();
else if (scenario === 'schema-validate') await runSchemaValidate();
else if (scenario === 'upload-magic-bytes') await runUploadMagicBytes();
else if (scenario === 'wiki-display-shape') await runWikiDisplayShape();
else if (scenario === 'pdf-text-quality') await runPdfTextQuality();
else if (scenario === 'ocr-quality-gate') await runOcrQualityGate();
else if (scenario === 'offline-prose-candidates') await runOfflineProseCandidates();
else if (scenario === 'offline-original-preservation') await runOfflineOriginalPreservation();
else if (scenario === 'offline-wiki-evidence-chunk-binding') await runOfflineWikiEvidenceChunkBinding();
else if (scenario === 'short-explicit-prose-candidates') await runShortExplicitProseCandidates();
else if (scenario === 'markdown-bold-definition-candidates') await runMarkdownBoldDefinitionCandidate();
else if (scenario === 'markdown-heading-evidence-range') await runMarkdownHeadingEvidenceRange();
else if (scenario === 'line-broken-prose-candidates') await runLineBrokenProseCandidates();
else if (scenario === 'original-terms-boundary-candidates') await runOriginalTermsBoundaryCandidates();
else if (scenario === 'offline-candidate-dedup') await runOfflineCandidateDedup();
else {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error('usage: node --import tsx fixtures/t1-extract-and-validate.mjs <determinism|fixture-extraction|schema-validate|upload-magic-bytes|wiki-display-shape|pdf-text-quality|ocr-quality-gate|offline-prose-candidates|offline-original-preservation|offline-wiki-evidence-chunk-binding|short-explicit-prose-candidates|markdown-bold-definition-candidates|markdown-heading-evidence-range|line-broken-prose-candidates|original-terms-boundary-candidates|offline-candidate-dedup>');
  process.exit(1);
}
