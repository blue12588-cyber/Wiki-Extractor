//! oauth_child — openai-oauth child process manager.
//!
//! Spawns `npx openai-oauth --port <P>` as a child process, parses the
//! ready-URL line from stdout, and exposes a Tauri command reporting the
//! current child status.
//!
//! Authority: agreed_contract.json#AC-OAUTH-PROXY + AC-CODEX-DETECT +
//! AC-GRACEFUL + AC-ENCAPSULATE + work_bundle.stop_conditions (ready-line
//! grammar mismatch -> contract_refresh_required).
//!
//! # Slice 5c — Round-2 spawn (ima2 oauthLauncher pattern, ported)
//!
//! The Round-1 scaffold (status enum + `parse_ready_line` + `oauth_child_status`
//! command) is now backed by a REAL spawn pipeline (recorded in
//! docs/adaptation-from-harness-core.md). The launcher mirrors ima2's
//! `oauthLauncher.startOAuthProxy`:
//!   - spawn `npx openai-oauth --port <P>` with piped stdout/stderr,
//!   - scan stdout/stderr line-by-line for the ready URL,
//!   - on `http://127.0.0.1:<port>/v1` → `ChildStatus::Ready { port, url }`,
//!   - 10s timeout with no ready line → kill child + `ReadyLineGrammarMismatch`,
//!   - early child exit → `EarlyExit` (degrade; the renderer falls back to
//!     copy-paste — the app never dies).
//!
//! # Hard boundaries (contract-mandated)
//!
//!   - **No auth-file access.** The openai-oauth child itself reads the codex
//!     `auth.json` token (ima2 pattern: openai-oauth has no login of its own —
//!     it proxies the codex token). THIS module never touches the auth file; it
//!     only spawns the child and observes stdout. The auth file stays off this
//!     code path entirely (only `external_dep_paths` may stat it).
//!   - **Loopback only.** The proxy binds `127.0.0.1`; the ready-line parser
//!     REJECTS any non-loopback host, so a misbehaving child that advertised a
//!     public bind would never be marked Ready.
//!   - **Graceful.** Every failure path sets a `Degraded` status (never panics),
//!     so the renderer can degrade to copy-paste with a clear Korean message.
//!
//! # Slice-9 cross-boundary spawn (AC-PROXY-ORIGIN)
//!
//! The proxy spawn now branches on WHERE codex auth was detected
//! (`codex_detect::CodexOrigin`):
//!
//!   - `windows` (or any non-Windows host) → spawn the proxy with the Windows /
//!     native codex toolchain as before (`cmd /C npx openai-oauth ...` on
//!     Windows, bare `npx ...` elsewhere).
//!   - `wsl` → the user's codex lives ONLY inside WSL Ubuntu, so the proxy is
//!     spawned cross-boundary via `wsl.exe -- npx openai-oauth --port <P>`. The
//!     proxy binds `127.0.0.1:<port>` inside WSL2; recent Windows reaches that
//!     loopback from the host via mirrored networking / port forwarding, so the
//!     parsed `http://127.0.0.1:<port>/v1` ready URL is used as-is (best-effort
//!     per the contract — WSL2 forwarding is verified later by the user).
//!
//! **Graceful degradation is mandatory**: if the cross-boundary spawn fails for
//! any reason (wsl.exe absent, npx missing in WSL, no ready line, port not
//! reachable from Windows), the spawn pipeline sets `Degraded` with a Korean
//! reason and the renderer falls back to copy-paste cleanly — never a crash,
//! never a hang (the bounded ready-timeout still applies to the WSL child).
//!
//! All new shell args are FIXED LITERALS (`wsl.exe`, `--`, `npx`,
//! `openai-oauth`, `--port`, and the numeric port) — no user input reaches them.

use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

use crate::codex_detect::{detect_codex, CodexOrigin};

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

/// The live child process handle (kept so the proxy stays up for the app's
/// lifetime and can be killed gracefully). `kill_on_drop` is set on spawn so an
/// app exit reaps the child even if `kill_oauth_child` is not called.
static CHILD_HANDLE: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Windows-only owner for the Job Object assigned to the app-spawned proxy
/// process tree. Reused/cached proxies are intentionally never assigned here:
/// the app only kills what it spawned in this session.
#[cfg(windows)]
static CHILD_JOB: Lazy<Mutex<Option<WindowsJob>>> = Lazy::new(|| Mutex::new(None));

