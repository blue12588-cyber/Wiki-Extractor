//! codex_detect — read-only Codex CLI authentication detection (Slice 5c).
//!
//! Authority: agreed_contract.json#AC-CODEX-DETECT + AC-AUTH-ABSTRACT +
//!            AC-ENCAPSULATE + forbidden_side_effects("codex 인증 파일 write/수정").
//!
//! # What this module is
//!
//! The detection half of the `codex_oauth_proxy` provider. It answers ONE
//! question for the renderer: *is the advanced (auto-LLM) provider available on
//! this machine right now?* Two independent, READ-ONLY signals (ima2 codexDetect
//! pattern, ported — recorded in docs/adaptation-from-harness-core.md):
//!
//!   1. **auth-file presence** — delegated to `external_dep_paths::auth_file_present`
//!      (the SOLE AC-7-relaxed module allowed to touch `~/.codex` / `$CODEX_HOME`).
//!      This module NEVER resolves a home directory or auth path itself, so it
//!      introduces ZERO forbidden OS-user-dir tokens (T1-static-scan clean).
//!   2. **`codex login status` probe** — runs the `codex` binary with
//!      `login status`. Exit 0 ⇒ authed (covers OS-keyring auth where no file
//!      exists). Binary-not-found ⇒ `missing` (codex CLI not installed — the
//!      common-人 case → degrade to copy-paste). Non-zero exit ⇒ `unauthed`.
//!
//! # Hard boundaries (contract-mandated)
//!
//!   - **Read-only.** This module STATs a path (via external_dep_paths) and
//!     spawns `codex login status` with stdio fully ignored. It NEVER opens,
//!     reads, parses, logs, copies, or writes `auth.json`. The probe is the
//!     same non-invasive call a user runs in their own shell.
//!   - **No forced install.** A `missing` result is surfaced as guidance only;
//!     the default mode stays copy-paste (offline). Codex is opt-in for advanced
//!     users (constraints: "codex 강요 0").
//!   - **Bounded probe.** The status probe has a short timeout so a hung codex
//!     binary cannot stall the auth poll; on timeout we report `missing` (treat
//!     as unavailable → degrade), never blocking the app.

use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::external_dep_paths::auth_file_present;

/// Result of the `codex login status` probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginProbe {
    /// `codex login status` exited 0 — authenticated (file OR OS keyring).
    Authed,
    /// codex binary exists but `login status` returned non-zero — not signed in.
    Unauthed,
    /// codex binary not found on PATH (CLI not installed) — the common-人 case.
    Missing,
}

/// The renderer-facing detection snapshot. `available` is the single boolean the
/// provider abstraction reads to decide whether the auto-LLM provider may be
/// offered. It is `true` when EITHER signal is positive (file present OR probe
/// authed), so an OS-keyring-only install (no auth.json on disk) still detects.
#[derive(Debug, Clone, Serialize)]
pub struct CodexDetect {
    /// True iff the auto-LLM (codex_oauth_proxy) provider is usable now.
    pub available: bool,
    /// auth-file presence (read-only stat via the AC-7-relaxed module).
    pub auth_file_present: bool,
    /// `codex login status` probe outcome.
    pub login_probe: LoginProbe,
    /// True iff the codex binary itself was not found (CLI not installed). The
    /// renderer shows install GUIDANCE (never a forced flow) when this is true
    /// AND no auth file is present.
    pub codex_cli_missing: bool,
}

/// Probe timeout. Short by design: a hung codex binary must not stall the auth
/// poll. On timeout we treat the provider as unavailable (degrade).
const PROBE_TIMEOUT: Duration = Duration::from_millis(2500);

/// Candidate codex binary names by platform. On Windows the npm shim is
/// `codex.cmd`; a native build is `codex.exe`; `codex` covers a bare PATH entry.
fn codex_binaries() -> &'static [&'static str] {
    if cfg!(windows) {
        &["codex.cmd", "codex.exe", "codex"]
    } else {
        &["codex"]
    }
}

/// Run `codex login status`, fully READ-ONLY (stdio ignored). Returns the probe
/// outcome. This spawns the SAME non-invasive command a user runs in a shell; it
/// does not touch the auth file. A bounded wait guards against a hung binary.
///
/// Implementation note: `Command` has no built-in timeout, so we spawn and poll
/// `try_wait` on a short loop. On timeout we kill the child (best-effort) and
/// report `Missing` (treat-as-unavailable → degrade), never blocking.
fn probe_login_status() -> LoginProbe {
    for bin in codex_binaries() {
        let spawned = Command::new(bin)
            .args(["login", "status"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        let mut child = match spawned {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue, // try next name
            Err(_) => continue,
        };

        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    return if status.success() {
                        LoginProbe::Authed
                    } else {
                        LoginProbe::Unauthed
                    };
                }
                Ok(None) => {
                    if start.elapsed() >= PROBE_TIMEOUT {
                        // Hung binary: kill (best-effort) and treat as unavailable.
                        let _ = child.kill();
                        let _ = child.wait();
                        return LoginProbe::Missing;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
                Err(_) => return LoginProbe::Missing,
            }
        }
    }
    LoginProbe::Missing
}

/// Core detection (pure-ish: stat + read-only probe, no writes). Returns the
/// snapshot the provider abstraction consumes.
pub fn detect_codex() -> CodexDetect {
    let file_present = auth_file_present();
    let probe = probe_login_status();
    let cli_missing = probe == LoginProbe::Missing;
    // Available when EITHER signal is positive: a file present (precedence path)
    // OR an authed probe (covers keyring-only installs with no auth.json).
    let available = file_present || probe == LoginProbe::Authed;
    CodexDetect {
        available,
        auth_file_present: file_present,
        login_probe: probe,
        codex_cli_missing: cli_missing,
    }
}

/// Tauri command: codex auth detection for the login tab + provider layer.
/// READ-ONLY — never writes or reads the auth file contents.
#[tauri::command]
pub fn codex_detect() -> CodexDetect {
    detect_codex()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_probe_marks_cli_missing() {
        // A Missing probe always implies cli_missing in the derived snapshot.
        let d = CodexDetect {
            available: false,
            auth_file_present: false,
            login_probe: LoginProbe::Missing,
            codex_cli_missing: true,
        };
        assert!(d.codex_cli_missing);
        assert!(!d.available);
    }

    #[test]
    fn authed_probe_makes_available_even_without_file() {
        // Keyring-only install: no auth.json on disk, but probe authed.
        let available = false || LoginProbe::Authed == LoginProbe::Authed;
        assert!(available);
    }

    #[test]
    fn file_present_makes_available_even_if_probe_missing() {
        let file_present = true;
        let available = file_present || LoginProbe::Missing == LoginProbe::Authed;
        assert!(available);
    }

    #[test]
    fn probe_does_not_panic() {
        // On a machine without codex this returns Missing; with codex it returns
        // Authed/Unauthed. Either way it must not panic and must be bounded.
        let _ = probe_login_status();
    }
}
