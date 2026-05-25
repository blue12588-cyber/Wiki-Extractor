#!/usr/bin/env node
/**
 * T1-static-scan — AC-7-relaxed portable scan.
 *
 * Authority: agreed_contract.json#AC-7-relaxed.
 *
 * Scans non-test, non-vendor source under the target tree for the forbidden
 * OS-user-directory pattern. The single exemption is the narrow auth/tool
 * discovery boundary: `src-tauri/src/external_dep_paths.rs`.
 * Vendor subtree `node_modules/openai-oauth/**` is also exempted.
 *
 * Excluded paths: node_modules, target, build, .svelte-kit, .git, src-tauri/target.
 *
 * Exit 0 iff zero violations.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'target',
  'build',
  '.svelte-kit',
  '.git',
  '.tauri',
  'dist',
]);
const EXCLUDE_PATH_SUBSTR = [
  'src-tauri\\target',
  'src-tauri/target',
];

const EXEMPT_RELS = new Set([
  'src-tauri\\src\\external_dep_paths.rs',
  'src-tauri/src/external_dep_paths.rs',
]);

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.svelte', '.rs', '.json', '.toml']);

// Pattern from src-tauri/src/external_dep_paths.rs::forbidden_pattern_sentinel().
const PATTERN_RE = /\b(app_data_dir|APPDATA|appData|app_local_data_dir|app_config_dir|home_dir|HOMEPATH|USERPROFILE|LOCALAPPDATA)\b/;

function walk(dir, out) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p, out);
    } else if (st.isFile()) {
      const rel = relative(ROOT, p);
      if (EXCLUDE_PATH_SUBSTR.some((s) => rel.includes(s))) continue;
      const ext = '.' + name.split('.').pop();
      if (!TEXT_EXT.has(ext.toLowerCase())) continue;
      out.push({ abs: p, rel });
    }
  }
}

function main() {
  const files = [];
  walk(ROOT, files);
  const hits = [];
  for (const f of files) {
    // Skip exemption file.
    if (EXEMPT_RELS.has(f.rel)) continue;
    // Skip the catalog of phrase matchers (it intentionally lists phrases not pattern tokens).
    // Skip the static-scan script itself (this file).
    if (f.rel.endsWith('t1-static-scan.mjs')) continue;
    // Skip the adaptation-log structure check script (no pattern usage).
    let text = '';
    try {
      text = readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // Strip recognized comment prefixes before pattern testing. Comments
      // that REFERENCE the AC-7-relaxed pattern in documentation form (e.g.
      // "We do NOT call app_data_dir here") are not violations — they
      // document the boundary. Only code uses count.
      const trimmed = ln.trim();
      const isComment =
        trimmed.startsWith('//') ||
        trimmed.startsWith('//!') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('<!--');
      if (isComment) continue;
      if (PATTERN_RE.test(ln)) {
        hits.push({ rel: f.rel, line: i + 1, content: ln.trim().slice(0, 200) });
      }
    }
  }
  const report = {
    scenario: 'static-scan',
    files_scanned: files.length,
    exempt_files: Array.from(EXEMPT_RELS),
    violations: hits,
  };
  console.log(JSON.stringify(report, null, 2));
  if (hits.length > 0) {
    console.error(`[fail] ${hits.length} AC-7-relaxed violations found`);
    process.exit(1);
  }
  console.log('[ok] zero AC-7-relaxed violations outside the named exemption');
  process.exit(0);
}

main();
