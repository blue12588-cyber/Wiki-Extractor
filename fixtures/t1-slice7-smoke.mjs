#!/usr/bin/env node
/**
 * Tier-1/2 smoke for Slice 7 — sidebar independent of the main scroll + full-width
 * tab rows. Deterministic, OFFLINE: these are STATIC markup/CSS scans of
 * +layout.svelte (no browser, no render). The runtime "tabs stay on screen while
 * the article scrolls" behaviour is a property of the asserted CSS contract
 * (fixed-viewport flex shell + a sidebar that is NOT in the content scroll
 * surface); the visual confirmation is the Tauri build + manual review.
 *
 * Authority: agreed_contract.json (Slice 7) #AC-SIDEBAR-INDEPENDENT +
 *            AC-TAB-FULLWIDTH + AC-LAYOUT-NO-HSCROLL + AC-KOREAN-UI + AC-REGRESS.
 *
 * TIER-1 (smoke — fast, structural; run first):
 *   sidebar-independent  the shell is a fixed-viewport flex row (display:flex,
 *                        height:100vh); the sidebar is a fixed 220px track that
 *                        fills 100vh and scrolls only internally (overflow-y:auto);
 *                        the .content column is the single scroll surface
 *                        (height:100vh + overflow-y:auto). The Slice-6 sticky
 *                        approach (position:sticky) is gone. body overflow:hidden
 *                        so no body scroll can drag the sidebar away.
 *   tab-fullwidth        each .tab is a full-width row (display:block, width:100%)
 *                        with NO carved box (border:none, border-radius:0); the
 *                        active row is marked by a left oxblood rail + a surface
 *                        contrast (color-blind: rail = shape cue, glyph still
 *                        fills on active). The tab-list runs edge-to-edge.
 *
 * TIER-2 (fuller invariants):
 *   layout-no-hscroll    no horizontal scroll is introduced: shell + content both
 *                        hide overflow-x; the reading column keeps a max-width and
 *                        is centered (margin-inline:auto) so the centered aesthetic
 *                        survives the full-width scroll column.
 *   korean-and-tabs-intact  the sidebar still renders all five Korean tabs from
 *                        TABS via the dispatch button (onclick select), with
 *                        aria-current + the shape glyph — i.e. the layout change
 *                        did not disturb tab dispatch or Korean copy (AC-REGRESS,
 *                        AC-KOREAN-UI). No tab added/removed.
 *
 * Usage: node --import tsx fixtures/t1-slice7-smoke.mjs <scenario>
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
function read(p) {
  return readFileSync(resolve(ROOT, p), 'utf8');
}
const hasKorean = (s) => /[가-힣]/.test(s ?? '');

/** Slice a CSS rule block from `selector` to its closing `\n  }`. */
function ruleBlock(src, selector, span = 900) {
  const i = src.indexOf(selector);
  if (i < 0) return '';
  const close = src.indexOf('\n  }', i);
  return src.slice(i, close > i ? close : i + span);
}

/* ------------------------------- TIER 1 ------------------------------- */

// AC-SIDEBAR-INDEPENDENT: fixed-viewport flex shell; sidebar fills 100vh and is
// NOT in the content scroll surface; content column is the only scroller; the
// superseded position:sticky is gone; body cannot scroll.
async function sidebarIndependent() {
  const layout = read('src/routes/+layout.svelte');
  const shell = ruleBlock(layout, '.app-shell {', 500);
  const sidebar = ruleBlock(layout, '.sidebar {');
  const content = ruleBlock(layout, '.content {');
  const bodyRule = ruleBlock(layout, ':global(html, body) {', 500);

  const report = {
    scenario: 'sidebar-independent',
    shell_flex: /display:\s*flex/.test(shell),
    shell_viewport_height: /height:\s*100vh/.test(shell),
    sidebar_fixed_track: /flex:\s*0 0 220px/.test(sidebar),
    sidebar_full_height: /height:\s*100vh/.test(sidebar),
    sidebar_internal_scroll: /overflow-y:\s*auto/.test(sidebar),
    sidebar_no_sticky: !/position:\s*sticky/.test(sidebar),
    content_full_height: /height:\s*100vh/.test(content),
    content_is_scroll_surface: /overflow-y:\s*auto/.test(content),
    body_no_scroll: /overflow:\s*hidden/.test(bodyRule),
  };
  if (!report.shell_flex) return fail(report, 'app-shell is not display:flex (no independent-scroll row)');
  if (!report.shell_viewport_height) return fail(report, 'app-shell is not height:100vh (shell would grow with content)');
  if (!report.sidebar_fixed_track) return fail(report, 'sidebar is not a fixed 220px flex track');
  if (!report.sidebar_full_height) return fail(report, 'sidebar does not fill 100vh');
  if (!report.sidebar_internal_scroll) return fail(report, 'sidebar lacks internal overflow-y (tall menu could clip)');
  if (!report.sidebar_no_sticky) return fail(report, 'sidebar still uses the superseded position:sticky');
  if (!report.content_full_height) return fail(report, 'content column is not height:100vh');
  if (!report.content_is_scroll_surface) return fail(report, 'content column is not the scroll surface (overflow-y:auto)');
  if (!report.body_no_scroll) return fail(report, 'body is not overflow:hidden (a body scroll could drag the sidebar away)');
  pass(report);
}

