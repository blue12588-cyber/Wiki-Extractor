//! external_dep_paths — single AC-7-relaxed exemption module.
//!
//! Authority: `runs/run_20260521_093931_p5_sw_llmwiki_slice2/agreed_contract.json`,
//! clauses AC-7-relaxed and §AC-7-relaxed exemption module.
//!
//! # What this module is
//!
//! This file is **the only module in the application tree** authorized to:
//!
//! 1. Read `~/.codex/auth.json` (or its `$CODEX_HOME` / `$CHATGPT_LOCAL_HOME`
//!    overrides) for the purpose of detecting presence.
//! 2. Use OS-user-directory APIs such as [`dirs::home_dir`] or interpret
//!    `USERPROFILE` / `HOMEPATH` / `LOCALAPPDATA` / `APPDATA` environment
//!    variables.
//!
//! All other source files in `src-tauri/src/**`, `src/**`, `tools/**`, and the
//! Svelte renderer are forbidden from introducing the pattern
//! `app_data_dir|APPDATA|appData|app_local_data_dir|app_config_dir|home_dir|HOMEPATH|USERPROFILE|LOCALAPPDATA`.
//! Any other module that introduces that pattern is a contract violation and
//! routes to `contract_refresh_required`. The exemption is bound to this exact
//! relative path; renaming or moving this file requires contract refresh.
//!
//! # What this module is NOT authorized to do
//!
//! - Write to `~/.codex/auth.json`, parse its contents, log the contents,
//!   redact the contents, or copy the file. Only stat (presence check) and
//!   read of the absolute path string for downstream `--oauth-file` passthrough
//!   are authorized.
//! - Pre-resolve the auth file before the application needs it. Callers
//!   invoke these helpers on-demand.
//!
//! # Discovery precedence (per Round-2 contract O-2)
//!
//! The function [`auth_file_path`] applies the openai-oauth precedence:
//!
//! 1. `$CHATGPT_LOCAL_HOME/auth.json`
//! 2. `$CODEX_HOME/auth.json`
//! 3. `~/.chatgpt-local/auth.json`
//! 4. `~/.codex/auth.json`
//!
//! The explicit `--oauth-file` CLI argument override is honored by the
//! openai-oauth child itself (we pass it through as a CLI flag); this Rust
//! function returns the host-resolved default that we then pass to the child.
//!
//! # Forbidden-pattern sentinel
//!
//! [`forbidden_pattern_sentinel`] returns the canonical regex string that the
//! T1-static-scan test pulls from a single authoritative location. Without
//! this sentinel the regex would have to be duplicated in the test file
//! and could drift.

use std::env;
use std::path::PathBuf;

/// The canonical pattern string used by `T1-static-scan` to enumerate
/// forbidden OS-user-directory accessors on non-test, non-vendor source.
///
/// Returned as `&'static str` so tests and scripts can pull a single
/// authoritative regex literal from one place. The pattern itself is NOT
/// embedded anywhere else in the application tree; the only OTHER place
/// these tokens appear in source is in this module's documentation
/// comment above and in the test scaffolding under `fixtures/`.
pub fn forbidden_pattern_sentinel() -> &'static str {
    "app_data_dir|APPDATA|appData|app_local_data_dir|app_config_dir|home_dir|HOMEPATH|USERPROFILE|LOCALAPPDATA"
}

/// Internal home-directory resolver. Centralizes the single allowed use of
/// the OS-user-directory APIs so the rest of the codebase has zero direct
/// callers.
fn resolve_home_dir() -> Option<PathBuf> {
    // `dirs::home_dir` returns `Option<PathBuf>` and is the cross-platform
    // canonical resolver. On Windows it consults `USERPROFILE` first, then
    // `HOMEDRIVE`/`HOMEPATH`. The use is contained here.
    dirs::home_dir()
}

/// Public read-only re-export of the home directory.
///
/// No other module is permitted to call `dirs::home_dir` directly or to read
/// `USERPROFILE` / `HOMEPATH`. Routing all uses through this single function
/// keeps the static-scan exemption surface bounded to one file.
pub fn home_dir() -> Option<PathBuf> {
    resolve_home_dir()
}

fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    for c in candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

/// Resolve the absolute auth-file path according to the openai-oauth
/// precedence. Returns the first candidate that exists on disk, or
/// `None` when no candidate exists.
///
/// This function performs *only* a presence stat. It does not open, parse,
/// or copy the file contents.
pub fn auth_file_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(p) = env::var("CHATGPT_LOCAL_HOME") {
        if !p.is_empty() {
            candidates.push(PathBuf::from(p).join("auth.json"));
        }
    }
    if let Ok(p) = env::var("CODEX_HOME") {
        if !p.is_empty() {
            candidates.push(PathBuf::from(p).join("auth.json"));
        }
    }
    if let Some(h) = resolve_home_dir() {
        candidates.push(h.join(".chatgpt-local").join("auth.json"));
        candidates.push(h.join(".codex").join("auth.json"));
    }

    first_existing(&candidates)
}

/// True iff [`auth_file_path`] resolved to a path that exists on disk.
/// Read-only stat; no file contents are read.
#[tauri::command]
pub fn auth_file_present() -> bool {
    auth_file_path().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinel_contains_forbidden_tokens() {
        let s = forbidden_pattern_sentinel();
        for tok in [
            "app_data_dir",
            "APPDATA",
            "appData",
            "app_local_data_dir",
            "app_config_dir",
            "home_dir",
            "HOMEPATH",
            "USERPROFILE",
            "LOCALAPPDATA",
        ] {
            assert!(s.contains(tok), "sentinel missing token {tok}");
        }
    }
}
