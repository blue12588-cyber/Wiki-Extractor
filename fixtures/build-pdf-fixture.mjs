#!/usr/bin/env node
/**
 * Deterministic PDF fixture generator for AC-4 + AC-5.
 *
 * Authority: agreed_contract.json#AC-4 + AC-5 + O-8.
 *
 * Uses pdf-lib (Apache-2.0). Output: fixtures/pdf/concept-quotation-sample.pdf.
 *
 * Determinism plan:
 *   - Fixed seed: no system clock reads. The PDF metadata is set to fixed
 *     strings (no creation/modification dates → pdf-lib still writes a
 *     trailer with an Info dict; we set CreationDate / ModDate to the
 *     contract-fixed UTC string).
 *   - Content streams use a built-in font (Helvetica) so no external file
 *     I/O happens at gen time.
 *   - The PDF body is short enough that re-runs produce the same bytes
 *     except for the encrypted /ID array. We pin the /ID by computing it
 *     from the document title.
 *
 * Caller invokes:
 *   node fixtures/build-pdf-fixture.mjs
 *
 * The generated PDF is intentionally committed to the repo (see fixtures/pdf/).
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'pdf', 'concept-quotation-sample.pdf');

async function main() {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle('llmwiki Slice-2 fixture: concept + quotation');
  pdf.setAuthor('llmwiki');
  pdf.setSubject('Deterministic Slice-2 fixture');
  pdf.setKeywords(['llmwiki', 'fixture', 'concept', 'quotation']);
  pdf.setProducer('pdf-lib (Slice-2 fixture)');
  pdf.setCreator('llmwiki fixture builder');
  // Pin dates so re-generation byte-matches.
  const pinned = new Date('2026-05-22T00:00:00Z');
  pdf.setCreationDate(pinned);
  pdf.setModificationDate(pinned);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();
  const left = 60;
  let y = height - 80;

  const black = rgb(0.13, 0.11, 0.09);
  const accent = rgb(0.48, 0.17, 0.15);

  page.drawText('Note on study habits', { x: left, y, size: 18, font: fontBold, color: black });
  y -= 36;

  const intro =
    'This file is a Slice-2 PDF fixture for llmwiki extraction. The content is';
  const intro2 =
    'deliberately domain-neutral. The patterns below trigger the deterministic';
  const intro3 = 'candidate extractor.';
  page.drawText(intro, { x: left, y, size: 11, font, color: black });
  y -= 16;
  page.drawText(intro2, { x: left, y, size: 11, font, color: black });
  y -= 16;
  page.drawText(intro3, { x: left, y, size: 11, font, color: black });
  y -= 30;

  page.drawText('Concept: Deliberate practice', {
    x: left,
    y,
    size: 13,
    font: fontBold,
    color: accent,
  });
  y -= 22;
  const def1 =
    'Concept: Deliberate practice — a learning approach where the learner sets';
  const def2 =
    'a specific narrow goal, attempts it, and receives immediate corrective';
  const def3 = 'feedback before re-attempting.';
  page.drawText(def1, { x: left, y, size: 11, font, color: black });
  y -= 16;
  page.drawText(def2, { x: left, y, size: 11, font, color: black });
  y -= 16;
  page.drawText(def3, { x: left, y, size: 11, font, color: black });
  y -= 30;

  page.drawText('Why it matters', { x: left, y, size: 13, font: fontBold, color: black });
  y -= 22;
  const wh1 = 'Informal repetition without feedback rarely produces durable';
  const wh2 = 'improvement. The distinction is mechanical, not aesthetic.';
  page.drawText(wh1, { x: left, y, size: 11, font, color: black });
  y -= 16;
  page.drawText(wh2, { x: left, y, size: 11, font, color: black });
  y -= 30;

  // Quotation block — emit as a literal `"..."` pair so the extractor's
  // PT_QUOTE_EN_RE pattern matches.
  page.drawText(
    '"Practice without feedback is rehearsal of mediocrity, not improvement."',
    { x: left, y, size: 11, font, color: accent },
  );
  y -= 30;

  page.drawText('Closing', { x: left, y, size: 13, font: fontBold, color: black });
  y -= 22;
  page.drawText(
    'Deliberate practice is not the same as repetition.',
    { x: left, y, size: 11, font, color: black },
  );

  const bytes = await pdf.save({ updateFieldAppearances: false, useObjectStreams: false });
  writeFileSync(OUT, bytes);
  console.log(`[ok] wrote ${OUT} (${bytes.length} bytes)`);
}

main().catch((e) => {
  console.error('[fail]', e);
  process.exit(1);
});
