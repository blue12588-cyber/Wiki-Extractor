#!/usr/bin/env node
/**
 * Tier-1/2 smoke for Slice 9 — codex detect Windows-`.cmd` bug fix + WSL
 * cross-boundary fallback (origin) + proxy origin branch + auto-extract prompt
 * (academic 7-type + 목차 classification) + usage-tab auto-mode setup section.
 *
 * Deterministic, OFFLINE: no real `codex login status`, no `wsl.exe`, no `npx`,
 * no network. The probe/spawn ROUTING and the origin/prompt/UI shapes are
 * asserted via STATIC source scans + the FRONTEND degradation path (Tauri shell
 * absent → graceful). The real Windows/WSL detect + cross-boundary proxy are
 * environment-dependent and NOT asserted here (contract: cross-boundary 실패 =
 * graceful 복붙, 정지 아님; WSL2 forwarding verified later by the user).
 *
 * Authority: agreed_contract.json (Slice 9)#AC-DETECT-WIN-CMD +
 *            AC-DETECT-WSL-FALLBACK + AC-PROXY-ORIGIN + AC-AUTO-EXTRACT-CONFIRM +
 *            AC-USAGE-AUTO-SETUP + AC-KOREAN-UI + AC-REGRESS + AC-9.
 *
 * TIER-1 (smoke — fast, structural; run first):
 *   detect-win-cmd        codex_detect.rs probe routes through `cmd /C codex
 *                         login status` on Windows (the .cmd-shim fix), keeps the
 *                         direct spawn off-Windows, and adds the WSL fallback +
 *                         origin field with fixed-literal args.
 *   origin-defaults       the CodexOrigin enum serializes snake_case
 *                         (windows/wsl/none); the frontend snapshot + store carry
 *                         origin defaulting to 'none'.
 *   usage-auto-setup      UsageTab adds a 자동 모드 설정법 (고급) section: PowerShell
 *                         → install codex → codex login → 자동 모드, Korean, distinct
 *                         from the default copy-paste steps, outline-first kept.
 *   auto-extract-prompt   buildPrompt instructs the academic 7-type extraction +
 *                         목차 classification and keeps the chunk_id anti-forgery
 *                         instruction; the autoExtract flow is intact + wired.
 *
 * TIER-2 (fuller behaviour/structure):
 *   wsl-fallback          detect_codex tries the WSL probe ONLY when the native
 *                         probe is Missing AND on Windows; both probes read-only;
 *                         origin recorded; cli_missing only when found nowhere.
 *   proxy-origin          oauth_child spawn branches on origin: wsl → `wsl.exe --
 *                         npx openai-oauth --port <P>`, else `cmd /C npx …`; fixed
 *                         literals; resolves origin from a read-only detect;
 *                         graceful degrade on spawn failure.
 *   no-authwrite-detect   neither detect nor the proxy spawn writes/reads the auth
 *                         file; zero OS-user-dir tokens; new shell args are fixed
 *                         literals (no user-input injection).
 *   evidence-forgery-kept the chunk_id anti-forgery validator is unchanged-or-
 *                         stronger; autoExtract still routes through it.
 *
 * Usage: node --import tsx fixtures/t1-slice9-smoke.mjs <scenario>
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
 * mentions auth.json) is not counted as a code violation. */
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

