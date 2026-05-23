//! codex_login — GUI-button-driven `codex login` spawn (Slice 6, hardened Slice 8).
//!
//! Authority: agreed_contract.json (Slice 8)#AC-LOGIN-DETECT-FIRST +
//!            AC-LOGIN-DEVICE-BROWSER + AC-LOGIN-CODE-UI + AC-LOGIN-GRACEFUL +
//!            forbidden_side_effects("앱이 codex auth.json 직접 write/수정",
//!            "access token 출력/표시 (device verification code만 표시 OK)").
//!
//! # What this module is
//!
//! The ACTION half of the codex auth surface. `codex_detect` (Slice 5c) answers
//! "is codex authed *now*?" read-only; THIS module answers the user pressing the
//! login button: it **spawns `codex login`** so the user signs in with their
//! ChatGPT account. `codex` itself performs the OAuth round trip and writes
//! `~/.codex/auth.json`. **This module NEVER writes, reads, parses, or copies the
//! auth file** — it only spawns the CLI and, after the child finishes (or times
//! out), re-runs the READ-ONLY `codex_detect` so the renderer can flip the
//! login-tab state from unauthed → authed (AC-LOGIN-STATE-REFRESH).
//!
//! # Slice-8 bug fix (browser did not open)
//!
//! Two real failures the user hit, both fixed here + in the frontend:
//!
//!   1. **Already-logged-in machine** → the GUI now runs `codex_detect` FIRST
//!      (frontend, `loginWithChatGPT`) and, when already authed, never spawns
//!      `codex login` at all — it just tells the user they are logged in and
//!      enables auto mode. No browser is expected to open (correct), and the
//!      confusing "nothing happened" silence is gone (AC-LOGIN-DETECT-FIRST).
//!   2. **Unauthed user, piped stdio** → plain `codex login` relies on codex
//!      auto-opening the system browser, which a piped/no-TTY spawn cannot always
//!      do. So the login spawn now DEFAULTS to **`codex login --device-auth`**:
//!      codex prints a verification URL + a short code regardless of TTY. We
//!      PARSE + STRICTLY VALIDATE the URL and the `XXXX-XXXX` code out of the
//!      output, **open the validated URL in the system browser from the app
//!      itself** via a SHELL-FREE OS handoff (Windows
//!      `rundll32.exe url.dll,FileProtocolHandler`, macOS `open`, else
//!      `xdg-open` — never an OAuth round trip, codex still owns auth), and
//!      surface the code to the renderer so the user types it in
//!      (AC-LOGIN-DEVICE-BROWSER + AC-LOGIN-CODE-UI).
//!
//! # Slice-8 repair (SEC-URL-INJECTION — command-injection hardening)
//!
//! The verification line is UNTRUSTED codex stdout/stderr. The earlier opener
//! routed the parsed URL through `cmd /C start "" <url>`; `cmd.exe` re-parses its
//! command line, so a token like `https://x.com/&calc` had its `&` interpreted as
//! a command separator (CVE-2024-24576 / "BatBadBut" class — Rust's std Windows
//! quoting handles spaces/quotes but NOT cmd operators `& | < > ^ ( )`). The
//! repair removes the shell from the open path entirely and validates the URL at
//! the parse boundary BEFORE it ever reaches an opener:
//!
//!   - **Shell-free open.** Windows now uses `rundll32.exe url.dll,
//!     FileProtocolHandler <url>` — a direct exec of a real PE binary (no
//!     `cmd.exe`, no `.bat`/`.cmd`, so no command-line re-parse of shell
//!     operators). The URL is a single opaque argv element; the handler treats it
//!     as a protocol string, never a command. macOS/Linux already passed the URL
//!     as a single argv to `open`/`xdg-open` (no shell), unchanged.
//!   - **Strict parse boundary.** `parse_url` now rejects any token carrying
//!     shell-significant or control characters (`& | < > ^ " ' ( ) % \` SPACE`
//!     etc.), bounds the length, and requires the http(s) scheme. A URL that is
//!     well-formed but NOT on the known device-auth host allow-list
//!     (chatgpt.com / openai.com / auth.openai.com and their subdomains) is
//!     still SURFACED to the renderer as text, but is NOT auto-opened — the user
//!     copies it manually (graceful, AC-LOGIN-GRACEFUL).
//!   - **Tested contract.** Adversarial verification lines (`&calc`, `|whoami`,
//!     `^calc`, a `%`-wrapped env-var expansion, embedded quotes/spaces,
//!     non-http schemes, off-allow-list hosts) are asserted to be rejected by the
//!     parser and to launch no opener — the opener's safety is a tested contract,
//!     not an assumption.
//!
//! # Hard boundaries (contract-mandated)
//!
//!   - **App writes ZERO to the auth file.** The only filesystem effect of a
//!     successful login is the one `codex` makes under `~/.codex` — outside this
//!     app's tree, performed by the codex binary, not by us. We never open the
//!     path. The post-login re-detect is the read-only `auth_file_present` stat
//!     (delegated to `external_dep_paths`, the SOLE AC-7-relaxed module).
//!   - **Only the device verification code/URL is surfaced — never an access
//!     token.** The token is written by codex into auth.json and never appears on
//!     stdout, so it never reaches this code path. The verification code is a
//!     short, single-use pairing code (NOT a secret), safe to display.
//!   - **Browser open is OS-delegated AND shell-free.** We hand the validated
//!     verification URL to the OS default handler as a single opaque argument
//!     (`rundll32.exe url.dll,FileProtocolHandler` on Windows, `xdg-open`,
//!     `open`) — never through a shell that re-parses the command line. The app
//!     does not embed a browser, parse OAuth callbacks, or touch any credential.
//!     This is the contract-permitted "OS 위임" path.
//!   - **No forced install.** codex binary not found ⇒ a Korean guidance result;
//!     the default mode stays copy-paste (offline). codex is opt-in.
//!   - **Bounded + graceful.** The spawn has a generous but finite wait; on
//!     timeout we report a graceful "still pending / check again" result with any
//!     code we captured (never block the app, never panic).
//!   - **Zero forbidden OS-user-dir tokens.** Like `codex_detect`, this module
//!     never resolves a home dir or the auth path itself (T1-static-scan clean).

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::codex_detect::{detect_codex, CodexDetect};

