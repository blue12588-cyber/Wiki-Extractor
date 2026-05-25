//! wiki_cmd — host-side persistent wiki store (read / write / list).
//!
//! Authority: agreed_contract.json#AC-WIKI-PERSIST + AC-EDIT-PERSIST + AC-OFFLINE.
//! Ported structure from: harness-core/knowledge/academic/wiki/** layout
//!   (`<entry>.md` + `index.json` + `links.json`) and the wiki-committer role's
//!   local_markdown target store. Adaptation recorded in
//!   docs/adaptation-from-harness-core.md.
//!
//! On-disk layout (all under the exe-local writable data root):
//!   wiki/<entry_id>.md   — human-readable, AI-readable, frontmatter + body
//!   wiki/index.json      — array of entry index records
//!   wiki/links.json      — array of relation records
//!   sources/<id>/chunks.jsonl  — written by chunk_cmd (AC-CHUNK)
//!
//! Every command in this module is FILE-SYSTEM ONLY — no network, no LLM, no
//! OS-user-directory access. This is the offline-safe view/edit/save path
//! (AC-OFFLINE): it must keep working with no auth and no connectivity.
//!
//! Path safety: every write target is canonicalized and asserted to live under
//! `<data_root>/wiki/` (re-using the same defense-in-depth pattern as
//! upload_cmd.rs). The entry id is sanitized to a safe filename leaf.

use std::fs;
use std::path::{Path, PathBuf};

use crate::portable_data_root;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct WikiError {
    pub kind: String,
    pub reason: String,
}

impl WikiError {
    fn of(kind: &str, reason: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            reason: reason.into(),
        }
    }
}

/* ---------------- Path resolution ---------------- */

fn resolve_root() -> Result<PathBuf, WikiError> {
    portable_data_root::data_root().map_err(|e| WikiError::of("io", e))
}

fn wiki_dir(root: &Path) -> PathBuf {
    root.join("wiki")
}

fn sources_dir(root: &Path) -> PathBuf {
    root.join("sources")
}

fn assert_under(root_sub: &Path, target: &Path) -> Result<(), WikiError> {
    let r = root_sub
        .canonicalize()
        .map_err(|e| WikiError::of("io", format!("canonicalize base failed: {e}")))?;
    let mut cursor: PathBuf = target.to_path_buf();
    while !cursor.exists() {
        match cursor.parent() {
            Some(p) => cursor = p.to_path_buf(),
            None => break,
        }
    }
    let t = cursor
        .canonicalize()
        .map_err(|e| WikiError::of("io", format!("canonicalize target failed: {e}")))?;
    if !t.starts_with(&r) {
        return Err(WikiError::of(
            "out_of_root",
            format!("path {} escapes {}", t.display(), r.display()),
        ));
    }
    Ok(())
}

/// Sanitize an entry id into a safe filename leaf (lowercase ascii-ish slug).
/// We accept the id the renderer computed but harden it against traversal.
fn sanitize_entry_id(id: &str) -> String {
    let leaf = Path::new(id)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| id.to_string());
    let cleaned: String = leaf
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "entry".to_string()
    } else {
        trimmed
    }
}

fn ensure_wiki_dir(root: &Path) -> Result<PathBuf, WikiError> {
    let dir = wiki_dir(root);
    fs::create_dir_all(&dir).map_err(|e| WikiError::of("io", format!("mkdir failed: {e}")))?;
    Ok(dir)
}

/* ---------------- Commands ---------------- */

#[derive(Debug, Serialize)]
pub struct WikiEntryFile {
    pub id: String,
    pub path: String,
    pub markdown: String,
}

/// Write (create or overwrite) one wiki entry markdown file. The renderer owns
/// the frontmatter + body composition (human-readable, AI-readable); this
/// command only persists the bytes safely under the exe-local wiki folder.
#[tauri::command]
pub fn wiki_write_entry(id: String, markdown: String) -> Result<WikiEntryFile, WikiError> {
    let root = resolve_root()?;
    wiki_write_entry_at(&root, id, markdown)
}

fn wiki_write_entry_at(
    root: &Path,
    id: String,
    markdown: String,
) -> Result<WikiEntryFile, WikiError> {
    let dir = ensure_wiki_dir(root)?;
    let leaf = sanitize_entry_id(&id);
    let dest = dir.join(format!("{leaf}.md"));
    assert_under(&dir, &dest)?;
    fs::write(&dest, markdown.as_bytes())
        .map_err(|e| WikiError::of("io", format!("write failed: {e}")))?;
    Ok(WikiEntryFile {
        id: leaf,
        path: dest.to_string_lossy().to_string(),
        markdown,
    })
}