// AC-DETECT-WIN-CMD: the core bug fix. The Windows probe must route `codex login
// status` through `cmd /C` (so the `.cmd` shim resolves) — a direct
// `Command::new("codex.cmd")` is the Slice-5c bug. Off-Windows keeps the direct
// spawn. Source-scan the routing shape.
async function detectWinCmd() {
  const rust = read('src-tauri/src/codex_detect.rs');
  const report = {
    scenario: 'detect-win-cmd',
    windows_routes_through_cmd:
      /Command::new\("cmd"\)/.test(rust) && /"\/C", bin, "login", "status"/.test(rust),
    nonwindows_direct_spawn: /Command::new\(bin\)/.test(rust) && /c\.args\(\["login", "status"\]\)/.test(rust),
    // The fix must NOT leave the old direct `.spawn()` of `bin` with login/status
    // as the Windows path (that was the bug). The probe now goes via a built
    // Command from build_probe_command.
    has_build_probe_command: /fn build_probe_command\(/.test(rust),
    bounded_timeout_kept: /PROBE_TIMEOUT/.test(rust) && /try_wait\(\)/.test(rust),
    stdio_null_readonly:
      /\.stdin\(Stdio::null\(\)\)/.test(rust) &&
      /\.stdout\(Stdio::null\(\)\)/.test(rust) &&
      /\.stderr\(Stdio::null\(\)\)/.test(rust),
    has_win_cmd_test: /fn windows_probe_routes_through_cmd/.test(rust),
  };
  if (!report.windows_routes_through_cmd) return fail(report, 'Windows probe does not route through `cmd /C codex login status` (the .cmd-shim fix)');
  if (!report.nonwindows_direct_spawn) return fail(report, 'non-Windows probe does not spawn the codex binary directly');
  if (!report.has_build_probe_command) return fail(report, 'no build_probe_command helper (probe routing not centralized)');
  if (!report.bounded_timeout_kept) return fail(report, 'bounded-timeout poll loop (PROBE_TIMEOUT/try_wait) lost');
  if (!report.stdio_null_readonly) return fail(report, 'probe stdio not fully null (must stay read-only)');
  if (!report.has_win_cmd_test) return fail(report, 'missing source-guard test windows_probe_routes_through_cmd');
  pass(report);
}

// AC-DETECT-WSL-FALLBACK (origin field): CodexOrigin serializes snake_case and
// the frontend snapshot + store carry origin defaulting to 'none'.
async function originDefaults() {
  const rust = read('src-tauri/src/codex_detect.rs');
  const provider = read('src/lib/llm/provider.ts');
  const store = read('src/lib/llm/modeStore.svelte.ts');
  const report = {
    scenario: 'origin-defaults',
    rust_enum_present: /pub enum CodexOrigin \{[\s\S]*?Windows[\s\S]*?Wsl[\s\S]*?None[\s\S]*?\}/.test(rust),
    rust_enum_snake_case: /#\[serde\(rename_all = "snake_case"\)\]\s*\npub enum CodexOrigin/.test(rust),
    struct_has_origin: /pub struct CodexDetect \{[\s\S]*?pub origin: CodexOrigin/.test(rust),
    has_origin_serialize_test: /fn origin_serializes_snake_case/.test(rust) && /fn detect_serializes_origin_field/.test(rust),
    frontend_type: /export type CodexOrigin = 'windows' \| 'wsl' \| 'none'/.test(provider),
    snapshot_has_origin: /origin: CodexOrigin/.test(provider),
    // Slice 10 evolved this in place (slice-supersedes-slice precedent): the two
    // inline detectCodex degrade returns were consolidated into a single
    // `degradedSnapshot()` helper that defaults `origin: 'none'`, and BOTH
    // degrade paths (no-shell + invoke-throw catch) call it. The behaviour — a
    // degrade snapshot that defaults origin to none — is preserved; assert the
    // helper sets it AND both call sites route through the helper.
    frontend_defaults_none:
      /function degradedSnapshot\([\s\S]*?origin: 'none'/.test(provider) &&
      (provider.match(/degradedSnapshot\(/g) || []).length >= 3, // def + 2 call sites
    store_initial_origin_none: /origin: 'none'/.test(store),
  };
  if (!report.rust_enum_present) return fail(report, 'CodexOrigin enum (windows/wsl/none) missing');
  if (!report.rust_enum_snake_case) return fail(report, 'CodexOrigin not serde snake_case');
  if (!report.struct_has_origin) return fail(report, 'CodexDetect struct missing origin field');
  if (!report.has_origin_serialize_test) return fail(report, 'missing origin serialize tests');
  if (!report.frontend_type) return fail(report, 'frontend CodexOrigin type missing');
  if (!report.snapshot_has_origin) return fail(report, 'frontend snapshot missing origin field');
  if (!report.frontend_defaults_none) return fail(report, 'detectCodex degrade paths do not default origin to none');
  if (!report.store_initial_origin_none) return fail(report, 'modeStore INITIAL_DETECT missing origin none default');
  pass(report);
}

// AC-USAGE-AUTO-SETUP + AC-KOREAN-UI: a 자동 모드 설정법 (고급) section: PowerShell
// → install codex → codex login → 자동 모드, Korean, distinct from copy-paste,
// outline-first guidance preserved.
async function usageAutoSetup() {
  const usage = read('src/lib/components/views/UsageTab.svelte');
  const visible = usage.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  const report = {
    scenario: 'usage-auto-setup',
    korean: hasKorean(usage),
    section_present: /class="auto-setup"/.test(usage),
    title_advanced: /자동 모드 설정법/.test(visible) && /고급/.test(visible),
    mentions_powershell: /PowerShell|파워셸/.test(visible),
    install_command: usage.includes('npm i -g') && usage.includes('codex'),
    login_command: /codex login/.test(visible),
    mentions_own_account: /무료|구독/.test(visible) && /계정/.test(visible),
    mentions_codex_background: /백그라운드/.test(visible),
    distinct_from_paste: /방법 A/.test(visible) && /선택|고급/.test(visible),
    // Slice-8 outline-first guidance is NOT removed.
    outline_first_kept: /class="outline-first"/.test(usage),
    five_steps_kept: (usage.match(/n:\s*'[①②③④⑤]'/g) || []).length === 5,
    // The default copy-paste branch (방법 B 자동 처리 in step ④) is untouched.
    paste_branch_kept: /방법 B · 자동으로 처리/.test(usage),
  };
  if (!report.korean) return fail(report, 'usage tab not Korean');
  if (!report.section_present) return fail(report, 'no auto-setup section');
  if (!report.title_advanced) return fail(report, 'section is not titled 자동 모드 설정법 (고급)');
  if (!report.mentions_powershell) return fail(report, 'auto-setup does not mention PowerShell');
  if (!report.install_command) return fail(report, 'auto-setup missing the codex install command (npm i -g)');
  if (!report.login_command) return fail(report, 'auto-setup missing `codex login`');
  if (!report.mentions_own_account) return fail(report, 'auto-setup does not say it uses the user\'s own free/subscription account');
  if (!report.mentions_codex_background) return fail(report, 'auto-setup does not mention keeping codex available/background');
  if (!report.distinct_from_paste) return fail(report, 'auto-setup not framed as a separate optional/advanced section');
  if (!report.outline_first_kept) return fail(report, 'slice-8 outline-first guidance was removed (regression)');
  if (!report.five_steps_kept) return fail(report, 'the five default steps were altered (regression)');
  if (!report.paste_branch_kept) return fail(report, 'the default copy-paste branch was removed (regression)');
  pass(report);
}

// AC-AUTO-EXTRACT-CONFIRM: the prompt instructs the academic 7-type extraction +
// 목차 classification and keeps the chunk_id anti-forgery instruction; the
// autoExtract flow is intact + wired (buildPrompt → runExtraction → parse →
// validate). We assert via buildPrompt output + source wiring.
async function autoExtractPrompt() {
  const { buildPrompt } = await import('../src/lib/bridge/promptBuilder.ts');
  const auto = read('src/lib/llm/autoExtract.ts');
  const input = {
    candidate: { candidate: { title: 'T', type: 'argument' }, target_entry_title: null, total: 0 },
    chunks: [{ chunk_id: 'chunk-real-0', location: { page: 3 }, text: '원문 문장' }],
    schema: ['1장 서론', '2장 배경'],
  };
  const p = buildPrompt(input);
  const report = {
    scenario: 'auto-extract-prompt',
    prompt_korean: hasKorean(p),
    has_seven_types:
      p.includes('concept') && p.includes('argument') && p.includes('method') &&
      p.includes('scholar') && p.includes('religious_text') && p.includes('objection') &&
      p.includes('quotation'),
    has_outline_classification: p.includes('schema_field') && (p.includes('목차') || p.includes('분류')),
    keeps_chunk_id_antiforgery: p.includes('chunk_id') && /지어내지 마라|실제로 있는 id/.test(p),
    keeps_catholic: p.includes('가톨릭 용어'),
    keeps_verbatim: /원문.*그대로|축자|변경하지 마라/.test(p),
    output_format_intact: p.includes('[OUTPUT_FORMAT]') && p.includes('wiki_candidates') && p.includes('"evidence"'),
    // The flow is intact + wired (not rewritten): autoExtract still chains
    // buildPrompt → runExtraction → parseResponse → validateResponse.
    flow_buildprompt: /const prompt = buildPrompt\(input\)/.test(auto),
    flow_runextraction: /provider\.runExtraction\(prompt\)/.test(auto),
    flow_parse: /parseResponse\(extraction\.rawText\)/.test(auto),
    flow_validate: /validateResponse\(parsed\.value, knownChunkIds\)/.test(auto),
  };
  if (!report.prompt_korean) return fail(report, 'prompt not Korean');
  if (!report.has_seven_types) return fail(report, 'prompt does not enumerate the academic 7 candidate types');
  if (!report.has_outline_classification) return fail(report, 'prompt does not ask for 목차/schema_field classification');
  if (!report.keeps_chunk_id_antiforgery) return fail(report, 'prompt dropped the chunk_id anti-forgery instruction');
  if (!report.keeps_catholic) return fail(report, 'prompt dropped the Catholic-terminology instruction');
  if (!report.keeps_verbatim) return fail(report, 'prompt dropped the verbatim/original-text-preservation instruction');
  if (!report.output_format_intact) return fail(report, 'OUTPUT_FORMAT (wiki_candidates/evidence) altered');
  if (!report.flow_buildprompt) return fail(report, 'autoExtract no longer builds the prompt');
  if (!report.flow_runextraction) return fail(report, 'autoExtract no longer calls provider.runExtraction');
  if (!report.flow_parse) return fail(report, 'autoExtract no longer parses the reply');
  if (!report.flow_validate) return fail(report, 'autoExtract no longer validates against knownChunkIds (anti-forgery seam)');
  pass(report);
}

/* ------------------------------- TIER 2 ------------------------------- */

// AC-DETECT-WSL-FALLBACK: detect_codex tries the WSL probe ONLY when the native
// probe is Missing AND on Windows; both read-only; origin recorded; cli_missing
// only when found nowhere.
async function wslFallback() {
  const rust = read('src-tauri/src/codex_detect.rs');
  const report = {
    scenario: 'wsl-fallback',
    has_wsl_probe: /fn probe_login_status_wsl\(/.test(rust),
    wsl_command_fixed_literal:
      /Command::new\("wsl\.exe"\)/.test(rust) && /"--", "codex", "login", "status"/.test(rust),
    only_on_windows: /if cfg!\(windows\) \{[\s\S]*?probe_login_status_wsl\(\)/.test(rust),
    only_when_native_missing: /LoginProbe::Missing =>/.test(rust) && /probe_login_status_wsl\(\)/.test(rust),
    records_origin_wsl: /CodexOrigin::Wsl/.test(rust),
    cli_missing_when_nowhere: /let cli_missing = probe == LoginProbe::Missing/.test(rust),
    fixed_literal_test: /fn probe_args_are_fixed_literals/.test(rust),
  };
  if (!report.has_wsl_probe) return fail(report, 'no probe_login_status_wsl');
  if (!report.wsl_command_fixed_literal) return fail(report, 'WSL probe is not `wsl.exe -- codex login status` with fixed literals');
  if (!report.only_on_windows) return fail(report, 'WSL fallback not guarded by cfg!(windows)');
  if (!report.only_when_native_missing) return fail(report, 'WSL fallback not gated on a native Missing probe');
  if (!report.records_origin_wsl) return fail(report, 'WSL detection does not record origin=wsl');
  if (!report.cli_missing_when_nowhere) return fail(report, 'cli_missing not derived from the effective (post-fallback) probe');
  if (!report.fixed_literal_test) return fail(report, 'missing fixed-literal guard test');
  pass(report);
}

// AC-PROXY-ORIGIN: oauth_child spawn branches on origin: wsl → `wsl.exe -- npx
// openai-oauth --port <P>`, else `cmd /C npx …`; fixed literals; resolves origin
// from a read-only detect; graceful degrade.
async function proxyOrigin() {
  const rust = read('src-tauri/src/oauth_child.rs');
  const report = {
    scenario: 'proxy-origin',
    has_build_proxy_command: /fn build_proxy_command\(/.test(rust),
    spawn_takes_origin: /pub async fn spawn_oauth_child\(\s*port_hint: Option<u16>,\s*origin: CodexOrigin,/.test(rust),
    wsl_branch:
      /origin == CodexOrigin::Wsl/.test(rust) &&
      /Command::new\("wsl\.exe"\)/.test(rust) &&
      /"--", "npx", "openai-oauth", "--port", &port_arg/.test(rust),
    windows_branch:
      /Command::new\("cmd"\)/.test(rust) && /"\/C", "npx", "openai-oauth", "--port", &port_arg/.test(rust),
    resolves_origin_from_detect: /let origin = detect_codex\(\)\.origin/.test(rust),
    graceful_degrade: /set_status\(ChildStatus::Degraded/.test(rust) && /복붙 모드로 전환/.test(rust),
    bounded_timeout_kept: /READY_TIMEOUT_MS/.test(rust),
    has_branch_tests: /fn proxy_spawn_origin_branch_is_fixed_literal/.test(rust) && /fn build_proxy_command_branches_without_panic/.test(rust),
  };
  if (!report.has_build_proxy_command) return fail(report, 'no build_proxy_command helper');
  if (!report.spawn_takes_origin) return fail(report, 'spawn_oauth_child does not take a CodexOrigin');
  if (!report.wsl_branch) return fail(report, 'WSL proxy spawn branch missing/incorrect (wsl.exe -- npx openai-oauth --port)');
  if (!report.windows_branch) return fail(report, 'Windows-native proxy spawn branch missing (cmd /C npx …)');
  if (!report.resolves_origin_from_detect) return fail(report, 'oauth_proxy_start does not resolve origin from a read-only detect');
  if (!report.graceful_degrade) return fail(report, 'proxy spawn does not degrade gracefully (Korean 복붙 fallback)');
  if (!report.bounded_timeout_kept) return fail(report, 'ready-timeout bound lost');
  if (!report.has_branch_tests) return fail(report, 'missing proxy origin-branch tests');
  pass(report);
}

// no-authwrite-detect: neither detect nor the proxy spawn writes/reads the auth
// file; zero OS-user-dir tokens; new shell args fixed literals.
async function noAuthWriteDetect() {
  const detect = read('src-tauri/src/codex_detect.rs');
  const oauth = read('src-tauri/src/oauth_child.rs');
  const detectCode = rustCodeOnly(detect);
  const oauthCode = rustCodeOnly(oauth);

  const writeApis = ['File::create', 'fs::write', 'write_all', 'OpenOptions', 'std::fs::write'];
  const detectWriteHits = writeApis.filter((t) => detectCode.includes(t));
  const oauthWriteHits = writeApis.filter((t) => oauthCode.includes(t));

  // Reuse the SINGLE authoritative OS-user-dir pattern from the Rust sentinel.
  const sentinelSrc = read('src-tauri/src/external_dep_paths.rs');
  const sentinelMatch = sentinelSrc.match(/forbidden_pattern_sentinel\(\)[\s\S]*?"([^"]+)"/);
  const sentinelPattern = sentinelMatch ? sentinelMatch[1] : '';
  const osUserDirRe = sentinelPattern ? new RegExp('\\b(' + sentinelPattern + ')\\b') : /$^/;

  const report = {
    scenario: 'no-authwrite-detect',
    sentinel_pattern_loaded: sentinelPattern.length > 0,
    detect_no_write_apis: detectWriteHits.length === 0,
    oauth_no_write_apis: oauthWriteHits.length === 0,
    detect_no_authjson_literal: !/auth\.json/.test(detectCode),
    oauth_no_authjson_literal: !/auth\.json/.test(oauthCode),
    detect_no_os_user_dir_tokens: !osUserDirRe.test(detectCode),
    oauth_no_os_user_dir_tokens: !osUserDirRe.test(oauthCode),
    // detect delegates the only auth-path stat to external_dep_paths.
    detect_delegates_auth: /external_dep_paths::auth_file_present|auth_file_present\(\)/.test(detect),
    // Detect is read-only: login status only, stdio null.
    detect_login_status_only: /"login", "status"/.test(detect) && !/auth_file.*write/i.test(detectCode),
    // New shell calls use fixed literals (no format!-built args).
    no_format_args_detect: !/c\.arg\(format!/.test(detect) && !/c\.args\(\[format!/.test(detect),
    no_format_args_oauth: !/c\.arg\(format!/.test(oauth) && !/c\.args\(\[format!/.test(oauth),
  };
  if (!report.sentinel_pattern_loaded) return fail(report, 'could not load the OS-user-dir sentinel pattern');
  if (!report.detect_no_write_apis) return fail(report, `codex_detect.rs uses a file-write API: ${JSON.stringify(detectWriteHits)}`);
  if (!report.oauth_no_write_apis) return fail(report, `oauth_child.rs uses a file-write API: ${JSON.stringify(oauthWriteHits)}`);
  if (!report.detect_no_authjson_literal) return fail(report, 'codex_detect.rs CODE references auth.json');
  if (!report.oauth_no_authjson_literal) return fail(report, 'oauth_child.rs CODE references auth.json');
  if (!report.detect_no_os_user_dir_tokens) return fail(report, 'codex_detect.rs introduces a forbidden OS-user-dir token');
  if (!report.oauth_no_os_user_dir_tokens) return fail(report, 'oauth_child.rs introduces a forbidden OS-user-dir token');
  if (!report.detect_delegates_auth) return fail(report, 'codex_detect.rs does not delegate the auth-path stat');
  if (!report.detect_login_status_only) return fail(report, 'detect is not strictly login-status read-only');
  if (!report.no_format_args_detect) return fail(report, 'codex_detect.rs builds a probe arg via format! (injection risk)');
  if (!report.no_format_args_oauth) return fail(report, 'oauth_child.rs builds a proxy arg via format! (injection risk)');
  pass(report);
}

// AC-AUTO-EXTRACT-CONFIRM (anti-forgery preserved): the chunk_id validator is
// unchanged-or-stronger and autoExtract still routes through it. We exercise the
// validator: a forged chunk_id is rejected, a real one accepted.
async function evidenceForgeryKept() {
  const { validateResponse } = await import('../src/lib/bridge/responseValidator.ts');
  const known = ['chunk-real-0', 'chunk-real-1'];
  const forged = {
    wiki_candidates: [
      { title: 'F', evidence: [{ chunk_id: 'chunk-FAKE-9', quote: 'q' }] },
    ],
  };
  const realOk = {
    wiki_candidates: [
      { title: 'R', evidence: [{ chunk_id: 'chunk-real-0', quote: 'q' }], confidence: 'high' },
    ],
  };
  const rf = validateResponse(forged, known);
  const rr = validateResponse(realOk, known);
  const report = {
    scenario: 'evidence-forgery-kept',
    forged_not_importable: rf.candidates[0] && rf.candidates[0].importable === false,
    forged_quarantined:
      rf.candidates[0] &&
      Array.isArray(rf.candidates[0].rejectedEvidence) &&
      rf.candidates[0].rejectedEvidence.some((e) => e.claimed_chunk_id === 'chunk-FAKE-9'),
    forged_off_evidence:
      rf.candidates[0] && rf.candidates[0].evidence.every((e) => e.chunk_id !== 'chunk-FAKE-9'),
    real_importable: rr.candidates[0] && rr.candidates[0].importable === true,
    reject_reason_korean:
      rf.candidates[0] && /[가-힣]/.test((rf.candidates[0].violations || []).join(' ')),
  };
  if (!report.forged_not_importable) return fail(report, 'forged chunk_id candidate was importable (anti-forgery weakened)');
  if (!report.forged_quarantined) return fail(report, 'forged ref not quarantined into rejectedEvidence');
  if (!report.forged_off_evidence) return fail(report, 'forged ref leaked onto consumable evidence');
  if (!report.real_importable) return fail(report, 'a real-chunk candidate was not importable');
  if (!report.reject_reason_korean) return fail(report, 'forgery rejection message not Korean');
  pass(report);
}

const scenario = process.argv[2];
const table = {
  // Tier 1
  'detect-win-cmd': detectWinCmd,
  'origin-defaults': originDefaults,
  'usage-auto-setup': usageAutoSetup,
  'auto-extract-prompt': autoExtractPrompt,
  // Tier 2
  'wsl-fallback': wslFallback,
  'proxy-origin': proxyOrigin,
  'no-authwrite-detect': noAuthWriteDetect,
  'evidence-forgery-kept': evidenceForgeryKept,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice9-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