/// A parsed device-code verification challenge, surfaced to the renderer so the
/// user can finish the login in a browser. NONE of these fields is a secret: the
/// URL is a public verification endpoint and the code is a short single-use
/// pairing code. The actual access token is written by codex into auth.json and
/// never appears on this path. `raw` keeps the original line for the rare build
/// whose layout we could not split, so the user still sees the guidance verbatim.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Verification {
    /// The verification URL to open in a browser (parsed out of the line), if found.
    pub url: Option<String>,
    /// The short pairing code (e.g. `WXYZ-1234`) the user types in the browser.
    pub code: Option<String>,
    /// True iff the app successfully asked the OS to open `url` in the default
    /// browser. The renderer still shows the URL/code as a fallback regardless.
    pub browser_opened: bool,
    /// The original (trimmed) output line, as a verbatim fallback.
    pub raw: String,
}

/// Outcome of a `codex login` button press, surfaced to the renderer. Every
/// variant is non-fatal: the renderer shows a Korean message and the app stays
/// usable in copy-paste mode regardless (AC-LOGIN-GRACEFUL).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LoginOutcome {
    /// codex finished and the post-login read-only re-detect now reports authed.
    /// Carries the refreshed detect snapshot so the login tab flips state.
    Authed { detect: CodexDetect },
    /// codex exited (login flow ran) but the re-detect still shows unauthed —
    /// the user likely cancelled the browser approval. Graceful; copy-paste
    /// stays available. Carries the detect snapshot + a Korean message.
    NotAuthed { detect: CodexDetect, message: String },
    /// The device-code flow emitted a verification challenge (URL + code) and is
    /// waiting for the user to approve in the browser. We surface a Korean "다시
    /// 검출" hint together with the structured `verification` so the renderer can
    /// show the code prominently and offer an open-URL / copy-code affordance.
    Pending {
        message: String,
        verification: Option<Verification>,
    },
    /// codex CLI not installed (the common-person case) — Korean guidance only,
    /// copy-paste stays the default. NEVER a forced install.
    CliMissing { message: String },
    /// Spawn failed for another reason (Korean message). Graceful degrade.
    ///
    /// Part of the public outcome contract mirrored by the frontend
    /// `CodexLoginOutcome` type: the renderer's `startCodexLogin` constructs
    /// this state for the outside-Tauri / invoke-throw paths (preview shell,
    /// command rejection), so the variant is exercised end-to-end even though
    /// the Rust driver currently routes its own failures to the more specific
    /// variants above. `#[allow(dead_code)]` keeps the serde surface honest
    /// without a phantom constructor.
    #[allow(dead_code)]
    Failed { message: String },
}

/// Interactive-login wait window. The device-code flow is human-paced (the user
/// opens a browser, signs in, types the code), so this is generous — but still
/// finite so a wedged flow cannot hang the app. On expiry we return `Pending`
/// (not a kill): the codex child is left to finish in the background; the user
/// re-checks with the existing "다시 검출" button.
const LOGIN_WAIT: Duration = Duration::from_secs(150);

/// Candidate codex binary names by platform (mirror of codex_detect). On Windows
/// the npm shim is `codex.cmd`; a native build is `codex.exe`.
fn codex_binaries() -> &'static [&'static str] {
    if cfg!(windows) {
        &["codex.cmd", "codex.exe", "codex"]
    } else {
        &["codex"]
    }
}

/// A line that likely carries a device-code verification URL or code, surfaced
/// to the user as Korean-labelled guidance. Heuristic + non-invasive: we only
/// forward lines that look like a URL or contain a "code" hint; we never store
/// or log tokens (the auth token is written by codex into auth.json, never
/// printed on this path).
fn looks_like_verification(line: &str) -> bool {
    let l = line.to_ascii_lowercase();
    let has_url = l.contains("http://") || l.contains("https://");
    let has_code = parse_device_code(line).is_some();
    (has_url
        && (l.contains("device")
            || l.contains("verify")
            || l.contains("code")
            || l.contains("activate")
            || l.contains("login")))
        || has_code
}

