#!/usr/bin/env node
/**
 * T1-adaptation-log-structure-check
 *
 * Authority: agreed_contract.json#AC-8 + AC-T1-COVERAGE.
 *
 * Reads docs/adaptation-from-harness-core.md and asserts the simultaneous
 * presence of three structural cues:
 *
 *   1. Adapted source path enumeration under a heading whose text matches
 *      /adapted source paths|enumeration/i.
 *   2. At least one ### heading followed by prose containing a rationale
 *      verb (rename|generalize|drop|restructure|merge|split|port|adapt).
 *   3. A heading matching /schema diff/i followed by a fenced diff block
 *      OR a markdown table.
 *
 * Exit 0 iff all three cues are present. Exit 1 with stdout report on miss.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MD_PATH = resolve(__dirname, '..', 'docs', 'adaptation-from-harness-core.md');

function readDoc() {
  try {
    return readFileSync(MD_PATH, 'utf8');
  } catch (e) {
    console.error(`[fail] cannot read ${MD_PATH}: ${e.message}`);
    process.exit(1);
  }
}

function splitHeadings(md) {
  // Returns array of {level, title, body}.
  const lines = md.split(/\r?\n/);
  const headings = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (cur) headings.push(cur);
      cur = { level: m[1].length, title: m[2].trim(), body: [] };
    } else {
      if (cur) cur.body.push(ln);
    }
  }
  if (cur) headings.push(cur);
  return headings;
}

const ENUM_RE = /adapted source paths|enumeration/i;
const SCHEMA_DIFF_RE = /schema diff/i;
const RATIONALE_VERB_RE = /\b(rename|generalize|drop|restructure|merge|split|port|adapt)\b/i;
const PATH_RE = /(workflows|domains|tools|shared|schemas|src|src-tauri)\/[^\s)]+\.(md|js|ts|json|py|rs|svelte)/i;
const LIST_LINE_RE = /^\s*[-*]\s+/;
const DIFF_FENCE_RE = /```diff/i;
const TABLE_LINE_RE = /\|.+\|/;

function checkEnumeration(headings) {
  for (const h of headings) {
    if (ENUM_RE.test(h.title)) {
      let pathLines = 0;
      for (const ln of h.body) {
        if (LIST_LINE_RE.test(ln) && PATH_RE.test(ln)) pathLines++;
      }
      if (pathLines >= 1) {
        return { ok: true, where: `## ${h.title}`, pathCount: pathLines };
      }
    }
  }
  return { ok: false };
}

function checkPerFileRationale(headings) {
  // At least one ### heading whose body contains a rationale verb.
  for (const h of headings) {
    if (h.level === 3) {
      const body = h.body.join('\n');
      if (RATIONALE_VERB_RE.test(body)) {
        return { ok: true, where: `### ${h.title}` };
      }
    }
  }
  return { ok: false };
}

function checkSchemaDiff(headings) {
  for (const h of headings) {
    if (SCHEMA_DIFF_RE.test(h.title)) {
      const body = h.body.join('\n');
      const hasDiffFence = DIFF_FENCE_RE.test(body);
      const tableRows = body.split('\n').filter((l) => TABLE_LINE_RE.test(l));
      const hasTable = tableRows.length >= 3; // header + separator + ≥1 row
      if (hasDiffFence || hasTable) {
        return { ok: true, where: h.title, mode: hasDiffFence ? 'fenced_diff' : 'markdown_table' };
      }
    }
  }
  return { ok: false };
}

function main() {
  const md = readDoc();
  const headings = splitHeadings(md);
  const a = checkEnumeration(headings);
  const b = checkPerFileRationale(headings);
  const c = checkSchemaDiff(headings);
  const report = {
    enumeration: a,
    per_file_rationale: b,
    schema_diff: c,
  };
  console.log(JSON.stringify(report, null, 2));
  const allOk = a.ok && b.ok && c.ok;
  if (!allOk) {
    const missing = [];
    if (!a.ok) missing.push('enumeration');
    if (!b.ok) missing.push('per_file_rationale');
    if (!c.ok) missing.push('schema_diff');
    console.error(`[fail] missing cues: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('[ok] all three cues present');
  process.exit(0);
}

main();
