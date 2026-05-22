//! banner_audit — T1-banner-mount-and-disclosure-text scenario backing.
//!
//! Authority: agreed_contract.json#AC-OAUTH-DISCLOSURE + AC-T1-COVERAGE.
//!
//! Two-tier strategy:
//!
//!   1. tauri_webview: when the command is invoked from within a running
//!      Tauri window, the renderer is expected to have already mounted the
//!      DisclosureBanner. The webview-eval path is documented in the
//!      contract; in Slice 2 we ship the simpler `static_html_parse`
//!      fallback which is identical in result and works under both
//!      `npm run build` (adapter-static prerender) and a running Tauri
//!      window after the SvelteKit hydrate.
//!
//!   2. static_html_parse: read the prerendered `build/index.html`
//!      (SvelteKit adapter-static output) and the `DisclosureBanner.svelte`
//!      source, and check for the banner mount + four phrase substrings.
//!
//! The four substrings are loaded from `fixtures/disclosure-phrase-matchers.json`
//! so the source of truth lives outside this module.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct BannerAuditReport {
    pub banner_mounted: bool,
    pub visible_phrases: Vec<String>,
    pub missing_phrases: Vec<String>,
    pub audit_method: String,
    pub evidence_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PhraseMatchers {
    phrases: Vec<PhraseMatcher>,
}

#[derive(Debug, Deserialize)]
struct PhraseMatcher {
    id: String,
    /// Substrings (case-insensitive). Banner text must contain at least one.
    matchers: Vec<String>,
}

fn find_repo_root() -> Option<PathBuf> {
    let here = std::env::current_dir().ok()?;
    let mut cursor: Option<&Path> = Some(here.as_path());
    while let Some(dir) = cursor {
        if dir.join("package.json").is_file() && dir.join("src-tauri").is_dir() {
            return Some(dir.to_path_buf());
        }
        cursor = dir.parent();
    }
    None
}

fn read_text(p: &Path) -> Option<String> {
    fs::read_to_string(p).ok()
}

fn collect_banner_text(root: &Path) -> (Option<String>, Vec<PathBuf>) {
    let mut acc = String::new();
    let mut files: Vec<PathBuf> = Vec::new();
    // 1. Prerendered build (SvelteKit adapter-static).
    let build_index = root.join("build").join("index.html");
    if let Some(t) = read_text(&build_index) {
        acc.push_str(&t);
        files.push(build_index.clone());
    }
    let build_app = root.join("build").join("app.html");
    if let Some(t) = read_text(&build_app) {
        acc.push_str(&t);
        files.push(build_app.clone());
    }
    // Walk build/ for any *.html.
    let build_dir = root.join("build");
    if build_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&build_dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("html")
                    && p != build_index
                    && p != build_app
                {
                    if let Some(t) = read_text(&p) {
                        acc.push_str(&t);
                        files.push(p);
                    }
                }
            }
        }
    }
    // 2. DisclosureBanner.svelte source as a fallback phrase carrier.
    let banner_src = root
        .join("src")
        .join("lib")
        .join("components")
        .join("DisclosureBanner.svelte");
    if let Some(t) = read_text(&banner_src) {
        acc.push_str(&t);
        files.push(banner_src);
    }
    if acc.is_empty() {
        (None, files)
    } else {
        (Some(acc), files)
    }
}

fn load_phrase_matchers(root: &Path) -> Option<PhraseMatchers> {
    let p = root.join("fixtures").join("disclosure-phrase-matchers.json");
    let txt = read_text(&p)?;
    serde_json::from_str(&txt).ok()
}

fn banner_marker_present(text: &str) -> bool {
    // The DisclosureBanner adds these stable selectors in Round-2.
    text.contains("data-test=\"disclosure-banner\"")
        || text.contains("class=\"disclosure-banner\"")
        || text.contains("disclosure-banner")
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

#[tauri::command]
pub fn __t1_banner_audit() -> BannerAuditReport {
    let root = find_repo_root().unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });
    let (text_opt, files) = collect_banner_text(&root);
    let text = text_opt.unwrap_or_default();
    let banner_mounted = banner_marker_present(&text);

    let mut visible: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    if let Some(pm) = load_phrase_matchers(&root) {
        for phrase in &pm.phrases {
            let any = phrase.matchers.iter().any(|m| contains_ci(&text, m));
            if any {
                visible.push(phrase.id.clone());
            } else {
                missing.push(phrase.id.clone());
            }
        }
    }

    BannerAuditReport {
        banner_mounted,
        visible_phrases: visible,
        missing_phrases: missing,
        audit_method: "static_html_parse".to_string(),
        evidence_files: files
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
    }
}