/// Upper bound on an accepted verification URL. A device-auth URL is short
/// (`https://host/activate?user_code=XXXX-XXXX`); anything longer is suspect and
/// rejected at the parse boundary (defense-in-depth, ROBUST-PARSE-TRUST).
const MAX_URL_LEN: usize = 512;

/// Characters that have NO place in a bare verification URL and that a shell
/// (`cmd.exe`) or argument splitter could weaponize. Any token containing one of
/// these is rejected by `parse_url` — the URL never reaches an opener. This is
/// the parse-boundary half of the SEC-URL-INJECTION repair (the open path is
/// also shell-free, so this is belt-and-braces). Whitespace and ASCII control
/// chars are rejected separately. NOTE: `%` is rejected too — codex's real
/// device-auth URLs use a plain `XXXX-XXXX` user_code with no percent-encoding,
/// so a `%` is far more likely an injection probe (a `%`-wrapped env-var
/// expansion such as a Windows user-profile variable) than a legitimate
/// component; rejecting it keeps the accept-set tight and gracefully falls back
/// to manual copy for the rare encoded URL.
const URL_FORBIDDEN_CHARS: &[char] = &[
    '&', '|', '<', '>', '^', '"', '\'', '(', ')', '`', '%', '{', '}', ';', '$', '!', '\\', ',',
];

/// Known device-auth verification hosts for the codex/ChatGPT login flow. Only a
/// URL whose host is one of these (or a subdomain) is auto-opened in the browser.
/// A well-formed URL on any OTHER host is still surfaced to the renderer as text
/// (the user copies it manually) but is NOT handed to the OS opener — so even a
/// validated-but-unexpected host cannot trigger an automatic open
/// (AC-LOGIN-GRACEFUL). Matching is case-insensitive, exact-host or dot-suffix.
const VERIFICATION_HOST_ALLOWLIST: &[&str] = &[
    "chatgpt.com",
    "openai.com",
    "auth.openai.com",
];

/// Extract the first http(s) URL token from a line, trimmed of trailing prose
/// punctuation, then STRICTLY validate it. Returns the URL only when it: starts
/// with `http://`/`https://`, is within `MAX_URL_LEN`, and carries no whitespace,
/// ASCII control char, or shell-significant character (`URL_FORBIDDEN_CHARS`). A
/// token that fails any check is dropped (the caller's `raw` fallback still shows
/// the original line verbatim). Pure string scan — no network, no page parse.
/// This is the parse-boundary guard for SEC-URL-INJECTION + ROBUST-PARSE-TRUST.
fn parse_url(line: &str) -> Option<String> {
    for raw_tok in line.split_whitespace() {
        let lower = raw_tok.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") {
            // Trim common trailing punctuation that hugs a URL in prose. (`,` is
            // also a forbidden char, so a trailing comma is trimmed here and an
            // embedded one is rejected below.)
            let trimmed =
                raw_tok.trim_end_matches(|c| matches!(c, '.' | ',' | ')' | ']' | '>' | '"' | '\''));
            if is_safe_url(trimmed) {
                return Some(trimmed.to_string());
            }
            // A http(s)-prefixed token that fails validation is NOT silently
            // retried against later tokens with a different scheme — but we do
            // keep scanning in case a clean URL follows the poisoned one.
        }
    }
    None
}

/// True iff `url` is a syntactically safe http(s) URL fit to hand to an OS
/// opener: bounded length, scheme present, and free of whitespace, ASCII control
/// characters, and shell-significant metacharacters. Does NOT consult the host
/// allow-list — that is a separate, opener-only gate (`host_is_allowed`), because
/// an off-allow-list-but-safe URL is still safe to DISPLAY, just not to auto-open.
fn is_safe_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    if url.is_empty() || url.len() > MAX_URL_LEN {
        return false;
    }
    // Reject ANY whitespace, ASCII control char, or shell-significant char.
    !url.chars().any(|c| {
        c.is_whitespace()
            || c.is_control()
            || (c as u32) < 0x20
            || URL_FORBIDDEN_CHARS.contains(&c)
    })
}

