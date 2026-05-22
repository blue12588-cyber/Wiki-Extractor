#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 6 ACs — codex login button + sticky sidebar + usage tab.
 * Deterministic, OFFLINE (no real `codex login` spawn, no network): the login
 * outcome shapes are exercised against the FRONTEND degradation path (Tauri shell
 * absent → graceful), and the sidebar/usage assertions are STATIC markup scans.
 * The real `codex login` OAuth success is environment-dependent and NOT asserted
 * here (contract: 작동 미보장; 미가용 = graceful 복붙).
 *
 * Authority: agreed_contract.json (Slice 6)#AC-CODEX-LOGIN-BTN +
 *            AC-LOGIN-STATE-REFRESH + AC-STICKY-SIDEBAR + AC-USAGE-TAB +
 *            AC-KOREAN-UI + AC-REGRESS.
 *
 * TIER-1 (smoke — fast, structural; run first):
 *   tab-order-usage     5 tabs, 사용법 inserted between 로그인 and 피드백, Korean
 *                       labels, distinct shape cues, isTabId('usage') guards.
 *   sticky-sidebar-css  +layout.svelte sidebar is position:sticky top:0 with a
 *                       bounded height + align-self:start; app-shell hides
 *                       horizontal overflow (AC-STICKY-SIDEBAR markup contract).
 *   login-spawn-graceful  startCodexLogin() OUTSIDE the Tauri shell returns a
 *                       non-throwing graceful outcome with a Korean message
 *                       (the common preview/degrade path).
 *
 * TIER-2 (fuller content/structure assertions):
 *   usage-content       UsageTab covers the four steps (원서→후보→복붙/자동→검토),
 *                       both ③ branches (복붙 기본 / 자동 로그인), 일반인 친화 한글.
 *   login-no-authwrite  the app never writes the codex auth file: the Rust
 *                       codex_login module + the frontend login path contain NO
 *                       auth-file write tokens (spawn-only contract).
 *   login-button-wired  ModeToggle renders the [ChatGPT로 로그인] button bound to
 *                       the modeStore loginWithChatGPT action; the store applies
 *                       a returned detect snapshot (AC-LOGIN-STATE-REFRESH).
 *
 * Usage: node --import tsx fixtures/t1-slice6-smoke.mjs <scenario>
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

/* ------------------------------- TIER 1 ------------------------------- */

// AC-USAGE-TAB (order) + AC-KOREAN-UI: 사용법 between 로그인 and 피드백.
async function tabOrderUsage() {
  const { TABS, isTabId } = await import('../src/lib/nav/tabs.ts');
  const ids = TABS.map((t) => t.id);
  const labels = TABS.map((t) => t.label);
  const shapes = TABS.map((t) => t.shape);
  const usageDef = TABS.find((t) => t.id === 'usage');
  const report = {
    scenario: 'tab-order-usage',
    count: TABS.length,
    ids,
    labels,
    order_ok: JSON.stringify(ids) === JSON.stringify(['main', 'wiki', 'login', 'usage', 'feedback']),
    labels_korean: JSON.stringify(labels) === JSON.stringify(['메인', '위키', '로그인', '사용법', '피드백']),
    usage_between: ids.indexOf('usage') === ids.indexOf('login') + 1 && ids.indexOf('feedback') === ids.indexOf('usage') + 1,
    shapes_distinct: new Set(shapes).size === shapes.length,
    usage_guarded: isTabId('usage') === true,
    usage_label_hint_korean: usageDef && hasKorean(usageDef.label) && hasKorean(usageDef.hint),
  };
  if (report.count !== 5) return fail(report, `expected 5 tabs, got ${report.count}`);
  if (!report.order_ok) return fail(report, 'tab order is not main/wiki/login/usage/feedback');
  if (!report.labels_korean) return fail(report, 'tab labels are not the agreed Korean 5-set');
  if (!report.usage_between) return fail(report, '사용법 tab is not between 로그인 and 피드백');
  if (!report.shapes_distinct) return fail(report, 'shape cues not distinct (color-blind signal weakened)');
  if (!report.usage_guarded) return fail(report, "isTabId('usage') does not guard the new tab");
  if (!report.usage_label_hint_korean) return fail(report, 'usage tab label/hint not Korean');
  pass(report);
}

