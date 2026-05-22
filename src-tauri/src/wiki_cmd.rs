//! wiki_cmd — host-side persistent wiki store (read / write / list).
//!
//! Authority: agreed_contract.json#AC-WIKI-PERSIST + AC-EDIT-PERSIST + AC-OFFLINE.
//! Ported structure from: harness-core/knowledge/academic/wiki/** layout
//!   (`<entry>.md` + `index.json` + `links.json`) and the wiki-committer role's
//!   local_markdown target store. Adaptation recorded in
//!   docs/adaptation-from-harness-core.md.
//!
//! On-disk layout (all under the target project root, never %APPDATA%):
//!   data/wiki/<entry_id>.md   — human-readable, AI-readable, frontmatter + body
//!   data/wiki/index.json      — array of entry index records
//!   data/wiki/links.json      — array of relation records
//!   data/sources/<id>/chunks.jsonl  — written by chunk_cmd (AC-CHUNK)
//!
//! Every command in this module is FILE-SYSTEM ONLY — no network, no LLM, no
//! OS-user-directory access. This is the offline-safe view/edit/save path
//! (AC-OFFLINE): it must keep working with no auth and no connectivity.
//!
//! Path safety: every write target is canonicalized and asserted to live under
//! `<root>/data/wiki/` (re-using the same defense-in-depth pattern as
//! upload_cmd.rs). The entry id is sanitized to a safe filename leaf.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct WikiError {
    pub kind: String,
    pub reason: String,
}

impl WikiError {
    fn of(kind: &str, reason: impl Into<String>) -> Self {
        Self { kind: kind.into(), reason: reason.into() }
    }
}

/* ---------------- Path resolution (manual; no APPDATA) ---------------- */

fn resolve_root() -> Result<PathBuf, WikiError> {
    // Same policy as upload_cmd::resolve_root — the host runs from the target
    // project root. We deliberately do NOT consult OS-user-directory APIs here;
    // that boundary is owned solely by external_dep_paths.rs.
    std::env::current_dir().map_err(|e| WikiError::of("io", format!("current_dir failed: {e}")))
}