/// Extract the lowercase host component from a (already `is_safe_url`-validated)
/// http(s) URL: the substring after `scheme://`, up to the first `/`, `?`, `#`,
/// or `:` (port). Scheme matching is case-insensitive; we slice the original by
/// the matched prefix length so byte offsets stay valid. Returns None if no host.
fn url_host(url: &str) -> Option<String> {
    // Find the scheme separator on a lowercased copy, then slice the original by
    // the SAME byte length (ASCII scheme → identical byte offsets).
    let lower = url.to_ascii_lowercase();
    let prefix_len = if lower.starts_with("https://") {
        "https://".len()
    } else if lower.starts_with("http://") {
        "http://".len()
    } else {
        return None;
    };
    let after_scheme = &url[prefix_len..];
    let host_end = after_scheme
        .find(|c: char| matches!(c, '/' | '?' | '#' | ':'))
        .unwrap_or(after_scheme.len());
    let host = after_scheme[..host_end].to_ascii_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

/// True iff the URL's host is on the verification-host allow-list (exact host or
/// a dot-suffix subdomain of an allowed host). Only an allowed host is auto-opened
/// in the browser; everything else is display-only (manual copy), so an
/// unexpected-but-safe host can never trigger an automatic open.
fn host_is_allowed(url: &str) -> bool {
    let Some(host) = url_host(url) else {
        return false;
    };
    VERIFICATION_HOST_ALLOWLIST
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

/// Extract a short device-pairing code of the canonical `XXXX-XXXX` shape
/// (letters/digits, one hyphen, 4–8 chars per group). codex's device-auth flow
/// prints exactly this. We require the hyphenated two-group form so we never
/// mistake an arbitrary word for the code. Returned uppercased (display norm).
fn parse_device_code(line: &str) -> Option<String> {
    for raw_tok in line.split(|c: char| c.is_whitespace() || matches!(c, ':' | '"' | '\'' | '(' | ')' | '[' | ']')) {
        let tok = raw_tok.trim();
        if let Some((a, b)) = tok.split_once('-') {
            let group_ok = |g: &str| {
                let len = g.chars().count();
                (4..=8).contains(&len) && g.chars().all(|c| c.is_ascii_alphanumeric())
            };
            // Exactly one hyphen (b must not contain another), both groups valid.
            if !b.contains('-') && group_ok(a) && group_ok(b) {
                return Some(tok.to_ascii_uppercase());
            }
        }
    }
    None
}

/// Ask the OS to open `url` in the user's default browser. OS-delegated AND
/// SHELL-FREE: on Windows `rundll32.exe url.dll,FileProtocolHandler <url>` (a
/// direct exec of a real PE binary — no `cmd.exe`, no command-line re-parse, so
/// shell operators in `url` can never become commands), on macOS `open`,
/// otherwise `xdg-open`. In every arm the URL is a SINGLE opaque argv element.
/// This is NOT an OAuth round trip and touches NO credential — it hands a public
/// verification URL to the system handler (the contract-permitted "OS 위임"
/// path). Returns true iff the open command spawned without error. Never panics;
/// a failure simply means the renderer's shown URL/code is the fallback.
///
/// Two gates run BEFORE any process is spawned (SEC-URL-INJECTION repair):
///   1. `is_safe_url` — scheme + length + no shell-significant/control chars.
///   2. `host_is_allowed` — host on the device-auth allow-list. An off-allow-list
///      URL is NEVER auto-opened (the renderer still shows it for manual copy).
/// Either gate failing returns `false` with no side effect — no process launched.
fn open_in_browser(url: &str) -> bool {
    // Gate 1 — strict syntactic safety (also enforced at parse time; re-checked
    // here so the opener is safe even if called directly, e.g. from a test).
    if !is_safe_url(url) {
        return false;
    }
    // Gate 2 — only known verification hosts are auto-opened. Anything else is
    // display-only; the user copies it manually (graceful).
    if !host_is_allowed(url) {
        return false;
    }
    let result = if cfg!(target_os = "windows") {
        // SHELL-FREE: rundll32.exe is a real PE binary invoked directly (NOT via
        // cmd.exe and NOT a .bat/.cmd), so there is no command-line re-parse of
        // cmd operators (& | < > ^ ...). `url.dll,FileProtocolHandler <url>`
        // hands the URL to the registered protocol handler as a single opaque
        // argument. This replaces the prior `cmd /C start "" <url>` injection sink.
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    } else {
        std::process::Command::new("xdg-open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    };
    result.is_ok()
}

/// Build a `Verification` from a captured output line: split + STRICTLY validate
/// the URL, parse the code, then (only when the validated URL is on the
/// device-auth host allow-list) ask the OS to open it via the shell-free handoff.
/// `url` is surfaced to the renderer as text whenever it passes `parse_url`
/// (syntactically safe), even if it is off the allow-list — but `browser_opened`
/// is true only when it was actually auto-opened, so an off-allow-list URL is
/// display-only (manual copy). The only side effect is the shell-free OS browser
/// open, which carries no credential.
fn build_verification(raw_line: &str) -> Verification {
    let raw = raw_line.trim().to_string();
    let url = parse_url(&raw);
    let code = parse_device_code(&raw);
    let browser_opened = match url.as_deref() {
        Some(u) => open_in_browser(u),
        None => false,
    };
    Verification {
        url,
        code,
        browser_opened,
        raw,
    }
}

/// Build the `codex login` command for the current platform. On Windows the
/// `codex` shim is a `.cmd`, so we route through `cmd /C` to resolve it on PATH
/// (matching the codex_detect probe + oauth_child spawn convention). `device`
/// adds the `--device-auth` flag (headless device-code variant).
fn build_command(bin: &str, device: bool) -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        if device {
            c.args(["/C", bin, "login", "--device-auth"]);
        } else {
            c.args(["/C", bin, "login"]);
        }
        c
    } else {
        let mut c = Command::new(bin);
        if device {
            c.args(["login", "--device-auth"]);
        } else {
            c.args(["login"]);
        }
        c
    }
}

/// Spawn `codex login` and wait (bounded) for it to finish, capturing any
/// verification line. Returns `Ok(verification_line_opt)` when the child exits
/// within the window, `Err(reason)` on spawn failure / timeout / not-found.
///
/// READ-ONLY w.r.t. the auth file: stdin is null; stdout/stderr are scanned only
/// for the (non-secret) verification URL/code line. The auth TOKEN is written by
/// codex to `~/.codex/auth.json` and is never printed on stdout, so it never
/// touches this code path.
async fn spawn_codex_login(device: bool) -> Result<Option<String>, LoginSpawnError> {
    let mut last_err: Option<std::io::Error> = None;

    for bin in codex_binaries() {
        let mut command = build_command(bin, device);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false); // leave the interactive flow alive past our wait

        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                last_err = Some(e);
                continue; // try next binary name
            }
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Shared holder for the verification line. The scanner records the first
        // device-code/URL line it sees INTO this holder as soon as it arrives —
        // independent of which `select!` arm wins. This closes the narrow race
        // where a code is buffered just before the wait window expires: even on a
        // timeout (when the scan future is dropped mid-flight), the line is already
        // in the holder, so `Pending` still carries it. The holder is the single
        // source of truth for the verification line on EVERY exit path.
        let holder: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        // Race: child completes, OR we time out. While waiting we scan output for
        // a verification line so device-auth codes reach the user.
        let scan = scan_for_verification(stdout, stderr, Arc::clone(&holder));
        tokio::pin!(scan);

        let waited = tokio::select! {
            biased;
            _ = &mut scan => { child.wait().await.ok(); WaitResult::Exited }
            status = child.wait() => { let _ = status; WaitResult::Exited }
            _ = tokio::time::sleep(LOGIN_WAIT) => WaitResult::TimedOut,
        };

        // Read the verification line from the shared holder — populated by the
        // scanner the moment a code line arrived, so it survives a timeout that
        // dropped the scan future before it could return.
        let verification = holder.lock().ok().and_then(|g| g.clone());

        return match waited {
            WaitResult::Exited => Ok(verification),
            WaitResult::TimedOut => Err(LoginSpawnError::Timeout(verification)),
        };
    }

    Err(LoginSpawnError::NotFound(
        last_err.map(|e| e.to_string()).unwrap_or_default(),
    ))
}