// AC-STICKY-SIDEBAR: the sidebar is sticky-pinned + the shell hides x-overflow.
async function stickySidebarCss() {
  const layout = read('src/routes/+layout.svelte');
  // Isolate the .sidebar style block to assert sticky props apply to IT.
  const sidebarBlock = (() => {
    const i = layout.indexOf('.sidebar {');
    if (i < 0) return '';
    // Slice up to the closing brace of the .sidebar rule (the block carries an
    // explanatory comment, so a fixed char window can truncate the declarations).
    const close = layout.indexOf('\n  }', i);
    return layout.slice(i, close > i ? close : i + 1200);
  })();
  const shellBlock = (() => {
    const i = layout.indexOf('.app-shell {');
    if (i < 0) return '';
    return layout.slice(i, i + 400);
  })();
  const report = {
    scenario: 'sticky-sidebar-css',
    sidebar_position_sticky: /position:\s*sticky/.test(sidebarBlock),
    sidebar_top_zero: /top:\s*0/.test(sidebarBlock),
    sidebar_align_start: /align-self:\s*start/.test(sidebarBlock),
    sidebar_bounded_height: /max-height:\s*100vh/.test(sidebarBlock),
    sidebar_overflow_y: /overflow-y:\s*auto/.test(sidebarBlock),
    shell_no_x_overflow: /overflow-x:\s*hidden/.test(shellBlock),
    book_glyph_present: layout.includes("tab.shape === 'book'"),
  };
  if (!report.sidebar_position_sticky) return fail(report, 'sidebar is not position:sticky');
  if (!report.sidebar_top_zero) return fail(report, 'sidebar has no top:0 anchor');
  if (!report.sidebar_align_start) return fail(report, 'sidebar lacks align-self:start (sticky defeated by row-stretch)');
  if (!report.sidebar_bounded_height) return fail(report, 'sidebar lacks max-height:100vh (tall menu could clip)');
  if (!report.sidebar_overflow_y) return fail(report, 'sidebar lacks internal overflow-y for short viewports');
  if (!report.shell_no_x_overflow) return fail(report, 'app-shell does not guard horizontal scroll (가로 스크롤 0)');
  if (!report.book_glyph_present) return fail(report, 'usage tab book shape glyph not rendered');
  pass(report);
}

// AC-CODEX-LOGIN-BTN + AC-GRACEFUL: outside Tauri the login spawn degrades
// gracefully (Korean message, no throw, no auth write).
async function loginSpawnGraceful() {
  const { startCodexLogin } = await import('../src/lib/llm/provider.ts');
  let threw = false;
  let outcome;
  try {
    // No window/__TAURI__ in node → resolveInvoke()===null → graceful failed.
    outcome = await startCodexLogin(false);
  } catch (e) {
    threw = true;
    outcome = { error: String(e) };
  }
  const report = {
    scenario: 'login-spawn-graceful',
    no_throw: !threw,
    failed_state: outcome && outcome.state === 'failed',
    message_korean: outcome && hasKorean(outcome.message),
    message_points_to_paste: outcome && /복붙/.test(outcome.message ?? ''),
  };
  if (!report.no_throw) return fail(report, 'login spawn threw (app must keep running)');
  if (!report.failed_state) return fail(report, 'outside-Tauri login did not produce a graceful failed outcome');
  if (!report.message_korean) return fail(report, 'login degradation message not Korean');
  if (!report.message_points_to_paste) return fail(report, 'login degradation does not reassure copy-paste still works');
  pass(report);
}

/* ------------------------------- TIER 2 ------------------------------- */

