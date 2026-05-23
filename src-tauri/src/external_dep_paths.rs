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
//! # Discovery precedence (per Round-2 contract O-2, extended Slice 10)
//!
//! The function [`auth_file_path`] applies the openai-oauth precedence:
//!
//! 1. `$CHATGPT_LOCAL_HOME/auth.json`
//! 2. `$CODEX_HOME/auth.json`
//! 3. `~/.chatgpt-local/auth.json`
//! 4. `~/.codex/auth.json`
//! 5. `~/.config/codex/auth.json` (Slice 10 — the XDG path; matches ima2's
//!    `codexDetect.js`, which also checks `~/.config/codex/auth.json`)
//!
//! The explicit `--oauth-file` CLI argument override is honored by the
//! openai-oauth child itself (we pass it through as a CLI flag); this Rust
//! function returns the host-resolved default that we then pass to the child.
//!
//! # Slice-10 home-resolution hardening (the live distribution bug)
//!
//! On the test machine `~/.codex/auth.json` EXISTS and a Node mimic of the
//! resolver (`os.homedir()`) returns it, yet the *bundled* app reported
//! `available = false`: in the packaged release runtime `dirs::home_dir()` was
//! suspected to return `None`, so the `~/.codex` / `~/.chatgpt-local` candidates
//! were never even *built* — only the (unset) `$CODEX_HOME` / `$CHATGPT_LOCAL_HOME`
//! env candidates were checked → `auth_file_path()` returned `None` →
//! `auth_file_present()` = false → `available` = false. The fix makes
//! [`resolve_home_dir`] a multi-step fallback so a `None` from `dirs::home_dir()`
//! no longer blinds the resolver: it then consults `USERPROFILE`, then a
//! `HOMEDRIVE` + `HOMEPATH` combination (the same order the Windows API itself
//! uses internally). All of this stays inside THIS one file — the static-scan
//! exemption boundary is unchanged.
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
///
/// Slice-10 multi-step fallback (AC-HOME-ROBUST). In a bundled release runtime
/// `dirs::home_dir()` was observed to return `None` even though the user's home
/// (and `~/.codex/auth.json`) clearly exists. A `None` there used to skip the
/// `~/.codex` candidate entirely → false `available = false`. We now fall back
/// explicitly:
///
///   1. `dirs::home_dir()` if `Some` (the cross-platform canonical resolver).
///   2. else `USERPROFILE` (Windows) if it is set and non-empty.
///   3. else `HOMEDRIVE` + `HOMEPATH` (Windows) combined, if both are present
///      and non-empty (the same composition the Win32 home APIs use internally).
///
/// On non-Windows, `dirs::home_dir()` already consults `$HOME`, so steps 2–3
/// (Windows-only env names) simply never fire — `$HOME` is covered by step 1.
fn resolve_home_dir() -> Option<PathBuf> {
    // 1. The cross-platform canonical resolver.
    if let Some(h) = dirs::home_dir() {
        return Some(h);
    }
    // 2. Windows fallback: USERPROFILE (e.g. `C:\Users\USER`).
    if let Some(h) = home_from_userprofile() {
        return Some(h);
    }
    // 3. Windows fallback: HOMEDRIVE + HOMEPATH (e.g. `C:` + `\Users\USER`).
    home_from_homedrive_homepath()
}

/// Step 2 of the fallback: read `USERPROFILE` (Windows) and return it as a home
/// directory iff it is set and non-empty. Factored out so the unit tests can
/// exercise the fallback deterministically by temp-setting the env var (the
/// real `dirs::home_dir()` is non-deterministic per host and cannot be forced
/// to `None` in a test).
fn home_from_userprofile() -> Option<PathBuf> {
    match env::var("USERPROFILE") {
        Ok(p) if !p.trim().is_empty() => Some(PathBuf::from(p)),
        _ => None,
    }
}

/// Step 3 of the fallback: combine `HOMEDRIVE` + `HOMEPATH` (Windows) into a
/// home directory iff BOTH are present and non-empty. Returns `None` otherwise.
fn home_from_homedrive_homepath() -> Option<PathBuf> {
    let drive = env::var("HOMEDRIVE").ok().filter(|s| !s.trim().is_empty())?;
    let path = env::var("HOMEPATH").ok().filter(|s| !s.trim().is_empty())?;
    // `HOMEDRIVE` is like `C:` and `HOMEPATH` is like `\Users\USER`; a plain
    // string concat yields the canonical `C:\Users\USER`.
    Some(PathBuf::from(format!("{drive}{path}")))
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
        // Slice 10 (AC-AUTH-PATHS): the XDG path. ima2's `codexDetect.js` also
        // checks `~/.config/codex/auth.json`; some codex builds write there.
        candidates.push(h.join(".config").join("codex").join("auth.json"));
    }

    first_existing(&candidates)
}

