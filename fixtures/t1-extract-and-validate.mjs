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

const scenario = process.argv[2];
if (scenario === 'determinism') await runDeterminism();
else if (scenario === 'fixture-extraction') await runFixtureExtraction();
else if (scenario === 'schema-validate') await runSchemaValidate();
else if (scenario === 'upload-magic-bytes') await runUploadMagicBytes();
else if (scenario === 'wiki-display-shape') await runWikiDisplayShape();
else if (scenario === 'pdf-text-quality') await runPdfTextQuality();
else {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error('usage: node --import tsx fixtures/t1-extract-and-validate.mjs <determinism|fixture-extraction|schema-validate|upload-magic-bytes|wiki-display-shape|pdf-text-quality>');
  process.exit(1);
}