// AC-USAGE-TAB content: four steps + both ③ branches + 일반인 친화 한글.
async function usageContent() {
  const usage = read('src/lib/components/views/UsageTab.svelte');
  const report = {
    scenario: 'usage-content',
    korean: hasKorean(usage),
    step_source: usage.includes('원서'),
    step_candidates: usage.includes('후보'),
    step_review_save: usage.includes('검토') && (usage.includes('저장') || usage.includes('승인')),
    branch_paste: usage.includes('복사') && usage.includes('붙여넣') && usage.includes('chatgpt.com'),
    branch_auto: usage.includes('ChatGPT로 로그인') && usage.includes('자동'),
    paste_is_default: usage.includes('기본') && usage.includes('누구나'),
    auto_is_optional: usage.includes('선택') && /로그인하지 않아도/.test(usage),
    file_kinds: usage.includes('PDF') && (usage.includes('텍스트') || usage.includes('.txt')) && usage.includes('마크다운'),
    // 비전문가 친화: no internal jargon leaking into the copy.
    no_jargon: !/(oauth|tauri|invoke|chunk_id|openai-oauth|svelte)/i.test(usage.replace(/<!--[\s\S]*?-->/g, '')),
  };
  if (!report.korean) return fail(report, 'usage tab is not Korean');
  if (!report.step_source) return fail(report, 'missing step ① 원서 넣기');
  if (!report.step_candidates) return fail(report, 'missing step ② 후보 추출');
  if (!report.step_review_save) return fail(report, 'missing step ④ 검토·저장');
  if (!report.branch_paste) return fail(report, 'missing ③ 복붙 방식 (복사/붙여넣기/chatgpt.com)');
  if (!report.branch_auto) return fail(report, 'missing ③ 자동 방식 (ChatGPT 로그인)');
  if (!report.paste_is_default) return fail(report, '복붙 방식이 기본·누구나로 안내되지 않음');
  if (!report.auto_is_optional) return fail(report, '자동 방식이 선택(강요 0)으로 안내되지 않음');
  if (!report.file_kinds) return fail(report, '지원 파일 종류(PDF/텍스트/마크다운) 안내 누락');
  if (!report.no_jargon) return fail(report, '사용법에 비전문가가 모를 내부 용어가 노출됨');
  pass(report);
}