/// Read one wiki entry markdown file by id. Returns NotFound if absent.
#[tauri::command]
pub fn wiki_read_entry(id: String) -> Result<WikiEntryFile, WikiError> {
    let root = resolve_root()?;
    wiki_read_entry_at(&root, id)
}

fn wiki_read_entry_at(root: &Path, id: String) -> Result<WikiEntryFile, WikiError> {
    let dir = wiki_dir(root);
    let leaf = sanitize_entry_id(&id);
    let path = dir.join(format!("{leaf}.md"));
    if !path.is_file() {
        return Err(WikiError::of("not_found", format!("no wiki entry: {leaf}")));
    }
    let markdown =
        fs::read_to_string(&path).map_err(|e| WikiError::of("io", format!("read failed: {e}")))?;
    Ok(WikiEntryFile {
        id: leaf,
        path: path.to_string_lossy().to_string(),
        markdown,
    })
}

#[derive(Debug, Serialize)]
pub struct WikiListItem {
    pub id: String,
    pub path: String,
}

/// List all entry ids present under data/wiki/ (the *.md files). Empty list when
/// the directory does not exist yet.
#[tauri::command]
pub fn wiki_list_entries() -> Result<Vec<WikiListItem>, WikiError> {
    let root = resolve_root()?;
    wiki_list_entries_at(&root)
}

fn wiki_list_entries_at(root: &Path) -> Result<Vec<WikiListItem>, WikiError> {
    let dir = wiki_dir(root);
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    let rd =
        fs::read_dir(&dir).map_err(|e| WikiError::of("io", format!("read_dir failed: {e}")))?;
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    // Deterministic ordering.
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                out.push(WikiListItem {
                    id: stem.to_string(),
                    path: p.to_string_lossy().to_string(),
                });
            }
        }
    }
    Ok(out)
}

/// Read the raw index.json text. Returns "[]" when absent (so the renderer can
/// always parse a valid empty array — offline-safe default).
#[tauri::command]
pub fn wiki_read_index() -> Result<String, WikiError> {
    let root = resolve_root()?;
    read_json_file_or_empty_array_at(&root, "index.json")
}

/// Overwrite index.json with the renderer-composed JSON text. The renderer
/// validates the shape against shared/schemas before calling.
#[tauri::command]
pub fn wiki_write_index(json: String) -> Result<String, WikiError> {
    let root = resolve_root()?;
    write_json_file_at(&root, "index.json", json)
}

/// Read the raw links.json text. Returns "[]" when absent.
#[tauri::command]
pub fn wiki_read_links() -> Result<String, WikiError> {
    let root = resolve_root()?;
    read_json_file_or_empty_array_at(&root, "links.json")
}

/// Overwrite links.json.
#[tauri::command]
pub fn wiki_write_links(json: String) -> Result<String, WikiError> {
    let root = resolve_root()?;
    write_json_file_at(&root, "links.json", json)
}

/// Delete one wiki entry markdown file. Idempotent (NotFound -> Ok(false)).
#[tauri::command]
pub fn wiki_delete_entry(id: String) -> Result<bool, WikiError> {
    let root = resolve_root()?;
    wiki_delete_entry_at(&root, id)
}

fn wiki_delete_entry_at(root: &Path, id: String) -> Result<bool, WikiError> {
    let dir = wiki_dir(root);
    let leaf = sanitize_entry_id(&id);
    let path = dir.join(format!("{leaf}.md"));
    if !path.exists() {
        return Ok(false);
    }
    assert_under(&dir, &path)?;
    fs::remove_file(&path).map_err(|e| WikiError::of("io", format!("remove failed: {e}")))?;
    Ok(true)
}

fn read_json_file_or_empty_array_at(root: &Path, name: &str) -> Result<String, WikiError> {
    let dir = wiki_dir(root);
    let path = dir.join(name);
    if !path.is_file() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(&path).map_err(|e| WikiError::of("io", format!("read failed: {e}")))
}

fn write_json_file_at(root: &Path, name: &str, json: String) -> Result<String, WikiError> {
    // Validate it parses as JSON before persisting (defense against corrupting
    // the store with a half-formed payload).
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| WikiError::of("bad_json", format!("payload is not valid JSON: {e}")))?;
    let dir = ensure_wiki_dir(root)?;
    let path = dir.join(name);
    assert_under(&dir, &path)?;
    fs::write(&path, json.as_bytes())
        .map_err(|e| WikiError::of("io", format!("write failed: {e}")))?;
    Ok(path.to_string_lossy().to_string())
}

/* ---------------- Chunk persistence (AC-CHUNK) ---------------- */

#[derive(Debug, Serialize)]
pub struct ChunkWriteResult {
    pub source_id: String,
    pub path: String,
    pub chunk_count: usize,
}