/// Read-only display of the resolved home directory, for the detect self-diagnosis
/// `detail` field (Slice 10 — AC-DETECT-SELFDIAG). Returns the home PATH STRING
/// (a path, never a secret) or `None` when home could not be resolved at all.
///
/// This exposes only the resolved path VALUE. The forbidden thing the static-scan
/// guards is the OS-user-dir token IDENTIFIERS appearing as source literals in
/// other modules; the runtime path value returned here carries no such identifier
/// and no auth.json contents. Callers (`codex_detect.rs`) assemble the diagnosis
/// string from this return value so they never name an OS-user-dir token in source.
pub fn resolved_home_display() -> Option<String> {
    resolve_home_dir().map(|p| p.display().to_string())
}

/// Read-only display of the resolved auth-file path, for the detect
/// self-diagnosis `detail` field (Slice 10 — AC-DETECT-SELFDIAG). Returns the
/// PATH STRING of the first existing auth.json candidate, or `None` when none
/// exists. This is a path only — the file is NEVER opened, read, parsed, or
/// copied; only its presence (and now its path string) is exposed.
pub fn auth_file_display() -> Option<String> {
    auth_file_path().map(|p| p.display().to_string())
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

    /// AC-HOME-ROBUST: the fallback helpers resolve a home directory from the
    /// Windows env vars even when `dirs::home_dir()` is `None` (the bundled-
    /// runtime failure mode). `dirs::home_dir()` itself cannot be forced to
    /// `None` in a unit test (it depends on the host), so we exercise the two
    /// fallback steps directly. Env is process-global, so this single test
    /// snapshots + restores every var it touches and does not run the steps in
    /// parallel with each other.
    #[test]
    fn home_fallback_resolves_from_env_when_dirs_is_none() {
        // Snapshot the three env vars we mutate.
        let saved_userprofile = env::var("USERPROFILE").ok();
        let saved_homedrive = env::var("HOMEDRIVE").ok();
        let saved_homepath = env::var("HOMEPATH").ok();

        // Step 2: USERPROFILE resolves to a home directory.
        env::set_var("USERPROFILE", r"C:\Users\TESTUSER");
        assert_eq!(
            home_from_userprofile(),
            Some(PathBuf::from(r"C:\Users\TESTUSER")),
            "USERPROFILE fallback must resolve a home dir"
        );

        // Empty / whitespace USERPROFILE is treated as unset (no false home).
        env::set_var("USERPROFILE", "   ");
        assert_eq!(home_from_userprofile(), None, "blank USERPROFILE must be ignored");
        env::remove_var("USERPROFILE");
        assert_eq!(home_from_userprofile(), None, "unset USERPROFILE must be None");

        // Step 3: HOMEDRIVE + HOMEPATH combine into the canonical path.
        env::set_var("HOMEDRIVE", "C:");
        env::set_var("HOMEPATH", r"\Users\TESTUSER");
        assert_eq!(
            home_from_homedrive_homepath(),
            Some(PathBuf::from(r"C:\Users\TESTUSER")),
            "HOMEDRIVE+HOMEPATH must combine into the home dir"
        );

        // Either half missing ⇒ None (no half-built path).
        env::remove_var("HOMEDRIVE");
        assert_eq!(home_from_homedrive_homepath(), None, "missing HOMEDRIVE ⇒ None");
        env::set_var("HOMEDRIVE", "C:");
        env::remove_var("HOMEPATH");
        assert_eq!(home_from_homedrive_homepath(), None, "missing HOMEPATH ⇒ None");

        // Restore.
        match saved_userprofile {
            Some(v) => env::set_var("USERPROFILE", v),
            None => env::remove_var("USERPROFILE"),
        }
        match saved_homedrive {
            Some(v) => env::set_var("HOMEDRIVE", v),
            None => env::remove_var("HOMEDRIVE"),
        }
        match saved_homepath {
            Some(v) => env::set_var("HOMEPATH", v),
            None => env::remove_var("HOMEPATH"),
        }
    }

    /// AC-AUTH-PATHS: the auth candidate list includes the XDG path
    /// `<home>/.config/codex/auth.json`. We assert via the source of the
    /// candidate construction (the precedence order is documented + tested here)
    /// — building the actual list depends on the host home, so we pin the
    /// `.config`/`codex` join is present in this module's source.
    #[test]
    fn auth_candidates_include_xdg_config_codex() {
        let src = include_str!("external_dep_paths.rs");
        assert!(
            src.contains(".join(\".config\").join(\"codex\").join(\"auth.json\")"),
            "auth_file_path must include the ~/.config/codex/auth.json XDG candidate"
        );
        // The pre-existing candidates are retained (precedence unchanged before
        // the new XDG tail).
        assert!(src.contains(".join(\".chatgpt-local\").join(\"auth.json\")"));
        assert!(src.contains(".join(\".codex\").join(\"auth.json\")"));
    }

    /// The display helpers expose path strings only and never read file
    /// contents. (`auth_file_display` returns whatever the host has; we only
    /// assert it does not panic and that the home display is internally
    /// consistent with `home_dir()`.)
    #[test]
    fn display_helpers_are_path_only_and_consistent() {
        // Never panics; returns a path string or None.
        let _ = auth_file_display();
        // resolved_home_display agrees with home_dir's presence.
        assert_eq!(resolved_home_display().is_some(), home_dir().is_some());
    }
}