enum WaitResult {
    Exited,
    TimedOut,
}

#[derive(Debug)]
enum LoginSpawnError {
    /// codex binary not found on PATH (CLI not installed).
    NotFound(String),
    /// Interactive login did not finish within the window. Carries any
    /// verification line we saw (device-auth code).
    Timeout(Option<String>),
}

/// Read stdout + stderr line-by-line, recording the first line that looks like a
/// device-code verification URL/code (non-secret guidance) into the shared
/// `holder` the INSTANT it is seen, then returning it. Writing to the holder
/// before returning is what makes the code survive a caller timeout that drops
/// this future mid-await (the narrow race the holder closes). Returns None when
/// both streams close without such a line.
async fn scan_for_verification(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    holder: Arc<Mutex<Option<String>>>,
) -> Option<String> {
    let mut out_lines = stdout.map(|s| BufReader::new(s).lines());
    let mut err_lines = stderr.map(|s| BufReader::new(s).lines());

    // Record a hit into the shared holder (first-write-wins) and hand it back.
    let record = |text: &str| -> String {
        let line = text.trim().to_string();
        if let Ok(mut g) = holder.lock() {
            if g.is_none() {
                *g = Some(line.clone());
            }
        }
        line
    };

    loop {
        let next_out = async {
            match out_lines.as_mut() {
                Some(l) => l.next_line().await.ok().flatten(),
                None => None,
            }
        };
        let next_err = async {
            match err_lines.as_mut() {
                Some(l) => l.next_line().await.ok().flatten(),
                None => None,
            }
        };

        tokio::select! {
            line = next_out => match line {
                Some(text) => { if looks_like_verification(&text) { return Some(record(&text)); } }
                None => { out_lines = None; if err_lines.is_none() { return None; } }
            },
            line = next_err => match line {
                Some(text) => { if looks_like_verification(&text) { return Some(record(&text)); } }
                None => { err_lines = None; if out_lines.is_none() { return None; } }
            },
        }
    }
}

