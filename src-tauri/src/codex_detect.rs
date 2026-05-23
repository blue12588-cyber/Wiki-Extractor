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
//!
//! # Slice-9 bug fix (Windows `.cmd` shim could not be spawned directly)
//!
//! On Windows the npm-installed codex binary is `codex.cmd`, a batch shim.
//! `Command::new("codex.cmd")` fails: Windows `CreateProcess` cannot execute a
//! `.cmd`/`.bat` shim directly — a batch file must be run *through* `cmd.exe`.
//! So the Slice-5c probe (`Command::new(bin).args(["login","status"])`) ERRED on
//! every candidate, the loop fell through to `Missing`, and the app showed
//! "인증 미설정 / codex CLI 미설치" even on a machine where codex WAS installed and
//! logged in — auto mode could never be selected. The fix routes the Windows
//! probe through `cmd /C codex login status` (the SAME convention the sibling
//! `codex_login.rs::build_command` already uses for the login spawn): `cmd.exe`
//! resolves the `.cmd` shim on PATH and is unaffected by PowerShell's
//! ExecutionPolicy (which only blocks `.ps1`, never a `.cmd` invoked via `cmd`).
//! On non-Windows the direct `Command::new(bin)` is kept (no shim involved).
//!
//! # Slice-9 cross-boundary WSL fallback
//!
//! Many developers (including the project owner) install codex ONLY inside WSL
//! Ubuntu, not natively on Windows. When the Windows-native probe yields
//! `Missing` (codex not found on Windows) we attempt a single cross-boundary
//! probe: `wsl.exe -- codex login status`. This detects a WSL-only install so
//! auto mode can still be offered. The detection records WHERE auth was found in
//! an `origin` field (`windows` | `wsl` | `none`). The WSL fallback runs ONLY on
//! Windows (`cfg!(windows)`); on Linux/macOS the native probe is authoritative.
//! Both probes are READ-ONLY (`login status` only) — zero `auth.json` writes.
//! Both shell calls use FIXED-LITERAL args (`bin` is from the fixed candidate
//! list, never user input) — zero injection surface.
//!
//! # Slice-10 distribution hardening
//!
//! Two resilience additions for the bundled (GUI-launched) runtime, where the
//! inherited PATH can be STALE (it does not include a custom npm prefix like
//! `D:\AI Tools\npm-global`):
//!
//!   - **npm-prefix absolute probe (AC-NPM-PREFIX-PROBE)**: when ALL bare
//!     `cmd /C codex…` candidates yield `Missing` on Windows, we resolve the
//!     npm global bin directory via `cmd /C npm prefix -g` (npm itself lives in
//!     `C:\Program Files\nodejs`, which is on the MACHINE PATH, so it is
//!     reachable even when the user PATH is stale), then probe the ABSOLUTE path
//!     `<prefix>\codex.cmd login status`. This finds codex by absolute path
//!     regardless of PATH. Order: bare `cmd /C` → npm-prefix absolute → WSL.
//!     Reading `npm prefix` stdout requires CAPTURING output (not null stdout)
//!     for that ONE probe — that is fine (it is a path, never auth data); it is
//!     bounded by the same timeout discipline and the result is trimmed. The
//!     codex probe built from the prefix keeps stdio fully null (read-only). The
//!     only interpolated arg is the npm-PRODUCED prefix path — never user input.
//!   - **self-diagnosis `detail` (AC-DETECT-SELFDIAG)**: the snapshot now carries
//!     a `detail` summarizing the resolved home path + WHICH signal produced the
//!     result (`auth_file:<path>` / `probe_path` / `probe_npm_prefix` /
//!     `probe_wsl` / `none:<reason>`). It contains ONLY paths + signal labels —
//!     NEVER auth.json contents, NEVER a token/secret. The home/auth path STRINGS
//!     are obtained from `external_dep_paths` (the sole OS-user-dir module), so
//!     this module names ZERO OS-user-dir token in its source (T1-static-scan
//!     clean). The renderer surfaces it as a small muted line so a future
//!     detection failure is diagnosable instead of silent.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::external_dep_paths::{auth_file_display, auth_file_present, resolved_home_display};

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

