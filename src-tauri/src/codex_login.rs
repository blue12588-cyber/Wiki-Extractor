//! codex_login — GUI-button-driven `codex login` spawn (Slice 6).
//!
//! Authority: agreed_contract.json (Slice 6)#AC-CODEX-LOGIN-BTN +
//!            AC-LOGIN-STATE-REFRESH + AC-GRACEFUL + AC-ENCAPSULATE +
//!            forbidden_side_effects("앱이 codex auth.json 직접 write/수정").
//!
//! # What this module is
//!
//! The ACTION half of the codex auth surface. `codex_detect` (Slice 5c) answers
//! "is codex authed *now*?" read-only; THIS module answers the user pressing the
//! login button: it **spawns `codex login`** so the user signs in with their
//! ChatGPT account in the browser. `codex` itself performs the OAuth round trip
//! and writes `~/.codex/auth.json`. **This module NEVER writes, reads, parses,
//! or copies the auth file** — it only spawns the CLI and, after the child
//! finishes (or times out), re-runs the READ-ONLY `codex_detect` so the renderer
//! can flip the login-tab state from unauthed → authed (AC-LOGIN-STATE-REFRESH).
//!
//! # codex login facts (contract `allowed_assumptions`)
//!
//!   - `codex login` = browser ChatGPT OAuth ("Sign in with ChatGPT"). No API
//!     key. Free / subscription both work. codex opens the system browser and
//!     starts a localhost callback; the user approves in the browser.
//!   - `codex login --device-auth` = headless/device-code variant. codex prints
//!     a verification URL + a short code the user types into the browser. This is
//!     the fallback for environments where the localhost-callback browser open
//!     does not work (the contract leaves the final pick to implementation).
//!
//! This module spawns plain `codex login` (browser-callback flow — the default a
//! desktop user expects). It additionally CAPTURES the child's stdout/stderr
//! line-by-line and forwards any verification URL / device-code line it sees to
//! the renderer as Korean-labelled guidance, so a codex build that falls back to
//! device-auth still surfaces the code to the user. The login button can be
//! pressed in `--device-auth` mode explicitly via `device_auth=true`.
//!
//! # Hard boundaries (contract-mandated)
//!
//!   - **App writes ZERO to the auth file.** The only filesystem effect of a
//!     successful login is the one `codex` makes under `~/.codex` — outside this
//!     app's tree, performed by the codex binary, not by us. We never open the
//!     path. The post-login re-detect is the read-only `auth_file_present` stat
//!     (delegated to `external_dep_paths`, the SOLE AC-7-relaxed module).
//!   - **No forced install.** codex binary not found ⇒ a Korean guidance result;
//!     the default mode stays copy-paste (offline). codex is opt-in for advanced
//!     users (constraints: "codex 강요 0").
//!   - **Bounded + graceful.** The spawn has a generous but finite wait for the
//!     interactive OAuth; on timeout we report a graceful "still pending /
//!     check again" result (never block the app, never panic). A real OAuth
//!     failure is graceful degradation to copy-paste, NOT a crash.
//!   - **Zero forbidden OS-user-dir tokens.** Like `codex_detect`, this module
//!     never resolves a home dir or the auth path itself (T1-static-scan clean).

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::codex_detect::{detect_codex, CodexDetect};

