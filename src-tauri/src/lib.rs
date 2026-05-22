//! Tauri application library entry point.
//!
//! Registers the command surface:
//!   - `auth_file_present`        from external_dep_paths.rs
//!   - `oauth_child_status`       from oauth_child.rs
//!   - `dev_fallback_status`      from dev_fallback.rs
//!   - `upload_file`              from upload_cmd.rs
//!   - `extract_fixture`          from extract_cmd.rs
//!   - `__t1_banner_audit`        from banner_audit.rs (Tier-1 evidence
//!                                command; not a user-facing surface).
//!   - wiki persistence (Slice 3, wiki_cmd.rs):
//!       `wiki_write_entry`, `wiki_read_entry`, `wiki_list_entries`,
//!       `wiki_delete_entry`, `wiki_read_index`, `wiki_write_index`,
//!       `wiki_read_links`, `wiki_write_links`, `chunks_write`, `chunks_read`.
//!   - LLM extraction (Slice 3, llm_cmd.rs):
//!       `llm_config`, `llm_extract`, `llm_classify`, `llm_translate`.
//!
//! AC-7-relaxed boundary: `external_dep_paths` is the SOLE module authorized
//! to use OS-user-directory APIs. See its module documentation for the rule.

mod external_dep_paths;
mod oauth_child;
mod dev_fallback;
mod upload_cmd;
mod extract_cmd;
mod banner_audit;
mod wiki_cmd;
mod llm_cmd;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            external_dep_paths::auth_file_present,
            oauth_child::oauth_child_status,
            dev_fallback::dev_fallback_status,
            upload_cmd::upload_file,
            extract_cmd::extract_fixture,
            banner_audit::__t1_banner_audit,
            wiki_cmd::wiki_write_entry,
            wiki_cmd::wiki_read_entry,
            wiki_cmd::wiki_list_entries,
            wiki_cmd::wiki_delete_entry,
            wiki_cmd::wiki_read_index,
            wiki_cmd::wiki_write_index,
            wiki_cmd::wiki_read_links,
            wiki_cmd::wiki_write_links,
            wiki_cmd::chunks_write,
            wiki_cmd::chunks_read,
            llm_cmd::llm_config,
            llm_cmd::llm_extract,
            llm_cmd::llm_classify,
            llm_cmd::llm_translate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
