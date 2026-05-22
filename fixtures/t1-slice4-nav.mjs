#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 4 navigation contract (deterministic, NO network).
 *
 * Authority: agreed_contract.json (Slice 4)#AC-NAV + AC-KOREAN-UI, EVOLVED by
 *            agreed_contract.json (Slice 6)#AC-USAGE-TAB (a fifth '사용법' tab is
 *            inserted between 로그인 and 피드백). The order/count assertions below
 *            track the live Slice-6 contract; the color-blind shape-cue + Korean
 *            invariants are unchanged regression guards.
 *
 * Scenarios:
 *   nav-tabs-contract  exactly five tabs, Korean labels, fixed order
 *                      (메인/위키/로그인/사용법/피드백), each with a distinct shape
 *                      cue (color-blind signal) and a unique id. isTabId guards.
 *   view-files-present each of the five view components + the page router exist
 *                      and the page wires every tab id.
 *
 * Usage: node --import tsx fixtures/t1-slice4-nav.mjs <scenario>
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

async function navTabsContract() {
  const { TABS, DEFAULT_TAB, isTabId } = await import('../src/lib/nav/tabs.ts');
  const ids = TABS.map((t) => t.id);
  const labels = TABS.map((t) => t.label);
  const shapes = TABS.map((t) => t.shape);
  const report = {
    scenario: 'nav-tabs-contract',
    count: TABS.length,
    ids,
    labels,
    shapes,
    default_tab: DEFAULT_TAB,
    order_ok: JSON.stringify(ids) === JSON.stringify(['main', 'wiki', 'login', 'usage', 'feedback']),
    labels_korean: JSON.stringify(labels) === JSON.stringify(['메인', '위키', '로그인', '사용법', '피드백']),
    usage_between_login_and_feedback: ids.indexOf('usage') === ids.indexOf('login') + 1 && ids.indexOf('feedback') === ids.indexOf('usage') + 1,
    shapes_distinct: new Set(shapes).size === shapes.length,
    ids_distinct: new Set(ids).size === ids.length,
    guard_ok: isTabId('main') === true && isTabId('usage') === true && isTabId('nope') === false,
  };
  if (report.count !== 5) return fail(report, `expected 5 tabs, got ${report.count}`);
  if (!report.order_ok) return fail(report, 'tab order is not main/wiki/login/usage/feedback');
  if (!report.usage_between_login_and_feedback) return fail(report, '사용법 tab is not between 로그인 and 피드백');
  if (!report.labels_korean) return fail(report, 'tab labels are not the agreed Korean set');
  if (!report.shapes_distinct) return fail(report, 'shape cues are not distinct (color-blind signal weakened)');
  if (!report.ids_distinct) return fail(report, 'duplicate tab id');
  if (DEFAULT_TAB !== 'main') return fail(report, 'default tab is not main');
  if (!report.guard_ok) return fail(report, 'isTabId guard misbehaves');
  pass(report);
}

function read(p) {
  return readFileSync(resolve(ROOT, p), 'utf8');
}

async function viewFilesPresent() {
  const views = {
    main: 'src/lib/components/views/MainTab.svelte',
    wiki: 'src/lib/components/views/WikiTab.svelte',
    login: 'src/lib/components/views/LoginTab.svelte',
    usage: 'src/lib/components/views/UsageTab.svelte',
    feedback: 'src/lib/components/views/FeedbackTab.svelte',
  };
  const present = {};
  for (const [k, p] of Object.entries(views)) {
    try {
      present[k] = read(p).length > 0;
    } catch {
      present[k] = false;
    }
  }
  const page = read('src/routes/+page.svelte');
  const layout = read('src/routes/+layout.svelte');
  const report = {
    scenario: 'view-files-present',
    views_present: present,
    page_wires_all:
      page.includes('MainTab') &&
      page.includes('WikiTab') &&
      page.includes('LoginTab') &&
      page.includes('UsageTab') &&
      page.includes('FeedbackTab'),
    layout_renders_sidebar: layout.includes('TABS') && layout.includes('aria-current'),
  };
  if (!Object.values(present).every(Boolean)) return fail(report, 'a view component file is missing/empty');
  if (!report.page_wires_all) return fail(report, '+page.svelte does not render all four views');
  if (!report.layout_renders_sidebar) return fail(report, 'layout does not render the tab sidebar with aria-current');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  'nav-tabs-contract': navTabsContract,
  'view-files-present': viewFilesPresent,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice4-nav.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