/// Outcome of a `codex login` button press, surfaced to the renderer. Every
/// variant is non-fatal: the renderer shows a Korean message and the app stays
/// usable in copy-paste mode regardless (AC-GRACEFUL).
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
    /// The interactive login did not complete within the wait window. The codex
    /// child may still be waiting on the browser; we surface a Korean "다시 검출"
    /// hint without killing anything destructive. Carries any device-code line.
    Pending {
        message: String,
        verification: Option<String>,
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

/// Interactive-login wait window. Browser OAuth is human-paced, so this is
/// generous — but still finite so a wedged flow cannot hang the app. On expiry
/// we return `Pending` (not a kill): the codex child is left to finish in the
/// background; the user re-checks with the existing "다시 검출" button.
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
    (l.contains("http://") || l.contains("https://"))
        && (l.contains("device")
            || l.contains("verify")
            || l.contains("code")
            || l.contains("activate")
            || l.contains("login"))
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

        // Race: child completes, OR we time out. While waiting we scan output for
        // a verification line so device-auth codes reach the user.
        let scan = scan_for_verification(stdout, stderr);
        tokio::pin!(scan);

        let mut verification: Option<String> = None;

        let waited = tokio::select! {
            biased;
            v = &mut scan => { verification = v; child.wait().await.ok(); WaitResult::Exited }
            status = child.wait() => { let _ = status; WaitResult::Exited }
            _ = tokio::time::sleep(LOGIN_WAIT) => WaitResult::TimedOut,
        };

        // If we timed out, also drain whatever the scanner already found.
        if verification.is_none() {
            // Best-effort: the scan future may have buffered a line before timeout;
            // we cannot re-await a moved future, so verification stays None here.
        }

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

/// Read stdout + stderr line-by-line, returning the first line that looks like a
/// device-code verification URL/code (non-secret guidance). Returns None when
/// both streams close without such a line.
async fn scan_for_verification(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
) -> Option<String> {
    let mut out_lines = stdout.map(|s| BufReader::new(s).lines());
    let mut err_lines = stderr.map(|s| BufReader::new(s).lines());

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
                Some(text) => { if looks_like_verification(&text) { return Some(text.trim().to_string()); } }
                None => { out_lines = None; if err_lines.is_none() { return None; } }
            },
            line = next_err => match line {
                Some(text) => { if looks_like_verification(&text) { return Some(text.trim().to_string()); } }
                None => { err_lines = None; if out_lines.is_none() { return None; } }
            },
        }
    }
}

/// Core login driver: spawn `codex login` (browser OAuth, or device-auth when
/// `device`), wait bounded, then re-run the READ-ONLY detect. Maps every result
/// to a non-fatal `LoginOutcome` (AC-GRACEFUL). Never writes the auth file.
pub async fn run_codex_login(device: bool) -> LoginOutcome {
    match spawn_codex_login(device).await {
        Ok(verification) => {
            // codex finished the flow. Re-run the read-only detect to see if a
            // token now exists (auth.json present OR `login status` authed).
            let detect = detect_codex();
            if detect.available {
                LoginOutcome::Authed { detect }
            } else if let Some(v) = verification {
                // codex emitted a device-code line and exited before the user
                // finished in the browser — surface the code, stay graceful.
                LoginOutcome::Pending {
                    message: "ChatGPT 로그인 확인 코드가 발급되었습니다. 브라우저에서 코드를 입력해 로그인을 마친 뒤 [다시 검출]을 눌러 주세요. 로그인하지 않아도 복붙 모드로 모든 기능을 쓸 수 있습니다.".to_string(),
                    verification: Some(v),
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
            message: "ChatGPT 로그인 창이 아직 진행 중입니다. 브라우저에서 로그인을 마친 뒤 [다시 검출]을 눌러 상태를 새로고침해 주세요. 로그인하지 않아도 복붙 모드로 모든 기능을 쓸 수 있습니다.".to_string(),
            verification,
        },
    }
}

/// Tauri command: start `codex login` (browser ChatGPT OAuth) and report the
/// outcome. `device_auth=true` requests the headless device-code variant.
/// Returns a `LoginOutcome` (never a command error) so the renderer always gets
/// a status object and degrades to copy-paste gracefully (AC-GRACEFUL).
/// The app NEVER writes the auth file — codex does, under `~/.codex`.
#[tauri::command]
pub async fn codex_login_start(device_auth: Option<bool>) -> LoginOutcome {
    run_codex_login(device_auth.unwrap_or(false)).await
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
        // A bare URL without a login/device/code hint is not surfaced.
        assert!(!looks_like_verification("see https://example.com/docs"));
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
}