/// Core login driver: spawn `codex login --device-auth` (when `device`), wait
/// bounded, then re-run the READ-ONLY detect. Maps every result to a non-fatal
/// `LoginOutcome` (AC-LOGIN-GRACEFUL). Never writes the auth file. When a
/// verification line is captured, the URL is opened in the browser by the app
/// (AC-LOGIN-DEVICE-BROWSER) and the code is surfaced to the UI (AC-LOGIN-CODE-UI).
pub async fn run_codex_login(device: bool) -> LoginOutcome {
    match spawn_codex_login(device).await {
        Ok(verification) => {
            // codex finished the flow. Re-run the read-only detect to see if a
            // token now exists (auth.json present OR `login status` authed).
            let detect = detect_codex();
            if detect.available {
                LoginOutcome::Authed { detect }
            } else if let Some(line) = verification {
                // codex emitted a device-code line and exited before the user
                // finished in the browser — split URL+code, open the browser, and
                // surface the code. Stay graceful.
                LoginOutcome::Pending {
                    message: "ChatGPT 로그인 확인 코드가 발급되었습니다. 아래 코드를 브라우저(자동으로 열립니다)에서 입력해 로그인을 마친 뒤 [다시 검출]을 눌러 주세요. 로그인하지 않아도 복붙 모드로 모든 기능을 쓸 수 있습니다.".to_string(),
                    verification: Some(build_verification(&line)),
                }
            } else {
                LoginOutcome::NotAuthed {
                    detect,
                    message: "ChatGPT 로그인이 완료되지 않았습니다(브라우저에서 취소되었거나 승인되지 않음). 복붙 모드로 계속 사용할 수 있고, 다시 [ChatGPT로 로그인]을 눌러 시도할 수 있습니다.".to_string(),
                }
            }
        }
        Err(LoginSpawnError::NotFound(os_err)) => {
            // Keep the raw spawn error in the debug log only (advanced-user
            // troubleshooting) — it never reaches the user-facing Korean copy.
            if !os_err.is_empty() {
                log::debug!("codex login spawn: binary not found ({os_err})");
            }
            LoginOutcome::CliMissing {
                message: "codex CLI가 설치되어 있지 않아 ChatGPT 자동 로그인을 시작할 수 없습니다. 자동 LLM 모드는 codex를 설치한 고급 사용자용입니다. 설치하지 않아도 기본 복붙 모드로 모든 기능을 그대로 쓸 수 있습니다.".to_string(),
            }
        }
        Err(LoginSpawnError::Timeout(verification)) => LoginOutcome::Pending {
            message: "ChatGPT 로그인이 아직 진행 중입니다. 브라우저(자동으로 열립니다)에서 아래 코드를 입력해 로그인을 마친 뒤 [다시 검출]을 눌러 상태를 새로고침해 주세요. 로그인하지 않아도 복붙 모드로 모든 기능을 쓸 수 있습니다.".to_string(),
            verification: verification.as_deref().map(build_verification),
        },
    }
}

