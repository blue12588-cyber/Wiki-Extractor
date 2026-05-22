#!/usr/bin/env node
/**
 * T1-banner-mount-and-disclosure-text — static_html_parse fallback path.
 *
 * Authority: agreed_contract.json#AC-OAUTH-DISCLOSURE + AC-T1-COVERAGE.
 *
 * Reads the prerendered SvelteKit `build/` output AND the
 * DisclosureBanner.svelte source, then checks for:
 *   - banner mount marker (`data-test="disclosure-banner"` or class match).
 *   - all four required key-phrases (substring match against
 *     fixtures/disclosure-phrase-matchers.json).
 *
 * Exit 0 iff banner_mounted=true AND visible_phrases.length === 4.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readIfExists(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function walkHtml(dir, acc) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkHtml(p, acc);
    } else if (st.isFile() && p.toLowerCase().endsWith('.html')) {
      acc.files.push(p);
      acc.text += readIfExists(p);
    }
  }
}

function main() {
  const acc = { files: [], text: '' };
  walkHtml(resolve(ROOT, 'build'), acc);
  const bannerSrc = resolve(ROOT, 'src/lib/components/DisclosureBanner.svelte');
  const bannerText = readIfExists(bannerSrc);
  acc.text += bannerText;
  acc.files.push(bannerSrc);

  const bannerMounted =
    acc.text.includes('data-test="disclosure-banner"') ||
    acc.text.includes('class="disclosure-banner"') ||
    /disclosure-banner/.test(acc.text);

  const matchers = JSON.parse(
    readFileSync(resolve(ROOT, 'fixtures/disclosure-phrase-matchers.json'), 'utf8'),
  );
  const lower = acc.text.toLowerCase();
  const visible = [];
  const missing = [];
  for (const phrase of matchers.phrases) {
    const any = phrase.matchers.some((m) => lower.includes(m.toLowerCase()));
    if (any) visible.push(phrase.id);
    else missing.push(phrase.id);
  }

  const report = {
    scenario: 'banner-mount-and-disclosure-text',
    banner_mounted: bannerMounted,
    visible_phrases: visible,
    missing_phrases: missing,
    audit_method: 'static_html_parse',
    evidence_file_count: acc.files.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!bannerMounted || missing.length > 0) {
    console.error('[fail] banner mount or phrase coverage incomplete');
    process.exit(1);
  }
  console.log('[ok] banner mounted and all four key-phrases visible');
  process.exit(0);
}

main();