// AC-TAB-FULLWIDTH: each tab is a full-width row, no carved box; active = left
// oxblood rail + surface contrast (color-blind: rail is a shape change, glyph
// still fills on active).
async function tabFullwidth() {
  const layout = read('src/routes/+layout.svelte');
  const tab = ruleBlock(layout, '.tab {');
  const tabActive = ruleBlock(layout, '.tab.active {', 400);
  const tabList = ruleBlock(layout, '.tab-list {', 500);
  const tabShapeActive = ruleBlock(layout, '.tab.active .tab-shape :global(svg) {', 300);

  const report = {
    scenario: 'tab-fullwidth',
    tab_block: /display:\s*block/.test(tab),
    tab_full_width: /width:\s*100%/.test(tab),
    tab_no_box_border: /border:\s*none/.test(tab),
    tab_no_radius: /border-radius:\s*0/.test(tab),
    tab_has_left_rail_slot: /border-left:\s*3px solid transparent/.test(tab),
    active_left_oxblood_rail: /border-left-color:\s*var\(--accent-oxblood\)/.test(tabActive),
    active_bg_contrast: /background:\s*var\(--surface-elevated\)/.test(tabActive),
    list_runs_edge_to_edge: /margin-inline:\s*calc\(-1 \* var\(--space-md\)\)/.test(tabList),
    glyph_fills_on_active: /fill:\s*currentColor/.test(tabShapeActive),
  };
  if (!report.tab_block) return fail(report, 'tab is not display:block (full-width row)');
  if (!report.tab_full_width) return fail(report, 'tab is not width:100%');
  if (!report.tab_no_box_border) return fail(report, 'tab still has a box border (carved card not removed)');
  if (!report.tab_no_radius) return fail(report, 'tab still has a border-radius (card look not removed)');
  if (!report.tab_has_left_rail_slot) return fail(report, 'tab lacks the reserved 3px left-rail slot');
  if (!report.active_left_oxblood_rail) return fail(report, 'active tab lacks the left oxblood rail');
  if (!report.active_bg_contrast) return fail(report, 'active tab lacks a background contrast cue');
  if (!report.list_runs_edge_to_edge) return fail(report, 'tab-list does not run edge-to-edge of the sidebar (끝까지 가는 한 줄)');
  if (!report.glyph_fills_on_active) return fail(report, 'active tab glyph does not fill (color-blind shape cue lost)');
  pass(report);
}

/* ------------------------------- TIER 2 ------------------------------- */

// AC-LAYOUT-NO-HSCROLL: shell + content hide overflow-x; the reading column keeps
// a max-width and is centered (margin-inline:auto).
async function layoutNoHscroll() {
  const layout = read('src/routes/+layout.svelte');
  const shell = ruleBlock(layout, '.app-shell {', 500);
  const content = ruleBlock(layout, '.content {');
  const inner = ruleBlock(layout, '.content-inner {', 400);
  const report = {
    scenario: 'layout-no-hscroll',
    shell_hides_x: /overflow-x:\s*hidden/.test(shell),
    content_hides_x: /overflow-x:\s*hidden/.test(content),
    content_min_width_0: /min-width:\s*0/.test(content),
    inner_max_width: /max-width:\s*860px/.test(inner),
    inner_centered: /margin-inline:\s*auto/.test(inner),
  };
  if (!report.shell_hides_x) return fail(report, 'app-shell does not hide horizontal overflow');
  if (!report.content_hides_x) return fail(report, 'content column does not hide horizontal overflow');
  if (!report.content_min_width_0) return fail(report, 'content lacks min-width:0 (flex child could overflow)');
  if (!report.inner_max_width) return fail(report, 'reading column lost its max-width');
  if (!report.inner_centered) return fail(report, 'reading column is not centered (중앙 정렬 미학 깨짐)');
  pass(report);
}

// AC-REGRESS + AC-KOREAN-UI: the sidebar still drives tab dispatch and Korean copy
// — the layout change touched only CSS/markup-shell, not the 5-tab dispatch.
async function koreanAndTabsIntact() {
  const layout = read('src/routes/+layout.svelte');
  const { TABS } = await import('../src/lib/nav/tabs.ts');
  const report = {
    scenario: 'korean-and-tabs-intact',
    iterates_tabs: layout.includes('{#each TABS as tab'),
    dispatch_onclick: /onclick=\{\(\) => select\(tab\.id\)\}/.test(layout),
    select_sets_store: /function select\(id: TabId\)\s*\{[\s\S]*?activeTab\.set\(id\)/.test(layout),
    aria_current: /aria-current=\{current === tab\.id \? 'page' : undefined\}/.test(layout),
    shape_glyph_kept: layout.includes('class="tab-shape"'),
    five_tabs_korean: TABS.length === 5 && TABS.every((t) => hasKorean(t.label)),
    labels_unchanged: JSON.stringify(TABS.map((t) => t.label)) === JSON.stringify(['메인', '위키', '로그인', '사용법', '피드백']),
  };
  if (!report.iterates_tabs) return fail(report, 'layout no longer iterates TABS (sidebar dispatch source changed)');
  if (!report.dispatch_onclick) return fail(report, 'tab onclick dispatch (select(tab.id)) was disturbed');
  if (!report.select_sets_store) return fail(report, 'select() no longer sets the activeTab store (dispatch broken)');
  if (!report.aria_current) return fail(report, 'aria-current binding lost (accessibility regression)');
  if (!report.shape_glyph_kept) return fail(report, 'tab-shape glyph removed (color-blind cue regression)');
  if (!report.five_tabs_korean) return fail(report, 'tabs are not five Korean entries');
  if (!report.labels_unchanged) return fail(report, 'tab labels changed (Slice-7 must not touch the tab set)');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  // Tier 1
  'sidebar-independent': sidebarIndependent,
  'tab-fullwidth': tabFullwidth,
  // Tier 2
  'layout-no-hscroll': layoutNoHscroll,
  'korean-and-tabs-intact': koreanAndTabsIntact,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice7-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
