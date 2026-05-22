//! oauth_child — openai-oauth child process manager (Round-1 scaffold).
//!
//! Spawns `npx openai-oauth --port <P>` as a child process, parses the
//! ready-URL line from stdout, and exposes a Tauri command reporting the
//! current child status.
//!
//! Authority: agreed_contract.json#AC-OAUTH-CODEX +
//! work_bundle.stop_conditions (ready-line grammar mismatch ->
//! contract_refresh_required).
//!
//! Round-1 scope:
//!   - spawn / kill / status scaffold complete.
//!   - Stub-only at Round-1: actual wiring to AuthStateIndicator + the rest
//!     of the app's network path is Round-2.
//!
//! The ready-line parser MUST match the pattern `http://127.0.0.1:(<port>)/v1`.
//! If the parser cannot extract that URL within 10 seconds of spawn, the child
//! is killed and the error variant `ReadyLineGrammarMismatch` is returned, so
//! the orchestrator's stop_conditions semantics carry through.

use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;

/// Status reported to the renderer via the `oauth_child_status` Tauri command.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ChildStatus {
    Idle,
    Spawning,
    Ready { port: u16, url: String },
    Degraded { reason: String },
}

/// Error variants for the spawn pipeline. The
/// [`ReadyLineGrammarMismatch`](OAuthChildError::ReadyLineGrammarMismatch)
/// variant maps directly to the contract stop condition.
#[derive(Debug, thiserror::Error)]
pub enum OAuthChildError {
    #[error("failed to spawn openai-oauth child: {0}")]
    SpawnFailed(String),
    #[error("ready-line grammar mismatch: parser could not extract http://127.0.0.1:<port>/v1 from child stdout")]
    ReadyLineGrammarMismatch,
    #[error("child exited before readiness: {0}")]
    EarlyExit(String),
}

/// The currently observed child status, shared across Tauri command calls.
/// Wrapped in a Mutex so the renderer-facing read is consistent.
static CHILD_STATUS: Lazy<Mutex<ChildStatus>> = Lazy::new(|| Mutex::new(ChildStatus::Idle));

/// Owning handle to a spawned openai-oauth child. The Round-1 scaffold keeps
/// the structure intentionally minimal; the actual tokio::process::Child is
/// stored by the Round-2 wiring.
pub struct OAuthChild {
    pub port: u16,
    pub ready_url: String,
}

/// Parse a single line of openai-oauth stdout for the ready URL pattern.
/// Returns the (port, full URL) tuple iff the line matches
/// `http://127.0.0.1:<port>/v1`.
pub fn parse_ready_line(line: &str) -> Option<(u16, String)> {
    // Manual scan instead of pulling regex; the pattern is fixed and small.
    let needle = "http://127.0.0.1:";
    let start = line.find(needle)?;
    let after = &line[start + needle.len()..];
    let port_end = after.find('/')?;
    let port_str = &after[..port_end];
    let port: u16 = port_str.parse().ok()?;
    let rest = &after[port_end..];
    if !rest.starts_with("/v1") {
        return None;
    }
    let url = format!("{}{}{}", needle, port, "/v1");
    Some((port, url))
}

/// Set the global child status. Called from the spawn pipeline in Round-2.
pub fn set_status(s: ChildStatus) {
    if let Ok(mut g) = CHILD_STATUS.lock() {
        *g = s;
    }
}

/// Round-1 stub for the spawn pipeline. The full implementation lives in
/// Round-2; this stub exists so the Tauri command surface and the renderer
/// can be wired against a stable API.
///
/// Round-2 implementation will:
///   1. Resolve port (use `port_hint` or pick a free port via std::net).
///   2. Spawn `npx openai-oauth --port <P>` via `tokio::process::Command` with
///      `stdio = piped` and `kill_on_drop = true`.
///   3. Read stdout line-by-line until `parse_ready_line` returns Some(_) or
///      a 10s timeout fires.
///   4. Update `CHILD_STATUS` to `Ready { port, url }` or kill the child and
///      return `ReadyLineGrammarMismatch`.
pub async fn spawn_oauth_child(_port_hint: Option<u16>) -> Result<OAuthChild, OAuthChildError> {
    set_status(ChildStatus::Spawning);
    // Round-1 stub: deliberately does not actually spawn. The Round-2 wiring
    // replaces this body. Marking as Degraded here means the renderer can
    // still render the AuthStateIndicator's `degraded` state during Round-1
    // demos without a panic.
    set_status(ChildStatus::Degraded {
        reason: "Round-1 scaffold: spawn not yet wired".into(),
    });
    Err(OAuthChildError::SpawnFailed(
        "Round-1 scaffold: spawn not yet wired".into(),
    ))
}

/// Round-1 stub for graceful kill. Round-2 sends SIGTERM (or
/// `Child::kill().await` on Windows where SIGTERM is not native).
pub async fn kill_oauth_child(_child: OAuthChild) {
    set_status(ChildStatus::Idle);
}

/// Tauri command surface for the renderer.
#[tauri::command]
pub fn oauth_child_status() -> ChildStatus {
    CHILD_STATUS
        .lock()
        .map(|g| g.clone())
        .unwrap_or(ChildStatus::Degraded {
            reason: "status mutex poisoned".into(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_ready_line() {
        let line = "OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1";
        let parsed = parse_ready_line(line);
        assert_eq!(parsed, Some((10531, "http://127.0.0.1:10531/v1".to_string())));
    }

    #[test]
    fn rejects_non_v1_suffix() {
        let line = "http://127.0.0.1:10531/v2";
        assert_eq!(parse_ready_line(line), None);
    }

    #[test]
    fn rejects_non_loopback() {
        let line = "http://0.0.0.0:10531/v1";
        assert_eq!(parse_ready_line(line), None);
    }
}
