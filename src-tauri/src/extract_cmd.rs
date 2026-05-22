//! extract_cmd — host-side dispatcher to the TS candidate extractor.
//!
//! Authority: agreed_contract.json#AC-4 + AC-5 + AC-6.
//!
//! Design decision (recorded in r2_step_log): we keep the extraction logic
//! in TypeScript (`src/lib/extract/*.ts`) so it can run identically inside
//! the Vite preview, tests, and the Tauri renderer. The Rust-side Tauri
//! command here is a minimal pass-through that reads the file bytes from
//! disk and returns them to the renderer, which then runs the deterministic
//! extractor. This avoids shelling out to a Node subprocess from Rust
//! (slow, brittle on Windows path quoting) while still letting the renderer
//! invoke a single typed command.
//!
//! The renderer receives the bytes as a base64 string (Tauri 2 IPC
//! optimises this path internally). Slice-2 fixtures are small (≤ 1 MB);
//! larger inputs are out-of-scope.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FixtureBytes {
    pub source_id_hint: String,
    pub filename: String,
    pub bytes_b64: String,
}

#[derive(Debug, Serialize)]
pub struct ExtractError {
    pub kind: String,
    pub reason: String,
}

fn b64encode(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(bytes)
}

#[tauri::command]
pub fn extract_fixture(path: String) -> Result<FixtureBytes, ExtractError> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(ExtractError {
            kind: "not_found".into(),
            reason: format!("not a regular file: {}", path),
        });
    }
    let bytes = fs::read(&p).map_err(|e| ExtractError {
        kind: "io".into(),
        reason: format!("read failed: {e}"),
    })?;
    let filename = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "fixture.bin".into());
    let source_id_hint = format!("{}-len-{}", filename, bytes.len());
    Ok(FixtureBytes { source_id_hint, filename, bytes_b64: b64encode(&bytes) })
}