// AC-CODEX-LOGIN-BTN (no app auth write): the app spawns codex login only; it
// NEVER opens/writes/parses the auth file. Static token scan of the login path.
async function loginNoAuthWrite() {
  const rust = read('src-tauri/src/codex_login.rs');
  const provider = read('src/lib/llm/provider.ts');
  const store = read('src/lib/llm/modeStore.svelte.ts');

  // Strip Rust comments/doc so the boundary DESCRIPTION (which mentions auth.json)
  // is not counted as a violation — only CODE counts.
  const rustCode = rust
    .split(/\r?\n/)
    .filter((ln) => {
      const t = ln.trim();
      return !(t.startsWith('//') || t.startsWith('//!') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

  // Forbidden: any file-write API targeting an auth path, or the AC-7 OS-user-dir
  // tokens (codex_login must, like codex_detect, introduce ZERO of them).
  const writeApis = ['File::create', 'fs::write', 'write_all', 'OpenOptions', 'create(', 'std::fs::write'];
  const rustWriteHits = writeApis.filter((t) => rustCode.includes(t));
  const authPathHits = /auth\.json/.test(rustCode); // code (not comments) must not reference the path literal
  // Reuse the SINGLE authoritative OS-user-dir pattern from the Rust sentinel
  // (external_dep_paths::forbidden_pattern_sentinel) by reading it out of that
  // file at runtime — this fixture does NOT embed the token list as a literal,
  // so it stays clean under T1-static-scan (which skips its own scanner only).
  const sentinelSrc = read('src-tauri/src/external_dep_paths.rs');
  const sentinelMatch = sentinelSrc.match(/forbidden_pattern_sentinel\(\)[\s\S]*?"([^"]+)"/);
  const sentinelPattern = sentinelMatch ? sentinelMatch[1] : '';
  const osUserDirRe = sentinelPattern ? new RegExp('\\b(' + sentinelPattern + ')\\b') : /$^/;
  const rustOsDirHit = osUserDirRe.test(rustCode);

  // codex_login must delegate detection to codex_detect (read-only) — NOT resolve
  // an auth path itself; it spawns `codex login` (the only side effect).
  const spawnsCodexLogin = rust.includes('"login"');
  const reusesDetect = rust.includes('detect_codex');

  // Frontend: the login wrapper invokes only the named Rust command; no fs.
  const frontendNoFs =
    !/writeFile|writeTextFile|fs\.write|BaseDirectory/.test(provider) &&
    !/writeFile|writeTextFile|fs\.write|BaseDirectory/.test(store);

  const report = {
    scenario: 'login-no-authwrite',
    rust_no_write_apis: rustWriteHits.length === 0,
    rust_write_hits: rustWriteHits,
    rust_code_no_authjson_literal: !authPathHits,
    sentinel_pattern_loaded: sentinelPattern.length > 0,
    rust_no_os_user_dir_tokens: !rustOsDirHit,
    spawns_codex_login: spawnsCodexLogin,
    reuses_readonly_detect: reusesDetect,
    frontend_no_fs_write: frontendNoFs,
  };
  if (!report.rust_no_write_apis) return fail(report, `codex_login.rs uses a file-write API: ${JSON.stringify(rustWriteHits)}`);
  if (!report.rust_code_no_authjson_literal) return fail(report, 'codex_login.rs CODE references auth.json (must be spawn-only)');
  if (!report.sentinel_pattern_loaded) return fail(report, 'could not load the OS-user-dir sentinel pattern from external_dep_paths.rs');
  if (!report.rust_no_os_user_dir_tokens) return fail(report, 'codex_login.rs introduces a forbidden OS-user-dir token (must delegate)');
  if (!report.spawns_codex_login) return fail(report, 'codex_login.rs does not spawn `codex login`');
  if (!report.reuses_readonly_detect) return fail(report, 'codex_login.rs does not reuse the read-only detect for state refresh');
  if (!report.frontend_no_fs_write) return fail(report, 'frontend login path touches a filesystem-write API');
  pass(report);
}

// AC-CODEX-LOGIN-BTN + AC-LOGIN-STATE-REFRESH wiring: the button is rendered and
// bound to the store action; the store applies a returned detect snapshot.
async function loginButtonWired() {
  const toggle = read('src/lib/components/ModeToggle.svelte');
  const store = read('src/lib/llm/modeStore.svelte.ts');
  const report = {
    scenario: 'login-button-wired',
    button_label_present: toggle.includes('ChatGPT로 로그인'),
    button_calls_action: /loginWithChatGPT/.test(toggle),
    store_exports_action: /export async function loginWithChatGPT/.test(store),
    store_applies_detect_on_authed: /case 'authed'[\s\S]*?applyDetect/.test(store),
    store_refresh_on_pending: /case 'pending'[\s\S]*?refreshDetect/.test(store),
    store_message_korean_states: store.includes('확인되었습니다') && store.includes('loginMessage'),
    button_busy_state: toggle.includes('modeStore.loggingIn'),
  };
  if (!report.button_label_present) return fail(report, '[ChatGPT로 로그인] button label missing');
  if (!report.button_calls_action) return fail(report, 'button not bound to loginWithChatGPT');
  if (!report.store_exports_action) return fail(report, 'modeStore does not export loginWithChatGPT');
  if (!report.store_applies_detect_on_authed) return fail(report, 'authed outcome does not apply the detect snapshot (state refresh broken)');
  if (!report.store_refresh_on_pending) return fail(report, 'pending outcome does not re-detect (state refresh broken)');
  if (!report.button_busy_state) return fail(report, 'login button lacks a busy/disabled state');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  // Tier 1
  'tab-order-usage': tabOrderUsage,
  'sticky-sidebar-css': stickySidebarCss,
  'login-spawn-graceful': loginSpawnGraceful,
  // Tier 2
  'usage-content': usageContent,
  'login-no-authwrite': loginNoAuthWrite,
  'login-button-wired': loginButtonWired,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice6-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
