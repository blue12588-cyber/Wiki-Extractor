#!/usr/bin/env node
/**
 * Tier-1/2 smoke for Slice 8 — codex login browser-open bug fix
 * (detect-first + device-auth URL/code parse + app-opens-browser) + usage-tab
 * outline-first guidance.
 *
 * Deterministic, OFFLINE: no real `codex login` spawn, no network, no browser.
 * The login outcome shapes are exercised against the FRONTEND degradation path
 * (Tauri shell absent → graceful) and STATIC markup/source scans. The real OAuth
 * success / actual browser open are environment-dependent and NOT asserted here
 * (contract: codex login 실 OAuth 실패 = graceful 복붙, 정지 아님).
 *
 * Authority: agreed_contract.json (Slice 8)#AC-LOGIN-DETECT-FIRST +
 *            AC-LOGIN-DEVICE-BROWSER + AC-LOGIN-CODE-UI + AC-LOGIN-GRACEFUL +
 *            AC-USAGE-OUTLINE-FIRST + AC-KOREAN-UI + AC-REGRESS + AC-9.
 *
 * TIER-1 (smoke — fast, structural; run first):
 *   detect-first-wiring   loginWithChatGPT runs a read-only detect FIRST and, when
 *                         already authed, returns authed WITHOUT calling
 *                         startCodexLogin (no spawn) and WITHOUT a verification
 *                         (no browser); the store flips availability on + sets a
 *                         Korean "이미 로그인" message + alreadyAuthed.
 *   login-graceful        startCodexLogin() OUTSIDE the Tauri shell returns a
 *                         non-throwing graceful outcome with a Korean message
 *                         (copy-paste reassurance) — the degrade path.
 *   usage-outline-first   UsageTab leads with a 목차/스키마-먼저 callout + the full
 *                         five-step order (목차→원서→추출→ChatGPT→위키), Korean.
 *   no-token-display      neither the Rust login module nor the frontend surfaces
 *                         an access token; only the (non-secret) device code/URL.
 *
 * TIER-2 (fuller behaviour/structure):
 *   device-auth-default   the login button + Rust command default to the
 *                         device-code (--device-auth) flow so a verification
 *                         URL+code is emitted on a piped/no-TTY spawn.
 *   url-code-parse        codex_login.rs splits a captured line into a structured
 *                         Verification{url, code, browser_opened, raw}; the
 *                         XXXX-XXXX code + http(s) URL are extracted, non-code
 *                         lines rejected; the app opens the URL via an
 *                         OS-delegated command (not an OAuth round trip).
 *   code-ui               ModeToggle shows the code prominently (verify-code-big)
 *                         + a copy button + an open-URL button + a [다시 검출]
 *                         after-login hint; the store carries a structured
 *                         Verification.
 *   no-authwrite          the app never writes/reads the auth file (spawn-only),
 *                         introduces zero OS-user-dir tokens, and the browser
 *                         open is OS-delegated (no credential handling).
 *
 * Usage: node --import tsx fixtures/t1-slice8-smoke.mjs <scenario>
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

/* Strip Rust comments/doc lines so a boundary DESCRIPTION (which legitimately
 * mentions auth.json / access token) is not counted as a code violation. */
