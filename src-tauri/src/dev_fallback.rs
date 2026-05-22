//! dev_fallback — reads fixtures/dev-fallback.flag from the project tree.
//!
//! The flag's job is to retain Slice 1's dual-state intent: when the user
//! flips the flag (or when ~/.codex/auth.json is absent), LLM-backed features
//! either render an explicit "auth not configured" UI state or route to a
//! deterministic mock proxy endpoint (open question O-4, deferred to
//! implementation pick).
//!
//! Round-1: this module returns the `enabled` boolean. Wiring into the auth
//! state machine is Round-2.
//!
//! Path resolution rule (within AC-7-relaxed compliance):
//!   - The flag lives at a project-relative path: `<repo-root>/fixtures/dev-fallback.flag`.
//!   - We do NOT resolve `<repo-root>` via app_data_dir / APPDATA / USERPROFILE.
//!     Instead, we use the directory of the running binary as a starting point
//!     and walk upward looking for the `fixtures/dev-fallback.flag` sentinel.
//!     This keeps the resolver inside the application tree per AC-PORTABLE
//!     (manual relocation smoke) and outside the AC-7 exemption surface.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FLAG_RELATIVE_PATH: &str = "fixtures/dev-fallback.flag";

#[derive(Debug, Deserialize, Serialize, Clone)]
struct DevFallbackFlag {
    enabled: bool,
    #[serde(default)]
    reason: String,
}

/// Walk up from `start` looking for `fixtures/dev-fallback.flag`. Returns the
/// resolved absolute path when found; returns `None` when no ancestor in the
/// chain contains the sentinel.
fn find_flag_from(start: &Path) -> Option<PathBuf> {
    let mut cursor = Some(start);
    while let Some(dir) = cursor {
        let candidate = dir.join(FLAG_RELATIVE_PATH);
        if candidate.is_file() {
            return Some(candidate);
        }
        cursor = dir.parent();
    }
    None
}

fn read_flag(path: &Path) -> Option<DevFallbackFlag> {
    let body = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<DevFallbackFlag>(&body).ok()
}

/// True iff the dev-fallback flag is present and parsed as `{"enabled": true}`.
/// Returns `false` on missing file, parse error, or `enabled: false`.
#[tauri::command]
pub fn dev_fallback_status() -> bool {
    let here = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf));
    let cwd = std::env::current_dir().ok();
    let candidates = [here, cwd];
    for candidate in candidates.iter().flatten() {
        if let Some(flag_path) = find_flag_from(candidate) {
            if let Some(flag) = read_flag(&flag_path) {
                return flag.enabled;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn enabled_false_returns_false() {
        let dir = std::env::temp_dir().join("llmwiki-dev-fallback-test-disabled");
        let _ = std::fs::remove_dir_all(&dir);
        let fix = dir.join("fixtures");
        std::fs::create_dir_all(&fix).unwrap();
        let mut f = std::fs::File::create(fix.join("dev-fallback.flag")).unwrap();
        writeln!(f, "{}", r#"{"enabled": false, "reason": "test"}"#).unwrap();
        let found = find_flag_from(&dir).unwrap();
        let parsed = read_flag(&found).unwrap();
        assert!(!parsed.enabled);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enabled_true_returns_true() {
        let dir = std::env::temp_dir().join("llmwiki-dev-fallback-test-enabled");
        let _ = std::fs::remove_dir_all(&dir);
        let fix = dir.join("fixtures");
        std::fs::create_dir_all(&fix).unwrap();
        let mut f = std::fs::File::create(fix.join("dev-fallback.flag")).unwrap();
        writeln!(f, "{}", r#"{"enabled": true, "reason": "test"}"#).unwrap();
        let found = find_flag_from(&dir).unwrap();
        let parsed = read_flag(&found).unwrap();
        assert!(parsed.enabled);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