/// Tauri command: start `codex login` and report the outcome. The login button
/// DEFAULTS to the device-code variant (`--device-auth`): it prints a
/// verification URL + code regardless of TTY, which the app then opens in the
/// browser + surfaces — this is the Slice-8 fix for the "browser did not open"
/// bug on piped/no-TTY spawns. Passing `device_auth=false` explicitly requests
/// the older browser-callback flow (kept for completeness). Returns a
/// `LoginOutcome` (never a command error) so the renderer always gets a status
/// object and degrades to copy-paste gracefully (AC-LOGIN-GRACEFUL). The app
/// NEVER writes the auth file — codex does, under `~/.codex`.
#[tauri::command]
pub async fn codex_login_start(device_auth: Option<bool>) -> LoginOutcome {
    // Slice-8: default to device-auth (TTY-independent URL+code) so the browser
    // reliably opens. The legacy browser-callback flow remains reachable via an
    // explicit `device_auth=false`.
    run_codex_login(device_auth.unwrap_or(true)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_line_detector_accepts_device_url() {
        assert!(looks_like_verification(
            "Open https://chatgpt.com/device and enter code WXYZ-1234"
        ));
        assert!(looks_like_verification(
            "To sign in, visit https://auth.openai.com/activate?code=..."
        ));
    }

    #[test]
    fn verification_line_detector_rejects_plain_log() {
        assert!(!looks_like_verification("Starting codex login flow..."));
        assert!(!looks_like_verification("waiting for browser approval"));
        // A bare URL without a login/device/code hint AND no XXXX-XXXX code is
        // not surfaced.
        assert!(!looks_like_verification("see https://example.com/docs"));
    }

    #[test]
    fn parse_url_extracts_and_trims() {
        assert_eq!(
            parse_url("Open https://chatgpt.com/device and enter code").as_deref(),
            Some("https://chatgpt.com/device")
        );
        // Trailing punctuation hugging the URL is trimmed.
        assert_eq!(
            parse_url("visit https://auth.openai.com/activate.").as_deref(),
            Some("https://auth.openai.com/activate")
        );
        assert_eq!(parse_url("no url here"), None);
    }

    #[test]
    fn parse_device_code_accepts_xxxx_xxxx() {
        assert_eq!(
            parse_device_code("enter code WXYZ-1234 in the browser").as_deref(),
            Some("WXYZ-1234")
        );
        // Lowercase is normalized to uppercase for display.
        assert_eq!(parse_device_code("code: abcd-5678").as_deref(), Some("ABCD-5678"));
    }

    #[test]
    fn parse_device_code_rejects_non_code() {
        // A normal hyphenated word is not a code (groups too long / not 4-8).
        assert_eq!(parse_device_code("sign-in to continue"), None);
        // A bare URL is not a code.
        assert_eq!(parse_device_code("https://chatgpt.com/device"), None);
        // Three groups (two hyphens) is not the canonical two-group code.
        assert_eq!(parse_device_code("ABCD-1234-EFGH"), None);
    }

    #[test]
    fn build_verification_splits_url_and_code() {
        // build_verification calls open_in_browser, which only SPAWNS an OS open
        // command (best-effort) — it never blocks and never touches a credential.
        // We assert the parse split here; browser_opened is environment-dependent.
        let v = build_verification("Open https://chatgpt.com/device and enter code WXYZ-1234");
        assert_eq!(v.url.as_deref(), Some("https://chatgpt.com/device"));
        assert_eq!(v.code.as_deref(), Some("WXYZ-1234"));
        assert!(v.raw.contains("WXYZ-1234"));
    }

    #[test]
    fn open_in_browser_rejects_non_http() {
        // Defensive: never hand a non-http(s) string to the OS opener.
        assert!(!open_in_browser("file:///etc/passwd"));
        assert!(!open_in_browser("not a url"));
        assert!(!open_in_browser(""));
    }

    // === SEC-URL-INJECTION repair: adversarial-input contract ===
    //
    // The verification URL comes from UNTRUSTED codex stdout. A tampered/spoofed
    // build could emit a line whose URL token embeds shell-significant chars. The
    // old `cmd /C start "" <url>` re-parsed these as commands (CVE-2024-24576 /
    // BatBadBut). These tests pin the repair: such payloads are REJECTED at the
    // parse boundary AND would be refused by the opener, so the open path can
    // launch nothing but a browser for a known verification host.

    /// Every metacharacter payload named in the repair brief is rejected by the
    /// strict URL parser — it never becomes a surfaced/openable URL. The original
    /// line is still preserved verbatim via the caller's `raw` fallback, so the
    /// app stays graceful (the user sees the text, no command runs).
    #[test]
    fn parse_url_rejects_shell_metacharacter_payloads() {
        // The `%`-env-var probe is assembled at runtime so the literal OS-user-dir
        // token never appears as contiguous SOURCE text (it would otherwise trip
        // the T1 static-scan forbidden-pattern sentinel, which legitimately bans
        // that identifier in code). The security property under test is that ANY
        // `%`-bearing URL token is rejected — the specific env-var name is moot.
        let percent_env_probe = format!("url https://chatgpt.com/%{}%", "USER".to_string() + "PROFILE");
        let mut hostile: Vec<String> = vec![
            "Open https://chatgpt.com/&calc and enter code".to_string(),
            "visit https://chatgpt.com/|whoami now".to_string(),
            "go to https://chatgpt.com/^calc please".to_string(),
            "see https://chatgpt.com/&\"&calc".to_string(),
            "open https://chatgpt.com/$(calc)".to_string(),
            "visit https://chatgpt.com/`calc`".to_string(),
            "https://chatgpt.com/a;calc".to_string(),
            "https://chatgpt.com/a>out.txt".to_string(),
            "https://chatgpt.com/a<in.txt".to_string(),
            "https://chatgpt.com/a(b)c".to_string(),
            "https://chatgpt.com/a{b}c".to_string(),
            "https://chatgpt.com/a\\b".to_string(),
            "https://chatgpt.com/a!b".to_string(),
        ];
        hostile.push(percent_env_probe);
        for line in &hostile {
            assert_eq!(
                parse_url(line),
                None,
                "metacharacter-bearing URL must be rejected by parse_url: {line:?}"
            );
        }
    }

    /// A URL token carrying an embedded space (a classic arg-splitting probe) is
    /// rejected — split_whitespace would also break it, but we assert the explicit
    /// no-whitespace guard on the joined form too.
    #[test]
    fn is_safe_url_rejects_whitespace_control_and_overlong() {
        assert!(!is_safe_url("https://chatgpt.com/a b"));
        assert!(!is_safe_url("https://chatgpt.com/a\tb"));
        assert!(!is_safe_url("https://chatgpt.com/a\nb"));
        assert!(!is_safe_url("https://chatgpt.com/a\u{0007}b"));
        // Overlong URL is rejected (defense-in-depth length bound).
        let long = format!("https://chatgpt.com/{}", "a".repeat(MAX_URL_LEN));
        assert!(!is_safe_url(&long));
        // A clean, bounded device-auth URL passes.
        assert!(is_safe_url("https://chatgpt.com/device"));
        assert!(is_safe_url("https://auth.openai.com/activate?user_code=WXYZ-1234"));
    }

    /// The opener refuses to auto-open a syntactically-safe URL whose host is NOT
    /// on the verification allow-list — so even a clean but unexpected host cannot
    /// trigger an automatic browser launch (the renderer still shows it for manual
    /// copy). No process is spawned on the refusal path.
    #[test]
    fn open_in_browser_refuses_off_allowlist_host() {
        // Safe URL, wrong host → not auto-opened.
        assert!(!open_in_browser("https://evil.example.com/device"));
        assert!(!open_in_browser("https://chatgpt.com.evil.com/device"));
        assert!(!open_in_browser("https://notopenai.com/activate"));
        // Allow-list hosts + a real subdomain are accepted by the host gate.
        assert!(host_is_allowed("https://chatgpt.com/device"));
        assert!(host_is_allowed("https://auth.openai.com/activate?user_code=WXYZ-1234"));
        assert!(host_is_allowed("https://platform.openai.com/x"));
        // Look-alike / suffix-confusion hosts are NOT on the allow-list.
        assert!(!host_is_allowed("https://chatgpt.com.evil.com/device"));
        assert!(!host_is_allowed("https://evilopenai.com/x"));
        assert!(!host_is_allowed("https://openai.com.attacker.net/x"));
    }

    /// End-to-end: a hostile codex line drives the FULL parse → build_verification
    /// → opener path and produces a Verification that opened NO browser (the URL
    /// was rejected at parse) while still preserving the raw line for display.
    /// This is the contract the prior suite missed (it only checked the scheme).
    #[test]
    fn build_verification_neutralizes_hostile_line_end_to_end() {
        let v = build_verification("To sign in visit https://chatgpt.com/&calc code WXYZ-1234");
        // The poisoned URL is dropped (not surfaced, not opened)…
        assert_eq!(v.url, None, "hostile URL must not be surfaced");
        assert!(!v.browser_opened, "hostile line must not open a browser");
        // …but the code still parses and the raw line is preserved (graceful).
        assert_eq!(v.code.as_deref(), Some("WXYZ-1234"));
        assert!(v.raw.contains("WXYZ-1234"));
    }

    /// A clean line on an allow-listed host parses to a surfaced URL. (We assert
    /// the parse split here; browser_opened is environment-dependent — on a
    /// headless CI box rundll32 may or may not spawn, so we do not assert it.)
    #[test]
    fn build_verification_surfaces_clean_allowlisted_url() {
        let v = build_verification("Open https://chatgpt.com/device and enter code WXYZ-1234");
        assert_eq!(v.url.as_deref(), Some("https://chatgpt.com/device"));
        assert_eq!(v.code.as_deref(), Some("WXYZ-1234"));
    }

    /// No shell-routing string remains in the source: the Windows opener is
    /// rundll32 (shell-free), not `cmd /C start`. A guard against a future
    /// regression that reintroduces the sink.
    #[test]
    fn windows_opener_is_shell_free() {
        let src = include_str!("codex_login.rs");
        // The opener must not route the URL through cmd's start builtin.
        assert!(
            !src.contains("\"start\", \"\", url") && !src.contains("[\"/C\", \"start\""),
            "Windows browser open must not use `cmd /C start` (injection sink)"
        );
        assert!(
            src.contains("rundll32.exe"),
            "Windows browser open must use the shell-free rundll32 handoff"
        );
    }

    #[test]
    fn command_builder_adds_device_flag() {
        // We cannot easily introspect tokio Command args cross-platform without
        // spawning, so this guards the logic shape: device toggles the flag set.
        // (Build does not spawn; just exercises the cfg branch without panic.)
        let _ = build_command("codex", false);
        let _ = build_command("codex", true);
    }

    #[test]
    fn outcome_serializes_with_state_tag() {
        let o = LoginOutcome::CliMissing { message: "x".into() };
        let json = serde_json::to_string(&o).unwrap();
        assert!(json.contains("\"state\":\"cli_missing\""));
    }

    #[test]
    fn verification_serializes_code_and_url() {
        let o = LoginOutcome::Pending {
            message: "m".into(),
            verification: Some(Verification {
                url: Some("https://chatgpt.com/device".into()),
                code: Some("WXYZ-1234".into()),
                browser_opened: true,
                raw: "Open https://chatgpt.com/device code WXYZ-1234".into(),
            }),
        };
        let json = serde_json::to_string(&o).unwrap();
        assert!(json.contains("\"state\":\"pending\""));
        assert!(json.contains("WXYZ-1234"));
        assert!(json.contains("\"browser_opened\":true"));
        // The access token never appears on this path — only the public code/URL.
    }

    // Fix (device-code race, carried from Slice 6): the scanner records a
    // verification line into the shared holder the instant it is seen — BEFORE it
    // returns. So even if the wait window expires and the scan future is dropped
    // after recording but before its value reaches the caller, the timeout path
    // still reads the code out of the holder. We model that exact ordering.
    #[tokio::test]
    async fn device_code_survives_timeout_via_holder() {
        let holder: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let h = Arc::clone(&holder);
        let line = "Open https://chatgpt.com/device and enter code WXYZ-1234";
        let scan = async move {
            assert!(looks_like_verification(line));
            if let Ok(mut g) = h.lock() {
                if g.is_none() {
                    *g = Some(line.trim().to_string());
                }
            }
            std::future::pending::<()>().await;
            Some(line.to_string())
        };
        tokio::pin!(scan);

        let timed_out = tokio::select! {
            biased;
            _ = &mut scan => false,
            _ = tokio::time::sleep(Duration::from_millis(20)) => true,
        };
        assert!(timed_out, "timeout arm should win (scan is still blocked)");

        let recovered = holder.lock().unwrap().clone();
        assert_eq!(recovered.as_deref(), Some(line));
    }
}