/// Owning handle to a spawned openai-oauth child (renderer-facing summary; the
/// real `tokio::process::Child` lives in `CHILD_HANDLE`).
pub struct OAuthChild {
    pub port: u16,
    pub ready_url: String,
}

/// Spawn timeout for the ready line. The ima2 launcher uses no hard cap (it
/// restarts on exit); here a single bounded attempt is contract-aligned: a
/// missing ready line within the window routes to `ReadyLineGrammarMismatch`
/// (orchestrator stop_condition) rather than spinning forever.
// First run shells out to `npx -y openai-oauth`, which DOWNLOADS the package
// from npm on a cold cache before the proxy can print its ready URL. 12s was too
// short for that first fetch (it timed out → degrade → orphaned download). 60s
// covers a cold download; a warm npx cache resolves in ~1-2s so the longer
// ceiling only matters on the very first auto-mode run.
const READY_TIMEOUT_MS: u64 = 60_000;
const PROXY_HEALTH_TIMEOUT_MS: u64 = 800;

/// Windows `CREATE_NO_WINDOW` (0x0800_0000): the proxy is a long-running child;
/// without this flag `cmd /C npx …` pops a visible console window that lingers
/// for the life of the proxy. We run it hidden (stdout/stderr are already piped
/// and scanned for the ready URL).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
#[derive(Debug)]
struct WindowsJob {
    handle: usize,
}

#[cfg(windows)]
impl WindowsJob {
    fn handle(&self) -> HANDLE {
        self.handle as HANDLE
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle());
        }
    }
}

#[cfg(windows)]
fn create_kill_on_close_job() -> Option<WindowsJob> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return None;
        }

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            let _ = CloseHandle(job);
            return None;
        }

        Some(WindowsJob {
            handle: job as usize,
        })
    }
}

#[cfg(windows)]
fn assign_child_to_job(child: &Child, job: &WindowsJob) -> bool {
    let Some(pid) = child.id() else {
        return false;
    };

    unsafe {
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            return false;
        }
        let assigned = AssignProcessToJobObject(job.handle(), process) != 0;
        let _ = CloseHandle(process);
        assigned
    }
}

#[cfg(windows)]
fn close_owned_job() -> bool {
    CHILD_JOB.lock().ok().and_then(|mut g| g.take()).is_some()
}