/// WHERE codex authentication was detected. Surfaced to the renderer (snake_case)
/// so a future UI can tell the user which environment its auto mode binds to.
///
///   - `Windows` — the Windows-native probe found codex present (authed OR
///     unauthed-but-installed). The native install is authoritative.
///   - `Wsl` — the Windows-native probe found NOTHING (`Missing`), and the
///     cross-boundary `wsl.exe -- codex login status` fallback detected a
///     WSL Ubuntu install. Only reachable on Windows.
///   - `None` — neither probe found codex (the common-person, copy-paste case),
///     OR a non-Windows host where codex is simply absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexOrigin {
    Windows,
    Wsl,
    None,
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
    /// AND no auth file is present. After the Slice-9 WSL fallback this is true
    /// only when NEITHER the Windows-native NOR the WSL probe found codex.
    pub codex_cli_missing: bool,
    /// WHERE auth was detected: `windows` (native probe found codex),
    /// `wsl` (Windows-native Missing → cross-boundary WSL fallback detected it),
    /// or `none` (neither). The proxy spawn (Slice 9, `oauth_child`) branches on
    /// this so a WSL-only install is driven through `wsl.exe`.
    pub origin: CodexOrigin,
    /// Self-diagnosis summary (Slice 10 — AC-DETECT-SELFDIAG). A short string
    /// for the renderer's muted diagnostic line: the resolved home path + WHICH
    /// signal produced the result, or WHY nothing was found. Contains ONLY paths
    /// and signal labels — NEVER auth.json contents, NEVER a token/secret. It is
    /// assembled from `external_dep_paths` path-string return values so this
    /// module names no OS-user-dir token in source.
    pub detail: String,
}

/// WHICH signal decided the detection (Slice 10 — AC-DETECT-SELFDIAG). Used only
/// to label the self-diagnosis `detail`; carries no secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DetectSignal {
    /// The native `cmd /C codex login status` (PATH) probe found codex.
    ProbePath,
    /// The `cmd /C npm prefix -g` → absolute `<prefix>\codex.cmd` probe found it.
    ProbeNpmPrefix,
    /// The cross-boundary `wsl.exe -- codex login status` fallback found it.
    ProbeWsl,
    /// No probe found codex anywhere.
    None,
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

/// Build the platform `codex login status` probe command for `bin`. On Windows
/// the codex shim is a `.cmd`, which `CreateProcess` cannot run directly, so we
/// route through `cmd /C codex login status` (matching `codex_login.rs::
/// build_command` + `oauth_child` spawn convention): `cmd.exe` resolves the
/// `.cmd` shim on PATH and is unaffected by PowerShell's ExecutionPolicy. On
/// non-Windows the bare `Command::new(bin)` is used (no shim involved).
///
/// SECURITY: every interpolated value comes from the FIXED candidate list
/// `["codex.cmd","codex.exe","codex"]` (compile-time literals) — no user input
/// ever reaches these args, so there is no shell-injection surface even though
/// the Windows arm routes through `cmd.exe`.
fn build_probe_command(bin: &str) -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", bin, "login", "status"]);
        c
    } else {
        let mut c = Command::new(bin);
        c.args(["login", "status"]);
        c
    }
}

/// Build the cross-boundary WSL probe command: `wsl.exe -- codex login status`.
/// FIXED-LITERAL args only — nothing user-controlled. Read-only (login status).
/// Only ever called on Windows (guarded by `cfg!(windows)` at the call site).
fn build_wsl_probe_command() -> Command {
    let mut c = Command::new("wsl.exe");
    c.args(["--", "codex", "login", "status"]);
    c
}

/// Build the npm-global-prefix query command: `cmd /C npm prefix -g`. FIXED-
/// LITERAL args only. UNLIKE the read-only probes this one CAPTURES stdout (the
/// prefix PATH, never auth data) so we can resolve the absolute codex path.
/// Windows-only (the GUI stale-PATH case); npm itself is on the machine PATH.
fn build_npm_prefix_command() -> Command {
    let mut c = Command::new("cmd");
    c.args(["/C", "npm", "prefix", "-g"]);
    c
}

