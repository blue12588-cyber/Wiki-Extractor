//! upload_cmd — host-side file ingest.
//!
//! Authority: agreed_contract.json#AC-UPLOAD.
//!
//! Tauri command: `upload_file(path: String) -> Result<UploadResult, UploadError>`.
//!
//! Behaviour:
//!   1. Read the file from disk.
//!   2. Verify magic bytes against the declared extension (Rust-side parity
//!      with `src/lib/upload/magicBytes.ts`).
//!   3. Compute SHA-256 hex prefix (16 chars) → `source_id`.
//!   4. Resolve the project root (current working dir of the Tauri host
//!      process; the `data/sources/` dir is created on first use).
//!   5. Refuse to write outside `<target_root>/data/sources/<source_id>/`.
//!   6. Copy the file into the resolved directory using the original file
//!      name (sanitized to a safe leaf).
//!
//! Forbidden side effect audit: the resolved destination path is
//! canonicalized and compared to the resolved project root. If the
//! destination escapes the root (e.g. via crafted `..` segments in the
//! original filename), the upload is refused with `UploadError::OutOfRoot`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

const SOURCE_ID_PREFIX_LEN: usize = 16;
const READ_HEAD_LEN: usize = 256;

#[derive(Debug, Serialize)]
pub struct UploadResult {
    pub source_id: String,
    pub written_path: String,
    pub byte_count: u64,
    pub detected_type: String,
}

#[derive(Debug, Serialize)]
pub struct UploadError {
    pub kind: String,
    pub reason: String,
}

impl UploadError {
    fn of(kind: &str, reason: impl Into<String>) -> Self {
        Self { kind: kind.into(), reason: reason.into() }
    }
}

/* ---------------- Magic bytes (Rust-side parity) ---------------- */

const PDF_MAGIC: &[u8] = b"%PDF-";
const MZ_MAGIC: &[u8] = b"MZ";
const ELF_MAGIC: &[u8] = b"\x7fELF";
const ZIP_MAGIC: &[u8] = b"PK\x03\x04";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeclaredType {
    Pdf,
    Markdown,
    Plaintext,
}

fn declared_type(name: &str) -> DeclaredType {
    let lower = name.to_lowercase();
    if lower.ends_with(".pdf") {
        DeclaredType::Pdf
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        DeclaredType::Markdown
    } else {
        DeclaredType::Plaintext
    }
}

fn starts_with(buf: &[u8], needle: &[u8]) -> bool {
    buf.len() >= needle.len() && &buf[..needle.len()] == needle
}

fn is_utf8(buf: &[u8]) -> bool {
    std::str::from_utf8(buf).is_ok()
}

fn detect_type_label(declared: DeclaredType) -> &'static str {
    match declared {
        DeclaredType::Pdf => "pdf",
        DeclaredType::Markdown => "markdown",
        DeclaredType::Plaintext => "plaintext",
    }
}

fn verify_magic_bytes(name: &str, head: &[u8]) -> Result<DeclaredType, UploadError> {
    let declared = declared_type(name);
    if declared == DeclaredType::Pdf {
        if starts_with(head, PDF_MAGIC) {
            return Ok(declared);
        }
        return Err(UploadError::of(
            "magic_bytes_mismatch",
            "declared .pdf but signature is not %PDF-",
        ));
    }
    // text-like declared: reject other binary signatures
    if starts_with(head, PDF_MAGIC) {
        return Err(UploadError::of(
            "magic_bytes_mismatch",
            format!(
                "declared .{} but signature is %PDF-",
                if declared == DeclaredType::Markdown { "md" } else { "txt" }
            ),
        ));
    }
    if starts_with(head, MZ_MAGIC) {
        return Err(UploadError::of(
            "magic_bytes_mismatch",
            "Windows PE/MZ executable signature detected",
        ));
    }
    if starts_with(head, ELF_MAGIC) {
        return Err(UploadError::of("magic_bytes_mismatch", "ELF executable signature detected"));
    }
    if starts_with(head, ZIP_MAGIC) {
        return Err(UploadError::of("magic_bytes_mismatch", "ZIP container signature detected"));
    }
    if !is_utf8(head) {
        return Err(UploadError::of(
            "magic_bytes_mismatch",
            "declared text-like file but bytes are not valid UTF-8",
        ));
    }
    Ok(declared)
}

/* ---------------- Path safety ---------------- */

fn sanitize_leaf(name: &str) -> String {
    // Drop directory separators and traversal segments.
    let leaf = Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    // Defensive: replace control chars / colons (Windows).
    leaf.chars()
        .map(|c| if c.is_control() || c == ':' || c == '\\' || c == '/' { '_' } else { c })
        .collect()
}

fn resolve_root() -> Result<PathBuf, UploadError> {
    // The Tauri host runs from the target project root in dev; in production
    // builds we rely on `current_dir` having been set by the launcher.
    // We do NOT call `app_data_dir` / `home_dir` / `APPDATA` here: AC-7-relaxed
    // bounds OS-user-directory accessors to `external_dep_paths.rs`.
    let root = std::env::current_dir()
        .map_err(|e| UploadError::of("io", format!("current_dir failed: {e}")))?;
    Ok(root)
}