#[cfg(not(windows))]
fn close_owned_job() -> bool {
    false
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

/// True iff a child is already tracked as Ready (so a second `oauth_proxy_start`
/// call is a cheap no-op rather than spawning a duplicate proxy).
fn already_ready() -> Option<(u16, String)> {
    if let Ok(g) = CHILD_STATUS.lock() {
        if let ChildStatus::Ready { port, url } = &*g {
            return Some((*port, url.clone()));
        }
    }
    None
}

fn proxy_cache_path() -> PathBuf {
    // Runtime-only reuse hint. Keep this independent from the process working
    // directory because release apps can be launched from Explorer, installers,
    // terminals, or shortcuts with different CWDs.
    std::env::temp_dir()
        .join("llmwiki")
        .join("runtime")
        .join("oauth_proxy.json")
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct CachedProxy {
    port: u16,
    url: String,
    pid: u32,
    origin: CodexOrigin,
    user_marker: String,
}

fn current_user_marker() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
}

fn read_cached_proxy(origin: CodexOrigin) -> Option<CachedProxy> {
    let txt = fs::read_to_string(proxy_cache_path()).ok()?;
    let cached: CachedProxy = serde_json::from_str(&txt).ok()?;
    let (port, url) = parse_ready_line(&cached.url)?;
    if port != cached.port {
        return None;
    }
    if cached.origin != origin || cached.user_marker != current_user_marker() || cached.pid == 0 {
        return None;
    }
    Some(CachedProxy {
        port,
        url,
        pid: cached.pid,
        origin: cached.origin,
        user_marker: cached.user_marker,
    })
}

fn write_cached_proxy(port: u16, url: &str, origin: CodexOrigin, pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    let path = proxy_cache_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let cached = CachedProxy {
        port,
        url: url.to_string(),
        pid,
        origin,
        user_marker: current_user_marker(),
    };
    if let Ok(txt) = serde_json::to_string(&cached) {
        let _ = fs::write(path, txt.as_bytes());
    }
}

fn clear_cached_proxy() {
    let _ = fs::remove_file(proxy_cache_path());
}

fn health_url_from_ready_url(url: &str) -> Option<String> {
    let (port, _) = parse_ready_line(url)?;
    Some(format!("http://127.0.0.1:{port}/health"))
}

fn models_url_from_ready_url(url: &str) -> Option<String> {
    let (port, _) = parse_ready_line(url)?;
    Some(format!("http://127.0.0.1:{port}/models"))
}

async fn probe_cached_proxy(origin: CodexOrigin) -> Option<(u16, String)> {
    let cached = read_cached_proxy(origin)?;
    if !probe_ready_url(&cached.url).await {
        clear_cached_proxy();
        return None;
    }
    // Reuse only when all three checks agree: the cached URL is healthy, the
    // proxy fingerprint looks like openai-oauth, and a port-bound openai-oauth
    // process is present. A generic localhost OpenAI-compatible server must not
    // receive the user's source text by accident.
    let process_ok = probe_cached_process(cached.pid, cached.port).await;
    let fingerprint_ok = probe_proxy_fingerprint(&cached.url).await;
    if process_ok && fingerprint_ok {
        return Some((cached.port, cached.url));
    }
    clear_cached_proxy();
    None
}

#[cfg(windows)]
async fn probe_cached_process(_pid: u32, port: u16) -> bool {
    let script = format!(
        r#"
$q = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {{ $_.CommandLine -match 'openai-oauth' -and $_.CommandLine -match '--port\s+{port}\b' }} |
  Select-Object -First 1
if ($q) {{ Write-Output 'ok' }}
"#
    );
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().await.ok();
    output
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .any(|line| line.trim() == "ok")
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
async fn probe_cached_process(_pid: u32, _port: u16) -> bool {
    // Non-Windows hosts cannot prove the cached PID is an openai-oauth process
    // bound to the cached port with the lightweight tools this app uses. Avoid
    // fail-open reuse; spawning a fresh proxy is safer than sending text to an
    // unproven localhost server.
    false
}

fn is_openai_oauth_fingerprint(text: &str) -> bool {
    text.contains("codex-oauth")
}

async fn probe_ready_url(url: &str) -> bool {
    let Some(health_url) = health_url_from_ready_url(url) else {
        return false;
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(PROXY_HEALTH_TIMEOUT_MS))
        .build()
        .ok();
    let Some(client) = client else {
        return false;
    };
    match client.get(health_url).send().await {
        Ok(resp) => resp.status().is_success(),
        _ => false,
    }
}

async fn probe_proxy_fingerprint(url: &str) -> bool {
    let Some(models_url) = models_url_from_ready_url(url) else {
        return false;
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(PROXY_HEALTH_TIMEOUT_MS))
        .build()
        .ok();
    let Some(client) = client else {
        return false;
    };
    let Ok(resp) = client.get(models_url).send().await else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    let Ok(text) = resp.text().await else {
        return false;
    };
    is_openai_oauth_fingerprint(&text)
}

/// Build the `npx openai-oauth --port <P>` spawn command for the detected codex
/// `origin` (Slice 9, AC-PROXY-ORIGIN). FIXED-LITERAL args only — the sole
/// interpolated value is the numeric `port` (a `u16`, never user text):
///
///   - `Wsl` → `wsl.exe -- npx openai-oauth --port <P>` (cross-boundary: the
///     user's codex lives in WSL; the proxy binds 127.0.0.1:<port> inside WSL2,
///     reachable from Windows via mirrored networking — best-effort).
///   - `Windows` → `cmd /C npx openai-oauth --port <P>` (the `.cmd` npm shim
///     needs cmd.exe to resolve on PATH).
///   - `None` on Windows → still `cmd /C npx ...` (no WSL detected; the spawn
///     will simply degrade if npx is also absent natively).
///   - any origin on a non-Windows host → bare `npx openai-oauth --port <P>`.
fn build_proxy_command(origin: CodexOrigin, port: u16) -> Command {
    let port_arg = port.to_string();
    // `-y` lets npx install `openai-oauth` non-interactively on first run (the
    // package is not pre-installed and the spawn has no TTY to answer a prompt).
    // All args remain fixed literals plus the numeric port — no user input.
    if cfg!(windows) {
        if origin == CodexOrigin::Wsl {
            // Cross-boundary: run the proxy inside WSL. Fixed-literal args.
            let mut c = Command::new("wsl.exe");
            c.args(["--", "npx", "-y", "openai-oauth", "--port", &port_arg]);
            c
        } else {
            // Windows-native: `npx` is a `.cmd` shim → route through cmd.exe.
            let mut c = Command::new("cmd");
            c.args(["/C", "npx", "-y", "openai-oauth", "--port", &port_arg]);
            c
        }
    } else {
        // Non-Windows: no WSL split; spawn npx directly.
        let mut c = Command::new("npx");
        c.args(["-y", "openai-oauth", "--port", &port_arg]);
        c
    }
}

/// Round-2 spawn pipeline (ima2 oauthLauncher pattern, ported; Slice-9
/// origin-branched).
///
///   1. Spawn `npx openai-oauth --port <P>` (P=0 → child picks a free port)
///      via `tokio::process::Command`, routed by the detected codex `origin`
///      (`wsl` → `wsl.exe -- npx …`; else `cmd /C npx …` / bare `npx …`),
///      stdout+stderr piped, `kill_on_drop`.
///   2. Read child stdout AND stderr line-by-line until `parse_ready_line`
///      returns Some(_) or the ready timeout fires.
///   3. On ready: store the child in `CHILD_HANDLE`, set `Ready { port, url }`.
///   4. On timeout: kill the child, return `ReadyLineGrammarMismatch`.
///   5. On early exit / spawn error: set `Degraded`, return the error variant.
///
/// The caller (a Tauri command) maps every error to a graceful degradation
/// signal; the app never dies on a failed spawn — including a failed
/// cross-boundary WSL spawn (AC-GRACEFUL + AC-PROXY-ORIGIN).
pub async fn spawn_oauth_child(
    port_hint: Option<u16>,
    origin: CodexOrigin,
) -> Result<OAuthChild, OAuthChildError> {
    // Idempotent: if a proxy is already Ready, reuse it.
    if let Some((port, url)) = already_ready() {
        if probe_ready_url(&url).await {
            return Ok(OAuthChild {
                port,
                ready_url: url,
            });
        }
        reset_tracked_child_for_respawn().await;
    }
    // App restarts lose the in-memory child handle, but a previous openai-oauth
    // proxy can still be alive on localhost. Reuse the cached ready URL when its
    // no-payload /health endpoint answers, so opening the app or starting a new
    // auto batch does not spawn another orphaned proxy.
    if let Some((port, url)) = probe_cached_proxy(origin).await {
        set_status(ChildStatus::Ready {
            port,
            url: url.clone(),
        });
        return Ok(OAuthChild {
            port,
            ready_url: url,
        });
    }

    set_status(ChildStatus::Spawning);
    let port = port_hint.unwrap_or(0);

    // Branch the spawn on the detected origin (Slice 9). Fixed-literal args.
    let mut command = build_proxy_command(origin, port);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Hide the console window the `cmd /C npx …` shim would otherwise pop.
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    #[cfg(windows)]
    let child_job = match create_kill_on_close_job() {
        Some(job) => job,
        None => {
            let reason =
                "openai-oauth 프로세스 보호용 Windows Job Object를 준비할 수 없습니다. 복붙 모드로 전환합니다."
                    .to_string();
            set_status(ChildStatus::Degraded {
                reason: reason.clone(),
            });
            return Err(OAuthChildError::SpawnFailed(reason));
        }
    };

    let mut child = command.spawn().map_err(|e| {
        // Origin-aware Korean reason: a WSL cross-boundary spawn failure is
        // attributed to WSL/wsl.exe so the user knows the fallback was attempted;
        // both reasons reassure that copy-paste keeps working (AC-GRACEFUL).
        let reason = if origin == CodexOrigin::Wsl {
            format!("WSL의 openai-oauth 프록시를 시작할 수 없습니다(wsl.exe/WSL 내 npx·Node 확인). 복붙 모드로 전환합니다: {e}")
        } else {
            format!("openai-oauth 자식 프로세스를 시작할 수 없습니다(npx/Node 확인). 복붙 모드로 전환합니다: {e}")
        };
        set_status(ChildStatus::Degraded { reason: reason.clone() });
        OAuthChildError::SpawnFailed(reason)
    })?;

    #[cfg(windows)]
    let child_job = if assign_child_to_job(&child, &child_job) {
        Some(child_job)
    } else {
        let _ = child.kill().await;
        let _ = child.wait().await;
        let reason =
            "openai-oauth 프로세스를 Windows Job Object에 묶지 못해 중지했습니다. 복붙 모드로 전환합니다."
                .to_string();
        set_status(ChildStatus::Degraded {
            reason: reason.clone(),
        });
        return Err(OAuthChildError::SpawnFailed(reason));
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Merge stdout + stderr line streams; openai-oauth prints the ready URL on
    // one of them depending on version.
    let ready = tokio::select! {
        biased;
        found = scan_for_ready(stdout, stderr) => found,
        _ = tokio::time::sleep(std::time::Duration::from_millis(READY_TIMEOUT_MS)) => None,
        status = child.wait() => {
            // Child exited before any ready line: degrade.
            let code = status.ok().and_then(|s| s.code());
            let reason = format!(
                "openai-oauth 자식이 준비 전에 종료되었습니다(code={code:?}). 복붙 모드로 전환합니다."
            );
            set_status(ChildStatus::Degraded { reason: reason.clone() });
            return Err(OAuthChildError::EarlyExit(reason));
        }
    };

    match ready {
        Some((port, url)) => {
            set_status(ChildStatus::Ready {
                port,
                url: url.clone(),
            });
            write_cached_proxy(port, &url, origin, child.id());
            if let Ok(mut g) = CHILD_HANDLE.lock() {
                *g = Some(child);
            }
            #[cfg(windows)]
            if let Some(job) = child_job {
                if let Ok(mut g) = CHILD_JOB.lock() {
                    *g = Some(job);
                }
            }
            Ok(OAuthChild {
                port,
                ready_url: url,
            })
        }
        None => {
            // No ready line within the window → grammar mismatch stop_condition.
            let _ = child.kill().await;
            set_status(ChildStatus::Degraded {
                reason: "ready URL(http://127.0.0.1:<port>/v1)을 시간 내에 받지 못했습니다. 복붙 모드로 전환합니다.".into(),
            });
            Err(OAuthChildError::ReadyLineGrammarMismatch)
        }
    }
}

/// Read stdout + stderr line-by-line, returning the first `(port, url)` that
/// `parse_ready_line` accepts. Returns None when both streams close without a
/// match (caller treats that as no-ready).
async fn scan_for_ready(
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
) -> Option<(u16, String)> {
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
            line = next_out => {
                match line {
                    Some(text) => {
                        if let Some(parsed) = parse_ready_line(&text) {
                            return Some(parsed);
                        }
                    }
                    None => {
                        // stdout closed; keep reading stderr if present.
                        out_lines = None;
                        if err_lines.is_none() {
                            return None;
                        }
                    }
                }
            }
            line = next_err => {
                match line {
                    Some(text) => {
                        if let Some(parsed) = parse_ready_line(&text) {
                            return Some(parsed);
                        }
                    }
                    None => {
                        err_lines = None;
                        if out_lines.is_none() {
                            return None;
                        }
                    }
                }
            }
        }
    }
}

/// Graceful kill: terminate the tracked child (if any) and reset status to Idle.
/// Best-effort — never panics. On Windows `Child::kill` maps to TerminateProcess.
pub async fn kill_oauth_child(_child: OAuthChild) {
    let taken = CHILD_HANDLE.lock().ok().and_then(|mut g| g.take());
    if let Some(mut c) = taken {
        let _ = c.kill().await;
        clear_cached_proxy();
    }
    if close_owned_job() {
        clear_cached_proxy();
    }
    set_status(ChildStatus::Idle);
}

async fn reset_tracked_child_for_respawn() {
    let taken = CHILD_HANDLE.lock().ok().and_then(|mut g| g.take());
    if let Some(mut c) = taken {
        let _ = c.kill().await;
    }
    let _ = close_owned_job();
    clear_cached_proxy();
    set_status(ChildStatus::Idle);
}

/// Synchronous shutdown path for app exit. `RunEvent::Exit` cannot await the
/// async Tauri command, so request a child kill immediately and close the owned
/// Windows Job Object. Closing the job reaps descendants such as `node.exe`.
/// Reused/discovered proxies are not in `CHILD_HANDLE`/`CHILD_JOB`, so they are
/// left alone.
pub fn shutdown_oauth_child_sync() {
    let taken = CHILD_HANDLE.lock().ok().and_then(|mut g| g.take());
    if let Some(mut c) = taken {
        let _ = c.start_kill();
        clear_cached_proxy();
    }
    if close_owned_job() {
        clear_cached_proxy();
    }
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

/// Tauri command: start (or reuse) the openai-oauth proxy and return the
/// resulting status. Idempotent — calling it while a proxy is Ready returns the
/// existing Ready status. On any failure it returns a `Degraded` status (NOT a
/// command error) so the renderer always gets a status object and degrades to
/// copy-paste gracefully (AC-GRACEFUL). The auto-LLM provider calls this once
/// when the user toggles auto mode on.
///
/// Slice-9 (AC-PROXY-ORIGIN): the spawn is branched on WHERE codex auth was
/// detected. We resolve the origin from a single READ-ONLY `detect_codex()` call
/// (login status only — zero auth.json writes), so a WSL-only codex install is
/// driven through `wsl.exe -- npx …` while a Windows-native install uses
/// `cmd /C npx …` as before. A failed cross-boundary spawn degrades gracefully.
#[tauri::command]
pub async fn oauth_proxy_start() -> ChildStatus {
    // READ-ONLY origin resolution: detect_codex runs `codex login status` only
    // and never writes the auth file. `origin` tells us which toolchain
    // (Windows-native vs WSL) backs the proxy spawn.
    let origin = detect_codex().origin;
    match spawn_oauth_child(None, origin).await {
        Ok(_) => oauth_child_status(),
        Err(_) => {
            // spawn_oauth_child already set a Degraded status with a Korean
            // reason; surface the current status (Degraded) to the renderer.
            oauth_child_status()
        }
    }
}

/// Tauri command: stop the proxy (graceful). Always returns Idle status.
#[tauri::command]
pub async fn oauth_proxy_stop() -> ChildStatus {
    kill_oauth_child(OAuthChild {
        port: 0,
        ready_url: String::new(),
    })
    .await;
    oauth_child_status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_ready_line() {
        let line = "OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1";
        let parsed = parse_ready_line(line);
        assert_eq!(
            parsed,
            Some((10531, "http://127.0.0.1:10531/v1".to_string()))
        );
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

    #[test]
    fn health_url_uses_proxy_root_not_v1_path() {
        assert_eq!(
            health_url_from_ready_url("http://127.0.0.1:61257/v1"),
            Some("http://127.0.0.1:61257/health".to_string())
        );
        assert_eq!(
            models_url_from_ready_url("http://127.0.0.1:61257/v1"),
            Some("http://127.0.0.1:61257/models".to_string())
        );
        assert_eq!(health_url_from_ready_url("http://0.0.0.0:61257/v1"), None);
        assert_eq!(models_url_from_ready_url("http://0.0.0.0:61257/v1"), None);
    }

    #[test]
    fn proxy_fingerprint_requires_codex_oauth_marker() {
        assert!(is_openai_oauth_fingerprint(
            r#"{"object":"list","data":[{"id":"codex-oauth"}]}"#
        ));
        assert!(!is_openai_oauth_fingerprint(
            r#"{"object":"list","data":[]}"#
        ));
    }

    // AC-PROXY-ORIGIN: build_proxy_command must branch on origin without
    // panicking and accept the numeric port as its only interpolated value.
    // (We cannot introspect tokio Command args cross-platform without spawning,
    // so this exercises the cfg/origin branches for shape safety.)
    #[test]
    fn build_proxy_command_branches_without_panic() {
        let _ = build_proxy_command(CodexOrigin::Windows, 0);
        let _ = build_proxy_command(CodexOrigin::Wsl, 10531);
        let _ = build_proxy_command(CodexOrigin::None, 8080);
    }

    // AC-PROXY-ORIGIN: source-level guard — the WSL arm routes through
    // `wsl.exe -- npx openai-oauth --port <P>` with FIXED-LITERAL args (no
    // user-input interpolation; the only non-literal is the numeric port). The
    // Windows-native arm keeps `cmd /C npx …`. Pins the routing shape so a future
    // edit cannot silently break the cross-boundary spawn or add an injection sink.
    #[test]
    fn proxy_spawn_origin_branch_is_fixed_literal() {
        let src = include_str!("oauth_child.rs");
        // WSL cross-boundary spawn.
        assert!(
            src.contains("Command::new(\"wsl.exe\")")
                && src.contains("\"--\", \"npx\", \"-y\", \"openai-oauth\", \"--port\", &port_arg"),
            "WSL proxy spawn must be `wsl.exe -- npx -y openai-oauth --port <P>` with fixed literals"
        );
        // Windows-native spawn (cmd shim).
        assert!(
            src.contains("Command::new(\"cmd\")")
                && src.contains("\"/C\", \"npx\", \"-y\", \"openai-oauth\", \"--port\", &port_arg"),
            "Windows-native proxy spawn must route `npx` through `cmd /C` with fixed literals"
        );
        // The spawn branches on the detected origin.
        assert!(
            src.contains("origin == CodexOrigin::Wsl"),
            "proxy spawn must branch on the detected codex origin"
        );
        let production_src = src.split("#[cfg(test)]").next().unwrap_or(src);
        assert!(
            src.contains("probe_cached_proxy(origin).await")
                && src.contains("probe_cached_process")
                && src.contains("probe_proxy_fingerprint")
                && src.contains("process_ok && fingerprint_ok")
                && src.contains("write_cached_proxy(port, &url, origin, child.id())")
                && production_src.contains("std::env::temp_dir()")
                && !production_src.contains("current_dir()")
                && src.contains("/health")
                && src.contains("/models"),
            "proxy start must probe app-owned cached localhost proxy before spawning a new one"
        );
        assert!(
            !production_src.contains("|| probe_proxy_fingerprint"),
            "cached proxy reuse must not accept process OR fingerprint; it must require both"
        );
        let object_list = format!("\"{}\":\"{}\"", "object", "list");
        assert!(
            !production_src.contains(&object_list),
            "cached proxy fingerprint must not accept a generic OpenAI-compatible /models object list"
        );
        assert!(
            src.contains("CreateJobObjectW")
                && src.contains("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE")
                && src.contains("AssignProcessToJobObject")
                && src.contains("Windows Job Object에 묶지 못해 중지했습니다")
                && src.contains("shutdown_oauth_child_sync"),
            "app-spawned proxy must be assigned to a Windows kill-on-close Job Object and expose a sync shutdown hook"
        );
        // No formatted/concatenated argument is passed to the proxy command
        // (only the numeric port, via `port.to_string()`, is interpolated). The
        // needles are built at runtime so this assertion's OWN source text does
        // not contain the literal it forbids (which would self-trip).
        let fmt = "format!";
        let arg_fmt = format!("c.arg({fmt}");
        let args_fmt = format!("c.args([{fmt}");
        assert!(
            !src.contains(&arg_fmt) && !src.contains(&args_fmt),
            "proxy spawn args must be fixed literals (no format-built args)"
        );
    }
}