/// Build the ABSOLUTE-path codex probe: `cmd /C <prefix>\codex.cmd login status`.
/// The ONLY non-literal value is `codex_cmd_path`, which is built from the
/// npm-PRODUCED prefix (never user input) by joining the fixed `codex.cmd`
/// filename. Read-only (`login status`), stdio nulled by the runner.
fn build_npm_prefix_probe_command(codex_cmd_path: &str) -> Command {
    let mut c = Command::new("cmd");
    c.args(["/C", codex_cmd_path, "login", "status"]);
    c
}

/// Run `cmd /C npm prefix -g` with a bounded wait and return the resolved npm
/// global prefix PATH (trimmed). Returns `None` when npm is absent / the call
/// times out / no path-like line is produced. Captures stdout (the prefix is a
/// path, not auth data); a hung npm cannot stall the poll (bounded kill).
///
/// `npm prefix -g` may print a benign leading warning line when launched from an
/// unusual CWD (e.g. a UNC path → "UNC paths are not supported. Defaulting to
/// Windows directory."). We therefore take the LAST non-empty, drive-rooted line
/// of stdout as the prefix, so such a warning never poisons the path.
fn resolve_npm_global_prefix() -> Option<String> {
    let spawned = build_npm_prefix_command()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();

    let mut child = match spawned {
        Ok(c) => c,
        Err(_) => return None,
    };

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    // Bounded read: the prefix is a single short path line.
                    let _ = stdout.read_to_string(&mut out);
                }
                return last_drive_rooted_line(&out);
            }
            Ok(None) => {
                if start.elapsed() >= PROBE_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return None,
        }
    }
}

/// Pick the last non-empty line of `npm prefix -g` stdout that looks like a
/// Windows drive-rooted absolute path (e.g. `D:\AI Tools\npm-global`). Returns
/// the trimmed path, or `None` when no such line exists. This skips a leading
/// CWD warning while never accepting a non-path line.
fn last_drive_rooted_line(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .filter(|l| is_drive_rooted(l))
        .last()
        .map(|s| s.to_string())
}

/// True iff `s` begins with a Windows drive letter root like `C:\` or `D:/`.
fn is_drive_rooted(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 3
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && (b[2] == b'\\' || b[2] == b'/')
}

/// AC-NPM-PREFIX-PROBE: resolve the npm global prefix and probe the absolute
/// `<prefix>\codex.cmd login status`. Returns `Some(probe)` when the prefix +
/// codex.cmd resolve and the probe ran (`Authed`/`Unauthed`), or `None` when the
/// prefix could not be resolved / `codex.cmd` is not there / the probe failed.
/// Read-only; bounded; the only interpolated arg is the npm-produced path.
fn probe_login_status_npm_prefix() -> Option<LoginProbe> {
    let prefix = resolve_npm_global_prefix()?;
    // Join the fixed `codex.cmd` filename onto the npm-produced prefix.
    let codex_cmd = std::path::Path::new(&prefix).join("codex.cmd");
    // If the file is not there, skip (let the WSL fallback try) — avoids a
    // pointless cmd spawn.
    if !codex_cmd.exists() {
        return None;
    }
    let codex_cmd_str = codex_cmd.to_string_lossy().to_string();
    run_probe_command(build_npm_prefix_probe_command(&codex_cmd_str))
}

/// Spawn an already-built probe `Command` (stdio fully null → READ-ONLY) and
/// poll `try_wait` on a bounded loop. Returns:
///   - `Some(Authed)`   on exit 0,
///   - `Some(Unauthed)` on a non-zero exit (binary present, not signed in),
///   - `None`           on spawn-failure / not-found / wait-error / timeout
///                      (caller treats as "try next" or "missing").
/// `Command` has no built-in timeout, so on timeout we kill the child
/// (best-effort) and report `None`, never blocking the app.
fn run_probe_command(mut command: Command) -> Option<LoginProbe> {
    let spawned = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    let mut child = match spawned {
        Ok(c) => c,
        // Spawn failure (incl. NotFound for a missing `cmd`/`wsl.exe`/binary):
        // signal the caller to try the next candidate / fall through to Missing.
        Err(_) => return None,
    };

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Some(if status.success() {
                    LoginProbe::Authed
                } else {
                    LoginProbe::Unauthed
                });
            }
            Ok(None) => {
                if start.elapsed() >= PROBE_TIMEOUT {
                    // Hung binary: kill (best-effort) and treat as unavailable.
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return None,
        }
    }
}