fn assert_under_root(root: &Path, target: &Path) -> Result<(), UploadError> {
    let r = root
        .canonicalize()
        .map_err(|e| UploadError::of("io", format!("canonicalize root failed: {e}")))?;
    // The target may not exist yet; canonicalize its existing ancestor.
    let mut cursor: PathBuf = target.to_path_buf();
    while !cursor.exists() {
        match cursor.parent() {
            Some(p) => cursor = p.to_path_buf(),
            None => break,
        }
    }
    let t = cursor
        .canonicalize()
        .map_err(|e| UploadError::of("io", format!("canonicalize target failed: {e}")))?;
    if !t.starts_with(&r) {
        return Err(UploadError::of(
            "out_of_root",
            format!("destination {} escapes target root {}", t.display(), r.display()),
        ));
    }
    Ok(())
}

/* ---------------- SHA-256 ---------------- */

fn sha256_prefix(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest.iter() {
        hex.push_str(&format!("{:02x}", b));
    }
    hex[..SOURCE_ID_PREFIX_LEN].to_string()
}

/* ---------------- Tauri command ---------------- */

/// Shared ingest body: verify magic bytes, hash → source_id, write the bytes
/// into `<root>/data/sources/<source_id>/<sanitized-name>` (path-safe). Both the
/// disk-path command (`upload_file`) and the in-memory-bytes command
/// (`upload_bytes`) funnel through here so the magic-bytes / hashing /
/// out-of-root guards are identical regardless of how the bytes arrived.
///
/// `upload_bytes` is the path the renderer actually uses: a WebView2 `File`
/// object exposes NO `.path` (the non-standard Electron field does not exist),
/// so the renderer reads the bytes it already has (for the magic-byte check) and
/// hands them to the host directly — no OS path needed for picker OR drag-drop.
fn ingest_bytes(original_name: &str, buf: &[u8]) -> Result<UploadResult, UploadError> {
    // Magic-bytes check on the first READ_HEAD_LEN bytes.
    let head_len = std::cmp::min(buf.len(), READ_HEAD_LEN);
    let declared = verify_magic_bytes(original_name, &buf[..head_len])?;
    let detected = detect_type_label(declared).to_string();

    let source_id = sha256_prefix(buf);

    let root = resolve_root()?;
    let dest_dir = root.join("data").join("sources").join(&source_id);
    let leaf = sanitize_leaf(original_name);
    let dest = dest_dir.join(&leaf);

    fs::create_dir_all(&dest_dir)
        .map_err(|e| UploadError::of("io", format!("mkdir failed: {e}")))?;

    assert_under_root(&root, &dest)?;

    fs::write(&dest, buf)
        .map_err(|e| UploadError::of("io", format!("write failed: {e}")))?;

    let written = dest.to_string_lossy().to_string();
    let byte_count = buf.len() as u64;

    Ok(UploadResult { source_id, written_path: written, byte_count, detected_type: detected })
}

#[tauri::command]
pub fn upload_file(path: String) -> Result<UploadResult, UploadError> {
    let src_path = PathBuf::from(&path);
    if !src_path.is_file() {
        return Err(UploadError::of("not_found", format!("not a regular file: {}", path)));
    }

    // Read file fully (Slice 2 files are user-uploaded plaintext/MD/PDF — small).
    let mut f = fs::File::open(&src_path)
        .map_err(|e| UploadError::of("io", format!("open failed: {e}")))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| UploadError::of("io", format!("read failed: {e}")))?;

    let original_name = src_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload.bin".into());

    ingest_bytes(&original_name, &buf)
}

/// In-memory upload: the renderer passes the file's bytes (a WebView2 `File` has
/// no usable OS path) plus the original filename. Same magic-byte / hashing /
/// out-of-root guards as `upload_file`. This is the command the renderer invokes
/// for both the file picker and drag-drop.
#[tauri::command]
pub fn upload_bytes(filename: String, bytes: Vec<u8>) -> Result<UploadResult, UploadError> {
    ingest_bytes(&filename, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_prefix_is_16_hex() {
        let s = sha256_prefix(b"hello");
        assert_eq!(s.len(), 16);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn magic_bytes_pdf_ok() {
        let r = verify_magic_bytes("a.pdf", b"%PDF-1.7\n...");
        assert!(r.is_ok());
    }

    #[test]
    fn magic_bytes_mismatch_pdf_decl_text() {
        let r = verify_magic_bytes("a.txt", b"%PDF-1.7\n");
        assert!(r.is_err());
    }

    #[test]
    fn magic_bytes_text_ok() {
        let r = verify_magic_bytes("a.txt", b"hello world\n");
        assert!(r.is_ok());
    }

    #[test]
    fn magic_bytes_mz_in_text() {
        let r = verify_magic_bytes("a.md", b"MZ\x90\x00\x03");
        assert!(r.is_err());
    }
}