fn wiki_dir(root: &Path) -> PathBuf {
    root.join("data").join("wiki")
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
/// command only persists the bytes safely under data/wiki/.
#[tauri::command]
pub fn wiki_write_entry(id: String, markdown: String) -> Result<WikiEntryFile, WikiError> {
    let root = resolve_root()?;
    let dir = ensure_wiki_dir(&root)?;
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
    let dir = wiki_dir(&root);
    let leaf = sanitize_entry_id(&id);
    let path = dir.join(format!("{leaf}.md"));
    if !path.is_file() {
        return Err(WikiError::of("not_found", format!("no wiki entry: {leaf}")));
    }
    let markdown =
        fs::read_to_string(&path).map_err(|e| WikiError::of("io", format!("read failed: {e}")))?;
    Ok(WikiEntryFile { id: leaf, path: path.to_string_lossy().to_string(), markdown })
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
    let dir = wiki_dir(&root);
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    let rd = fs::read_dir(&dir).map_err(|e| WikiError::of("io", format!("read_dir failed: {e}")))?;
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
    read_json_file_or_empty_array("index.json")
}

/// Overwrite index.json with the renderer-composed JSON text. The renderer
/// validates the shape against shared/schemas before calling.
#[tauri::command]
pub fn wiki_write_index(json: String) -> Result<String, WikiError> {
    write_json_file("index.json", json)
}

/// Read the raw links.json text. Returns "[]" when absent.
#[tauri::command]
pub fn wiki_read_links() -> Result<String, WikiError> {
    read_json_file_or_empty_array("links.json")
}

/// Overwrite links.json.
#[tauri::command]
pub fn wiki_write_links(json: String) -> Result<String, WikiError> {
    write_json_file("links.json", json)
}

/// Delete one wiki entry markdown file. Idempotent (NotFound -> Ok(false)).
#[tauri::command]
pub fn wiki_delete_entry(id: String) -> Result<bool, WikiError> {
    let root = resolve_root()?;
    let dir = wiki_dir(&root);
    let leaf = sanitize_entry_id(&id);
    let path = dir.join(format!("{leaf}.md"));
    if !path.exists() {
        return Ok(false);
    }
    assert_under(&dir, &path)?;
    fs::remove_file(&path).map_err(|e| WikiError::of("io", format!("remove failed: {e}")))?;
    Ok(true)
}

fn read_json_file_or_empty_array(name: &str) -> Result<String, WikiError> {
    let root = resolve_root()?;
    let dir = wiki_dir(&root);
    let path = dir.join(name);
    if !path.is_file() {
        return Ok("[]".to_string());
    }
    fs::read_to_string(&path).map_err(|e| WikiError::of("io", format!("read failed: {e}")))
}

fn write_json_file(name: &str, json: String) -> Result<String, WikiError> {
    // Validate it parses as JSON before persisting (defense against corrupting
    // the store with a half-formed payload).
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| WikiError::of("bad_json", format!("payload is not valid JSON: {e}")))?;
    let root = resolve_root()?;
    let dir = ensure_wiki_dir(&root)?;
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

/// Persist chunks.jsonl for a source under data/sources/<id>/chunks.jsonl.
/// The renderer runs the deterministic chunker and passes the JSONL string;
/// this command only writes it safely under the source dir.
#[tauri::command]
pub fn chunks_write(args: ChunkWriteArgs) -> Result<ChunkWriteResult, WikiError> {
    let root = resolve_root()?;
    let src_id = sanitize_entry_id(&args.source_id);
    let dir = root.join("data").join("sources").join(&src_id);
    fs::create_dir_all(&dir).map_err(|e| WikiError::of("io", format!("mkdir failed: {e}")))?;
    let sources_base = root.join("data").join("sources");
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
    let src_id = sanitize_entry_id(&source_id);
    let path = root.join("data").join("sources").join(&src_id).join("chunks.jsonl");
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
    /// network / no LLM). Uses a per-test temp dir as the resolved root.
    ///
    /// `current_dir` is process-global so this single serialized test sets it,
    /// exercises the persistence round trip, and restores it.
    #[test]
    fn persist_survives_restart() {
        let saved_cwd = std::env::current_dir().unwrap();
        let mut tmp = std::env::temp_dir();
        tmp.push(format!("llmwiki_wikitest_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        std::env::set_current_dir(&tmp).unwrap();

        let md = "---\nid: src1-n2\ntitle: 시편의 탄식\nstatus: draft\n---\n# 시편의 탄식\n";
        let w = wiki_write_entry("src1-n2".to_string(), md.to_string()).expect("write");
        assert!(w.path.contains("data"));

        // Simulate restart: a brand-new read call re-resolves from disk.
        let r = wiki_read_entry("src1-n2".to_string()).expect("read after restart");
        assert_eq!(r.markdown, md);
        assert!(r.markdown.contains("시편의 탄식"), "korean content preserved on disk");

        // index.json + links.json round-trip.
        wiki_write_index("[{\"id\":\"src1-n2\"}]".to_string()).expect("write index");
        let idx = wiki_read_index().expect("read index");
        assert!(idx.contains("src1-n2"));
        let empty_links = wiki_read_links().expect("read links default");
        assert_eq!(empty_links, "[]");

        // chunks.jsonl persistence.
        let cw = chunks_write(ChunkWriteArgs {
            source_id: "abc123".to_string(),
            jsonl: "{\"chunk_id\":\"x\"}\n{\"chunk_id\":\"y\"}\n".to_string(),
        })
        .expect("chunks write");
        assert_eq!(cw.chunk_count, 2);
        let cr = chunks_read("abc123".to_string()).expect("chunks read");
        assert!(cr.contains("\"chunk_id\":\"x\""));

        // bad json is rejected (store integrity).
        assert!(wiki_write_index("{not json".to_string()).is_err());

        std::env::set_current_dir(&saved_cwd).unwrap();
        let _ = fs::remove_dir_all(&tmp);
    }
}