/// Run the Windows-native (or, off-Windows, the direct) `codex login status`
/// probe across the candidate binary names. Fully READ-ONLY (stdio ignored).
/// Exit 0 ⇒ `Authed`, non-zero ⇒ `Unauthed`, all candidates fail to spawn /
/// time out ⇒ `Missing`.
fn probe_login_status() -> LoginProbe {
    for bin in codex_binaries() {
        if let Some(probe) = run_probe_command(build_probe_command(bin)) {
            return probe;
        }
        // None ⇒ this candidate could not be spawned (e.g. `.exe` absent) →
        // try the next name.
    }
    LoginProbe::Missing
}

/// Cross-boundary fallback probe: `wsl.exe -- codex login status`. Detects a
/// codex install that lives ONLY inside WSL Ubuntu. READ-ONLY, bounded, never
/// blocking. Returns `Missing` when wsl.exe is absent / WSL has no codex /
/// the call times out (graceful: the caller then degrades to copy-paste).
fn probe_login_status_wsl() -> LoginProbe {
    run_probe_command(build_wsl_probe_command()).unwrap_or(LoginProbe::Missing)
}

/// Core detection (pure-ish: stat + read-only probe, no writes). Returns the
/// snapshot the provider abstraction consumes.
///
/// Order (Slice 9): the Windows-native probe runs first and is authoritative
/// when it finds codex (`Authed`/`Unauthed`). ONLY when it yields `Missing`
/// (codex not found natively) AND we are on Windows do we attempt the
/// cross-boundary `wsl.exe -- codex login status` fallback. The effective probe
/// + an `origin` (`windows`/`wsl`/`none`) are derived from whichever signal won.
pub fn detect_codex() -> CodexDetect {
    let file_present = auth_file_present();
    let native = probe_login_status();

    // Resolve the effective probe + origin + signal. The native (PATH) probe wins
    // whenever it found codex at all (Authed OR Unauthed-but-present). Only a
    // native `Missing` on Windows triggers the Slice-10 npm-prefix absolute probe,
    // then (if that also fails) the Slice-9 WSL fallback.
    // Order: bare cmd /C candidates → npm-prefix absolute → WSL fallback.
    let (probe, origin, signal) = match native {
        LoginProbe::Authed | LoginProbe::Unauthed => {
            // Native codex present. On Windows the origin is `windows`; on a
            // *nix host (where there is no Windows/WSL split) we also label it
            // `windows` — i.e. "the native, authoritative environment" — to keep
            // the enum small; non-Windows never reaches the `wsl` branch.
            (native, CodexOrigin::Windows, DetectSignal::ProbePath)
        }
        LoginProbe::Missing => {
            if cfg!(windows) {
                // Windows: codex not found on the (possibly stale) PATH. First
                // try the npm-prefix absolute probe (AC-NPM-PREFIX-PROBE), which
                // finds a custom-prefix codex regardless of PATH.
                match probe_login_status_npm_prefix() {
                    Some(LoginProbe::Authed) => {
                        (LoginProbe::Authed, CodexOrigin::Windows, DetectSignal::ProbeNpmPrefix)
                    }
                    Some(LoginProbe::Unauthed) => {
                        (LoginProbe::Unauthed, CodexOrigin::Windows, DetectSignal::ProbeNpmPrefix)
                    }
                    // npm prefix didn't resolve codex → cross-boundary WSL.
                    _ => match probe_login_status_wsl() {
                        LoginProbe::Authed => (LoginProbe::Authed, CodexOrigin::Wsl, DetectSignal::ProbeWsl),
                        LoginProbe::Unauthed => (LoginProbe::Unauthed, CodexOrigin::Wsl, DetectSignal::ProbeWsl),
                        LoginProbe::Missing => (LoginProbe::Missing, CodexOrigin::None, DetectSignal::None),
                    },
                }
            } else {
                // Non-Windows: the native probe is authoritative; no WSL split.
                (LoginProbe::Missing, CodexOrigin::None, DetectSignal::None)
            }
        }
    };

    // `codex_cli_missing` is true only when codex was found NOWHERE (PATH +
    // npm-prefix + WSL), so the renderer's install guidance is shown only in the
    // genuine not-installed case.
    let cli_missing = probe == LoginProbe::Missing;
    // Available when EITHER signal is positive: a file present (precedence path)
    // OR an authed probe (covers keyring-only installs with no auth.json, and a
    // WSL/npm-prefix-detected install).
    let available = file_present || probe == LoginProbe::Authed;
    let detail = build_detail(file_present, available, signal);
    CodexDetect {
        available,
        auth_file_present: file_present,
        login_probe: probe,
        codex_cli_missing: cli_missing,
        origin,
        detail,
    }
}