#[derive(Debug, Deserialize)]
pub struct ChunkWriteArgs {
    pub source_id: String,
    /// Pre-serialized JSONL produced by the deterministic TS chunker.
    pub jsonl: String,
}

/// Persist chunks.jsonl for a source under sources/<id>/chunks.jsonl.
/// The renderer runs the deterministic chunker and passes the JSONL string;
/// this command only writes it safely under the source dir.
#[tauri::command]
pub fn chunks_write(args: ChunkWriteArgs) -> Result<ChunkWriteResult, WikiError> {
    let root = resolve_root()?;
    chunks_write_at(&root, args)
}

fn chunks_write_at(root: &Path, args: ChunkWriteArgs) -> Result<ChunkWriteResult, WikiError> {
    let src_id = sanitize_entry_id(&args.source_id);
    let dir = sources_dir(root).join(&src_id);
    fs::create_dir_all(&dir).map_err(|e| WikiError::of("io", format!("mkdir failed: {e}")))?;
    let sources_base = sources_dir(root);
    let dest = dir.join("chunks.jsonl");
    assert_under(&sources_base, &dest)?;
    let chunk_count = args.jsonl.lines().filter(|l| !l.trim().is_empty()).count();
    fs::write(&dest, args.jsonl.as_bytes())
        .map_err(|e| WikiError::of("io", format!("write failed: {e}")))?;
    Ok(ChunkWriteResult {
        source_id: src_id,
        path: dest.to_string_lossy().to_string(),
        chunk_count,
    })
}

/// Read chunks.jsonl for a source. Returns empty string when absent.
#[tauri::command]
pub fn chunks_read(source_id: String) -> Result<String, WikiError> {
    let root = resolve_root()?;
    chunks_read_at(&root, source_id)
}

fn chunks_read_at(root: &Path, source_id: String) -> Result<String, WikiError> {
    let src_id = sanitize_entry_id(&source_id);
    let path = sources_dir(root).join(&src_id).join("chunks.jsonl");
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| WikiError::of("io", format!("read failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_traversal() {
        assert_eq!(sanitize_entry_id("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_entry_id("a/b/c"), "c");
        assert_eq!(sanitize_entry_id("hello world!"), "hello-world");
        assert_eq!(sanitize_entry_id(""), "entry");
        assert_eq!(sanitize_entry_id("..."), "entry");
        // Non-ASCII chars each map to '-' (safe leaf), so 의화 (2 chars) -> "--".
        assert_eq!(sanitize_entry_id("Concept_의화-01"), "Concept_---01");
        // A purely non-ASCII id collapses to the safe default after trimming '-'.
        assert_eq!(sanitize_entry_id("의화"), "entry");
    }

    /// AC-EDIT-PERSIST + AC-WIKI-PERSIST: write -> "restart" (fresh read call) ->
    /// content survives. AC-OFFLINE: this whole path is file-system only (no
    /// network / no LLM). Uses a per-test temp dir as the injected data root.
    #[test]
    fn persist_survives_restart() {
        let mut tmp = std::env::temp_dir();
        tmp.push(format!("llmwiki_wikitest_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let md = "---\nid: src1-n2\ntitle: 시편의 탄식\nstatus: draft\n---\n# 시편의 탄식\n";
        let w = wiki_write_entry_at(&tmp, "src1-n2".to_string(), md.to_string()).expect("write");
        assert!(w.path.contains("wiki"));

        // Simulate restart: a brand-new read call re-resolves from disk.
        let r = wiki_read_entry_at(&tmp, "src1-n2".to_string()).expect("read after restart");
        assert_eq!(r.markdown, md);
        assert!(
            r.markdown.contains("시편의 탄식"),
            "korean content preserved on disk"
        );

        // index.json + links.json round-trip.
        write_json_file_at(&tmp, "index.json", "[{\"id\":\"src1-n2\"}]".to_string())
            .expect("write index");
        let idx = read_json_file_or_empty_array_at(&tmp, "index.json").expect("read index");
        assert!(idx.contains("src1-n2"));
        let empty_links =
            read_json_file_or_empty_array_at(&tmp, "links.json").expect("read links default");
        assert_eq!(empty_links, "[]");

        // chunks.jsonl persistence.
        let cw = chunks_write_at(
            &tmp,
            ChunkWriteArgs {
                source_id: "abc123".to_string(),
                jsonl: "{\"chunk_id\":\"x\"}\n{\"chunk_id\":\"y\"}\n".to_string(),
            },
        )
        .expect("chunks write");
        assert_eq!(cw.chunk_count, 2);
        let cr = chunks_read_at(&tmp, "abc123".to_string()).expect("chunks read");
        assert!(cr.contains("\"chunk_id\":\"x\""));

        // bad json is rejected (store integrity).
        assert!(write_json_file_at(&tmp, "index.json", "{not json".to_string()).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