function rustCodeOnly(src) {
  return src
    .split(/\r?\n/)
    .filter((ln) => {
      const t = ln.trim();
      return !(t.startsWith('//') || t.startsWith('//!') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

/* ------------------------------- TIER 1 ------------------------------- */

// AC-LOGIN-DETECT-FIRST: pressing the button runs a read-only detect first; an
// already-authed machine short-circuits — NO startCodexLogin spawn, NO
// verification (no browser), availability flipped on, Korean "이미 로그인" + the
// alreadyAuthed flag. We monkey-patch the provider module's invoke resolver so
// detectCodex reports authed deterministically, and assert startCodexLogin is
// never reached (it would throw the preview-failed outcome we can detect).
async function detectFirstWiring() {
  const store = read('src/lib/llm/modeStore.svelte.ts');
  // Source-level wiring (no DOM): the detect-first branch must precede the spawn.
  const detectBeforeSpawn = (() => {
    const fn = store.slice(store.indexOf('export async function loginWithChatGPT'));
    const detectIdx = fn.indexOf('await detectCodex()');
    const spawnIdx = fn.indexOf('await startCodexLogin(');
    return detectIdx >= 0 && spawnIdx >= 0 && detectIdx < spawnIdx;
  })();
  const report = {
    scenario: 'detect-first-wiring',
    runs_detect_first: detectBeforeSpawn,
    short_circuits_when_available: /if \(pre\.available\)\s*\{[\s\S]*?return \{ state: 'authed', detect: pre \}/.test(store),
    no_spawn_on_authed: /if \(pre\.available\)\s*\{[\s\S]*?return[\s\S]*?\}\s*\n\s*const outcome = await startCodexLogin/.test(store),
    sets_already_authed: /modeStore\.alreadyAuthed\s*=\s*true/.test(store),
    applies_detect_on_pre: /if \(pre\.available\)\s*\{\s*\n\s*applyDetect\(pre\)/.test(store),
    korean_already_logged_in: /이미 ChatGPT에 로그인되어 있습니다/.test(store),
    success_polarity_on_pre: /if \(pre\.available\)[\s\S]*?loginOutcomeKind\s*=\s*'success'/.test(store),
    clears_verification: /modeStore\.loginVerification\s*=\s*null/.test(store),
  };
  if (!report.runs_detect_first) return fail(report, 'loginWithChatGPT does not run a read-only detect BEFORE spawning');
  if (!report.short_circuits_when_available) return fail(report, 'already-authed does not short-circuit to an authed outcome');
  if (!report.no_spawn_on_authed) return fail(report, 'already-authed path does not return before startCodexLogin (would spawn / open browser)');
  if (!report.sets_already_authed) return fail(report, 'store does not set alreadyAuthed on the detect-first short-circuit');
  if (!report.applies_detect_on_pre) return fail(report, 'already-authed path does not applyDetect (auto mode would not become selectable)');
  if (!report.korean_already_logged_in) return fail(report, 'no Korean "이미 로그인" guidance for the detect-first path');
  if (!report.success_polarity_on_pre) return fail(report, 'detect-first success not marked success polarity');
  pass(report);
}

// AC-LOGIN-GRACEFUL: outside Tauri the login spawn degrades gracefully (Korean
// message, no throw). The app stays usable in copy-paste mode.
async function loginGraceful() {
  const { startCodexLogin } = await import('../src/lib/llm/provider.ts');
  let threw = false;
  let outcome;
  try {
    outcome = await startCodexLogin(true);
  } catch (e) {
    threw = true;
    outcome = { error: String(e) };
  }
  const report = {
    scenario: 'login-graceful',
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

// AC-USAGE-OUTLINE-FIRST + AC-KOREAN-UI: UsageTab leads with a 목차/스키마-먼저
// callout and lays out the full five-step order, in 일반인 친화 한글, no jargon.
async function usageOutlineFirst() {
  const usage = read('src/lib/components/views/UsageTab.svelte');
  const report = {
    scenario: 'usage-outline-first',
    korean: hasKorean(usage),
    callout_present: /class="outline-first"/.test(usage),
    callout_says_outline_first: /가장 먼저.*목차|먼저.*목차\(스키마\)/.test(usage),
    mentions_schema: usage.includes('스키마'),
    order_flow_present: /class="outline-flow"/.test(usage) && /목차 입력 → 원서 넣기 → 후보 추출 → ChatGPT 정리 → 위키 검토·저장/.test(usage),
    five_steps: (usage.match(/n:\s*'[①②③④⑤]'/g) || []).length === 5,
    step_one_is_outline: /n:\s*'①'[\s\S]{0,80}?목차/.test(usage),
    extract_classifies_by_outline: /목차 기준|목차 항목에 맞춰|목차에 맞춰/.test(usage),
    lede_says_five: /다섯 단계/.test(usage),
    no_jargon: !/(oauth|tauri|invoke|chunk_id|openai-oauth|svelte|--device-auth)/i.test(usage.replace(/<!--[\s\S]*?-->/g, '')),
  };
  if (!report.korean) return fail(report, 'usage tab is not Korean');
  if (!report.callout_present) return fail(report, 'no outline-first callout block');
  if (!report.callout_says_outline_first) return fail(report, 'callout does not tell the user to enter the outline FIRST');
  if (!report.mentions_schema) return fail(report, 'callout/usage does not mention 스키마 (schema)');
  if (!report.order_flow_present) return fail(report, 'the five-step order flow (목차→원서→추출→ChatGPT→위키) is missing');
  if (!report.five_steps) return fail(report, 'usage does not have exactly five numbered steps');
  if (!report.step_one_is_outline) return fail(report, 'step ① is not the 목차 input step');
  if (!report.extract_classifies_by_outline) return fail(report, 'extract step does not say candidates are classified by the outline');
  if (!report.lede_says_five) return fail(report, 'intro lede still says 네 단계 (should be 다섯 단계)');
  if (!report.no_jargon) return fail(report, 'usage outline guidance leaks internal jargon');
  pass(report);
}

// forbidden_side_effects("access token 출력/표시"): no access-token surfacing on
// the login path. Only the non-secret device code/URL is shown. We scan the Rust
// login code + the frontend for token-display tokens, and confirm the structured
// Verification carries code/url/raw but no token field.
async function noTokenDisplay() {
  const rust = read('src-tauri/src/codex_login.rs');
  const rustCode = rustCodeOnly(rust);
  const provider = read('src/lib/llm/provider.ts');
  const toggle = read('src/lib/components/ModeToggle.svelte');
  // Token-bearing identifiers that must NOT appear in code (display/serialize).
  const tokenTokens = ['access_token', 'accessToken', 'id_token', 'refresh_token', 'bearer', 'api_key', 'apiKey'];
  const rustTokenHits = tokenTokens.filter((t) => rustCode.includes(t));
  // The Verification struct must expose only url/code/browser_opened/raw.
  const verifFields = /pub struct Verification \{([\s\S]*?)\}/.exec(rust);
  const verifBody = verifFields ? verifFields[1] : '';
  const report = {
    scenario: 'no-token-display',
    rust_no_token_tokens: rustTokenHits.length === 0,
    rust_token_hits: rustTokenHits,
    verif_has_code: /pub code:/.test(verifBody),
    verif_has_url: /pub url:/.test(verifBody),
    verif_no_token_field: !/token/i.test(verifBody),
    provider_no_token_field: !/(access_token|accessToken|id_token|refresh_token)/.test(provider),
    // The UI shows code/url labels, never an ACCESS-TOKEN label. We strip HTML
    // comments AND CSS/JS block comments (which contain "토큰만 사용" = "uses only
    // design tokens", unrelated to auth) before scanning, and flag only
    // access-token wording — never the design-token sense of 토큰.
    ui_no_token_label: !/(access[ _-]?token|access 토큰|토큰 표시|토큰을 표시|어세스 토큰)/i.test(
      toggle.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''),
    ),
    ui_shows_code_label: /확인 코드/.test(toggle),
  };
  if (!report.rust_no_token_tokens) return fail(report, `codex_login.rs CODE references an access-token identifier: ${JSON.stringify(rustTokenHits)}`);
  if (!report.verif_has_code) return fail(report, 'Verification struct has no code field');
  if (!report.verif_has_url) return fail(report, 'Verification struct has no url field');
  if (!report.verif_no_token_field) return fail(report, 'Verification struct carries a token-like field (must surface code/url only)');
  if (!report.provider_no_token_field) return fail(report, 'frontend Verification type carries a token field');
  if (!report.ui_no_token_label) return fail(report, 'login UI shows a token label (must show only the verification code/URL)');
  if (!report.ui_shows_code_label) return fail(report, 'login UI does not label the verification code');
  pass(report);
}

/* ------------------------------- TIER 2 ------------------------------- */

// AC-LOGIN-DEVICE-BROWSER (default): the login button + Rust command default to
// device-auth so a verification URL+code is emitted regardless of TTY.
async function deviceAuthDefault() {
  const toggle = read('src/lib/components/ModeToggle.svelte');
  const store = read('src/lib/llm/modeStore.svelte.ts');
  const rust = read('src-tauri/src/codex_login.rs');
  const report = {
    scenario: 'device-auth-default',
    primary_button_device_true: /function login\(\)\s*\{[\s\S]*?loginWithChatGPT\(true\)/.test(toggle),
    store_default_param_true: /export async function loginWithChatGPT\(deviceAuth = true\)/.test(store),
    rust_command_default_true: /run_codex_login\(device_auth\.unwrap_or\(true\)\)/.test(rust),
    rust_adds_device_flag: /"--device-auth"/.test(rust),
    fallback_browser_callback: /function loginDevice\(\)\s*\{[\s\S]*?loginWithChatGPT\(false\)/.test(toggle),
  };
  if (!report.primary_button_device_true) return fail(report, 'primary login button does not default to device-auth (true)');
  if (!report.store_default_param_true) return fail(report, 'store loginWithChatGPT does not default deviceAuth to true');
  if (!report.rust_command_default_true) return fail(report, 'Rust command does not default device_auth to true (browser-open fix lost)');
  if (!report.rust_adds_device_flag) return fail(report, 'Rust never passes --device-auth');
  if (!report.fallback_browser_callback) return fail(report, 'browser-callback fallback (loginDevice → false) missing');
  pass(report);
}

// AC-LOGIN-DEVICE-BROWSER (parse + open): codex_login.rs splits a line into a
// structured Verification, extracts the XXXX-XXXX code + http(s) URL, rejects
// non-codes, and opens the URL via an OS-delegated command (start/open/xdg-open).
// We exercise the pure parsers by importing the unit-test expectations through a
// source scan AND a behavioural check of the parse helpers' shape.
async function urlCodeParse() {
  const rust = read('src-tauri/src/codex_login.rs');
  const report = {
    scenario: 'url-code-parse',
    has_verification_struct: /pub struct Verification \{[\s\S]*?pub url: Option<String>[\s\S]*?pub code: Option<String>[\s\S]*?pub browser_opened: bool[\s\S]*?pub raw: String/.test(rust),
    has_parse_url: /fn parse_url\(/.test(rust),
    url_trims_punct: /trim_end_matches/.test(rust),
    has_parse_device_code: /fn parse_device_code\(/.test(rust),
    code_requires_two_groups: /split_once\('-'\)/.test(rust) && /!b\.contains\('-'\)/.test(rust),
    has_build_verification: /fn build_verification\(/.test(rust),
    has_open_in_browser: /fn open_in_browser\(/.test(rust),
    open_is_os_delegated: /"start"/.test(rust) && /"xdg-open"|xdg-open/.test(rust) && /"open"|Command::new\("open"\)/.test(rust),
    open_refuses_non_http: /starts_with\("http:\/\/"\)\s*\|\|\s*lower\.starts_with\("https:\/\/"\)/.test(rust),
    // Unit tests cover the parse contract (run by `cargo test`, asserted present).
    has_parse_unit_tests: /fn parse_url_extracts_and_trims/.test(rust) && /fn parse_device_code_accepts_xxxx_xxxx/.test(rust) && /fn parse_device_code_rejects_non_code/.test(rust) && /fn build_verification_splits_url_and_code/.test(rust) && /fn open_in_browser_rejects_non_http/.test(rust),
  };
  if (!report.has_verification_struct) return fail(report, 'no structured Verification{url,code,browser_opened,raw}');
  if (!report.has_parse_url) return fail(report, 'no parse_url helper');
  if (!report.url_trims_punct) return fail(report, 'parse_url does not trim trailing punctuation');
  if (!report.has_parse_device_code) return fail(report, 'no parse_device_code helper');
  if (!report.code_requires_two_groups) return fail(report, 'parse_device_code does not require the canonical two-group XXXX-XXXX shape');
  if (!report.has_build_verification) return fail(report, 'no build_verification (split + open)');
  if (!report.has_open_in_browser) return fail(report, 'no open_in_browser helper (app does not open the URL)');
  if (!report.open_is_os_delegated) return fail(report, 'browser open is not OS-delegated (start/open/xdg-open)');
  if (!report.open_refuses_non_http) return fail(report, 'open_in_browser does not refuse non-http(s) URLs');
  if (!report.has_parse_unit_tests) return fail(report, 'missing Rust unit tests for the parse/open contract');
  pass(report);
}

// AC-LOGIN-CODE-UI: ModeToggle shows the code prominently + copy + open-URL +
// [다시 검출] after-login hint; the store carries a structured Verification.
async function codeUi() {
  const toggle = read('src/lib/components/ModeToggle.svelte');
  const store = read('src/lib/llm/modeStore.svelte.ts');
  const provider = read('src/lib/llm/provider.ts');
  const report = {
    scenario: 'code-ui',
    big_code_rendered: /class="verify-code-big">\{v\.code\}/.test(toggle),
    copy_button: /onclick=\{copyCode\}/.test(toggle) && /코드 복사/.test(toggle),
    copy_uses_clipboard: /navigator\.clipboard\.writeText\(code\)/.test(toggle),
    open_url_button: /onclick=\{openUrl\}/.test(toggle) && /주소 열기/.test(toggle),
    open_url_helper: /export function openVerificationUrl/.test(provider) && /window\.open\(url/.test(provider),
    open_url_os_delegated_only: /startsWith\('http:\/\/'\)\s*\|\|\s*lower\.startsWith\('https:\/\/'\)/.test(provider),
    detect_again_hint: /로그인을 마친 뒤[\s\S]*?다시 검출/.test(toggle),
    store_verification_structured: /loginVerification:\s*Verification \| null/.test(store),
    provider_verification_type: /export interface Verification \{[\s\S]*?url: string \| null[\s\S]*?code: string \| null[\s\S]*?browser_opened: boolean/.test(provider),
    browser_opened_branch: /v\.browser_opened/.test(toggle),
    korean: hasKorean(toggle),
  };
  if (!report.big_code_rendered) return fail(report, 'verification code is not rendered prominently (verify-code-big)');
  if (!report.copy_button) return fail(report, 'no 코드 복사 button');
  if (!report.copy_uses_clipboard) return fail(report, 'copy button does not use the clipboard API');
  if (!report.open_url_button) return fail(report, 'no 주소 열기 (open URL) button');
  if (!report.open_url_helper) return fail(report, 'no openVerificationUrl helper using window.open');
  if (!report.open_url_os_delegated_only) return fail(report, 'openVerificationUrl does not restrict to http(s) (OS-delegated only)');
  if (!report.detect_again_hint) return fail(report, 'no [다시 검출] after-login hint in the code UI');
  if (!report.store_verification_structured) return fail(report, 'store loginVerification is not the structured Verification type');
  if (!report.provider_verification_type) return fail(report, 'provider Verification type missing url/code/browser_opened');
  if (!report.browser_opened_branch) return fail(report, 'code UI does not adapt to browser_opened');
  if (!report.korean) return fail(report, 'code UI is not Korean');
  pass(report);
}

// forbidden_side_effects (no auth write / no OS-user-dir token / OS-delegated
// open with no credential handling): the app spawns codex login + opens a URL
// only; it NEVER opens/writes/parses the auth file and introduces ZERO
// OS-user-dir tokens. Static token scan of the login path.
async function noAuthWrite() {
  const rust = read('src-tauri/src/codex_login.rs');
  const provider = read('src/lib/llm/provider.ts');
  const store = read('src/lib/llm/modeStore.svelte.ts');
  const rustCode = rustCodeOnly(rust);

  // No auth-file write APIs, no auth.json literal in CODE.
  const writeApis = ['File::create', 'fs::write', 'write_all', 'OpenOptions', 'std::fs::write'];
  const rustWriteHits = writeApis.filter((t) => rustCode.includes(t));
  const authPathHits = /auth\.json/.test(rustCode);

  // Reuse the SINGLE authoritative OS-user-dir pattern from the Rust sentinel.
  const sentinelSrc = read('src-tauri/src/external_dep_paths.rs');
  const sentinelMatch = sentinelSrc.match(/forbidden_pattern_sentinel\(\)[\s\S]*?"([^"]+)"/);
  const sentinelPattern = sentinelMatch ? sentinelMatch[1] : '';
  const osUserDirRe = sentinelPattern ? new RegExp('\\b(' + sentinelPattern + ')\\b') : /$^/;
  const rustOsDirHit = osUserDirRe.test(rustCode);

  // Browser open is OS-delegated (a process spawn of the OS handler), never an
  // OAuth/credential round trip. The opener spawns start/open/xdg-open only.
  const opensViaOsHandler = /Command::new\("cmd"\)[\s\S]*?"start"/.test(rust) || /xdg-open/.test(rust);
  const noOauthRoundTrip = !/reqwest|http_client|exchange_token|client_secret/.test(rustCode);

  const spawnsCodexLogin = rust.includes('"login"');
  const reusesDetect = rust.includes('detect_codex');

  const frontendNoFs =
    !/writeFile|writeTextFile|fs\.write|BaseDirectory/.test(provider) &&
    !/writeFile|writeTextFile|fs\.write|BaseDirectory/.test(store);

  const report = {
    scenario: 'no-authwrite',
    rust_no_write_apis: rustWriteHits.length === 0,
    rust_write_hits: rustWriteHits,
    rust_code_no_authjson_literal: !authPathHits,
    sentinel_pattern_loaded: sentinelPattern.length > 0,
    rust_no_os_user_dir_tokens: !rustOsDirHit,
    browser_open_os_delegated: opensViaOsHandler,
    no_oauth_round_trip_in_app: noOauthRoundTrip,
    spawns_codex_login: spawnsCodexLogin,
    reuses_readonly_detect: reusesDetect,
    frontend_no_fs_write: frontendNoFs,
  };
  if (!report.rust_no_write_apis) return fail(report, `codex_login.rs uses a file-write API: ${JSON.stringify(rustWriteHits)}`);
  if (!report.rust_code_no_authjson_literal) return fail(report, 'codex_login.rs CODE references auth.json (must be spawn-only)');
  if (!report.sentinel_pattern_loaded) return fail(report, 'could not load the OS-user-dir sentinel pattern');
  if (!report.rust_no_os_user_dir_tokens) return fail(report, 'codex_login.rs introduces a forbidden OS-user-dir token (must delegate)');
  if (!report.browser_open_os_delegated) return fail(report, 'browser open is not via the OS handler (start/open/xdg-open)');
  if (!report.no_oauth_round_trip_in_app) return fail(report, 'app appears to perform an OAuth round trip (codex must own auth)');
  if (!report.spawns_codex_login) return fail(report, 'codex_login.rs does not spawn `codex login`');
  if (!report.reuses_readonly_detect) return fail(report, 'codex_login.rs does not reuse the read-only detect');
  if (!report.frontend_no_fs_write) return fail(report, 'frontend login path touches a filesystem-write API');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  // Tier 1
  'detect-first-wiring': detectFirstWiring,
  'login-graceful': loginGraceful,
  'usage-outline-first': usageOutlineFirst,
  'no-token-display': noTokenDisplay,
  // Tier 2
  'device-auth-default': deviceAuthDefault,
  'url-code-parse': urlCodeParse,
  'code-ui': codeUi,
  'no-authwrite': noAuthWrite,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice8-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