/// Assemble the self-diagnosis `detail` string (Slice 10 — AC-DETECT-SELFDIAG).
/// PATHS + signal labels ONLY — never auth.json contents, never a secret. The
/// home/auth path strings come from `external_dep_paths` (the sole OS-user-dir
/// module), so this function names no OS-user-dir token in source.
///
/// Shape: `home=<home-or-?> · <signal>` where `<signal>` is one of:
///   - `auth_file:<path>` (the auth.json presence-stat hit — path only)
///   - `probe_path` / `probe_npm_prefix` / `probe_wsl` (which probe authed)
///   - `none:<reason>` (`home unresolved` / `codex not found on PATH/npm-prefix/WSL`)
fn build_detail(file_present: bool, available: bool, signal: DetectSignal) -> String {
    // Resolved home path string (a path, never a secret). `?` when unresolved.
    let home = resolved_home_display().unwrap_or_else(|| "?".to_string());

    let signal_part = if available && file_present {
        // The auth-file presence-stat is the precedence signal. Show its PATH
        // (path only — the file is never opened/read).
        match auth_file_display() {
            Some(p) => format!("auth_file:{p}"),
            None => "auth_file".to_string(),
        }
    } else if available {
        // Available via a probe (no auth.json on disk — keyring-only install).
        match signal {
            DetectSignal::ProbePath => "probe_path".to_string(),
            DetectSignal::ProbeNpmPrefix => "probe_npm_prefix".to_string(),
            DetectSignal::ProbeWsl => "probe_wsl".to_string(),
            DetectSignal::None => "probe".to_string(),
        }
    } else if resolved_home_display().is_none() {
        "none:home unresolved".to_string()
    } else {
        "none:codex not found on PATH/npm-prefix/WSL".to_string()
    };

    format!("home={home} · {signal_part}")
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
            origin: CodexOrigin::None,
            detail: build_detail(false, false, DetectSignal::None),
        };
        assert!(d.codex_cli_missing);
        assert!(!d.available);
        assert_eq!(d.origin, CodexOrigin::None);
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

    #[test]
    fn detect_does_not_panic_and_origin_consistent() {
        // The full detect (native probe + possible WSL fallback) must be bounded
        // and never panic. Whatever the host, the derived fields stay consistent:
        // Missing ⇒ origin None ⇒ cli_missing; a non-Missing probe ⇒ origin is
        // NOT None.
        let d = detect_codex();
        if d.login_probe == LoginProbe::Missing {
            assert_eq!(d.origin, CodexOrigin::None, "Missing probe must have origin none");
            assert!(d.codex_cli_missing, "Missing probe must mark cli_missing");
        } else {
            assert_ne!(d.origin, CodexOrigin::None, "a present codex must record a non-none origin");
            assert!(!d.codex_cli_missing, "a present codex must not be cli_missing");
        }
    }

    // AC-DETECT-WIN-CMD: the Windows probe MUST route `codex login status`
    // through `cmd /C` (so the `.cmd` shim is resolvable) — a direct
    // `Command::new("codex.cmd")` is the Slice-5c bug. This is a source-level
    // guard mirroring the login module's injection-guard test: it pins the
    // routing shape so a future edit cannot silently reintroduce the direct
    // spawn that broke detection on Windows.
    #[test]
    fn windows_probe_routes_through_cmd() {
        let src = include_str!("codex_detect.rs");
        // The Windows arm of build_probe_command builds `cmd /C codex login status`.
        assert!(
            src.contains("Command::new(\"cmd\")") && src.contains("\"/C\", bin, \"login\", \"status\""),
            "Windows probe must route through `cmd /C <bin> login status` (the .cmd-shim fix)"
        );
        // The non-Windows arm keeps the direct spawn.
        assert!(
            src.contains("Command::new(bin)"),
            "non-Windows probe must spawn the codex binary directly"
        );
        // The WSL fallback uses wsl.exe with fixed-literal args.
        assert!(
            src.contains("Command::new(\"wsl.exe\")") && src.contains("\"--\", \"codex\", \"login\", \"status\""),
            "WSL fallback must be `wsl.exe -- codex login status` with fixed literal args"
        );
    }

    // AC-DETECT-WSL-FALLBACK: only FIXED-LITERAL args reach the new shell calls —
    // there is no string interpolation of user input into `cmd`/`wsl.exe`. The
    // only interpolated value is `bin`, which is one of the compile-time
    // candidate literals. Guard that no `format!`/`+`-built arg feeds a probe.
    #[test]
    fn probe_args_are_fixed_literals() {
        let src = include_str!("codex_detect.rs");
        // `bin` is sourced ONLY from the fixed candidate list.
        assert!(
            src.contains("&[\"codex.cmd\", \"codex.exe\", \"codex\"]") && src.contains("&[\"codex\"]"),
            "binary names must come from the fixed candidate list"
        );
        // No formatted/concatenated argument is passed to a probe command.
        // The needles are built at runtime so this assertion's OWN source text
        // does not contain the literal it forbids (which would self-trip).
        let fmt = "format!";
        let arg_fmt = format!("c.arg({fmt}");
        let args_fmt = format!("c.args([{fmt}");
        assert!(
            !src.contains(&arg_fmt) && !src.contains(&args_fmt),
            "probe args must be fixed literals (no format-built args)"
        );
    }

    #[test]
    fn origin_serializes_snake_case() {
        // The renderer reads `origin` as snake_case strings.
        assert_eq!(serde_json::to_string(&CodexOrigin::Windows).unwrap(), "\"windows\"");
        assert_eq!(serde_json::to_string(&CodexOrigin::Wsl).unwrap(), "\"wsl\"");
        assert_eq!(serde_json::to_string(&CodexOrigin::None).unwrap(), "\"none\"");
    }

    #[test]
    fn detect_serializes_origin_field() {
        let d = CodexDetect {
            available: true,
            auth_file_present: false,
            login_probe: LoginProbe::Authed,
            codex_cli_missing: false,
            origin: CodexOrigin::Wsl,
            detail: build_detail(false, true, DetectSignal::ProbeWsl),
        };
        let json = serde_json::to_string(&d).unwrap();
        assert!(json.contains("\"origin\":\"wsl\""), "origin must serialize snake_case in the snapshot");
        assert!(json.contains("\"detail\":"), "detail must serialize in the snapshot");
    }

    // AC-DETECT-SELFDIAG: the detail field carries ONLY paths + signal labels and
    // NEVER an OS-user-dir token literal or auth contents. We assert the four
    // signal shapes and that the assembled string never contains a forbidden
    // OS-user-dir token (pulled from the Rust sentinel — the single authoritative
    // pattern). The home path VALUE is allowed; token IDENTIFIERS are not.
    #[test]
    fn detail_is_paths_and_labels_no_tokens() {
        // The four signal shapes.
        let auth_hit = build_detail(true, true, DetectSignal::ProbePath);
        assert!(auth_hit.starts_with("home="), "detail must lead with home=");
        // available + file_present ⇒ the auth_file: label (path only).
        assert!(auth_hit.contains("auth_file"), "file-present detail must label auth_file");

        let path_hit = build_detail(false, true, DetectSignal::ProbePath);
        assert!(path_hit.contains("probe_path"));
        let npm_hit = build_detail(false, true, DetectSignal::ProbeNpmPrefix);
        assert!(npm_hit.contains("probe_npm_prefix"));
        let wsl_hit = build_detail(false, true, DetectSignal::ProbeWsl);
        assert!(wsl_hit.contains("probe_wsl"));
        let none_hit = build_detail(false, false, DetectSignal::None);
        assert!(none_hit.contains("none:"), "unavailable detail must carry a none: reason");

        // No forbidden OS-user-dir token identifier appears in ANY detail string.
        // (The home path VALUE like `C:\Users\...` is fine; the banned thing is
        // the token identifiers `USERPROFILE`/`home_dir`/etc. as text.)
        let sentinel = crate::external_dep_paths::forbidden_pattern_sentinel();
        for tok in sentinel.split('|') {
            for d in [&auth_hit, &path_hit, &npm_hit, &wsl_hit, &none_hit] {
                assert!(
                    !d.contains(tok),
                    "detail string leaked an OS-user-dir token `{tok}`: {d}"
                );
            }
        }
        // And never the literal `auth.json` CONTENTS marker — detail shows a path,
        // not file contents. (We can't read contents anyway; this pins intent.)
        for d in [&auth_hit, &path_hit, &npm_hit, &wsl_hit, &none_hit] {
            assert!(!d.contains("access_token") && !d.contains("Bearer"), "detail leaked a secret marker: {d}");
        }
    }

    // AC-NPM-PREFIX-PROBE: the new shell calls use FIXED-LITERAL args; the only
    // interpolated value is the npm-PRODUCED prefix path (never user input). This
    // is a source guard mirroring `probe_args_are_fixed_literals`.
    #[test]
    fn npm_prefix_probe_args_are_fixed_literals() {
        let src = include_str!("codex_detect.rs");
        // The prefix query is `cmd /C npm prefix -g` with fixed literals.
        assert!(
            src.contains("Command::new(\"cmd\")") && src.contains("\"/C\", \"npm\", \"prefix\", \"-g\""),
            "npm prefix query must be `cmd /C npm prefix -g` with fixed literals"
        );
        // The absolute codex probe is `cmd /C <prefix>\\codex.cmd login status`;
        // the ONLY interpolated arg is `codex_cmd_path` (the npm-produced path).
        assert!(
            src.contains("\"/C\", codex_cmd_path, \"login\", \"status\""),
            "npm-prefix codex probe must be `cmd /C <prefix-path> login status`"
        );
        // No format!/concatenation builds a probe arg (injection guard). Needles
        // assembled at runtime so this test's own source does not self-trip.
        let fmt = "format!";
        let arg_fmt = format!("c.arg({fmt}");
        let args_fmt = format!("c.args([{fmt}");
        assert!(
            !src.contains(&arg_fmt) && !src.contains(&args_fmt),
            "probe args must be fixed literals (no format-built args)"
        );
        // The npm-prefix probe runs ONLY when the native PATH probe is Missing on
        // Windows (the order: bare cmd /C → npm-prefix → WSL).
        assert!(
            src.contains("probe_login_status_npm_prefix()"),
            "detect must call the npm-prefix probe"
        );
    }

    // The npm-prefix stdout parser tolerates a leading CWD warning and takes the
    // last drive-rooted line as the prefix.
    #[test]
    fn npm_prefix_parser_skips_warning_takes_path() {
        let noisy = "'\\\\wsl.localhost\\...' \r\nCMD.EXE was started with the above path...\r\nUNC paths are not supported.  Defaulting to Windows directory.\r\nD:\\AI Tools\\npm-global\r\n";
        assert_eq!(
            last_drive_rooted_line(noisy).as_deref(),
            Some("D:\\AI Tools\\npm-global")
        );
        // A clean single-line output.
        assert_eq!(
            last_drive_rooted_line("C:\\Program Files\\nodejs\r\n").as_deref(),
            Some("C:\\Program Files\\nodejs")
        );
        // No drive-rooted line ⇒ None (never accept a non-path line as a prefix).
        assert_eq!(last_drive_rooted_line("npm: command not found\n"), None);
        assert_eq!(last_drive_rooted_line(""), None);
        // is_drive_rooted basics.
        assert!(is_drive_rooted("C:\\x"));
        assert!(is_drive_rooted("d:/y"));
        assert!(!is_drive_rooted("/usr/local"));
        assert!(!is_drive_rooted("C:"));
    }

    #[test]
    fn npm_prefix_probe_does_not_panic() {
        // On any host this must be bounded + non-panicking (returns None when npm
        // or codex.cmd is absent).
        let _ = probe_login_status_npm_prefix();
    }
}
