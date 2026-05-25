//! Tauri application library entry point.
//!
//! Registers the command surface:
//!   - `auth_file_present`        from external_dep_paths.rs
//!   - `codex_detect`             from codex_detect.rs (Slice 5c, read-only)
//!   - `codex_login_start`        from codex_login.rs (Slice 6, spawn-only;
//!                                app writes ZERO to auth.json — codex does)
//!   - `oauth_child_status`       from oauth_child.rs
//!   - `oauth_proxy_start/stop`   from oauth_child.rs (Slice 5c, Round-2 spawn)
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
//!   - Auto-LLM wiki extraction (Slice 5c, llm_cmd.rs):
//!       `llm_extract_wiki` (5b prompt -> proxy -> raw text; renderer reuses
//!       the 5b parse/validate/import pipeline, so the anti-forgery gate binds
//!       the auto response identically).
//!
//! AC-7-relaxed boundary: `external_dep_paths` owns auth/tool discovery under
//! user directories. App content storage is exe-local via `portable_data_root`
//! so the release folder remains an independent unit.

mod banner_audit;
mod codex_detect;
mod codex_login;
mod dev_fallback;
mod external_dep_paths;
mod extract_cmd;
mod llm_cmd;
mod oauth_child;
mod portable_data_root;
mod upload_cmd;
mod wiki_cmd;

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
            codex_detect::codex_detect,
            codex_login::codex_login_start,
            oauth_child::oauth_child_status,
            oauth_child::oauth_proxy_start,
            oauth_child::oauth_proxy_stop,
            dev_fallback::dev_fallback_status,
            upload_cmd::upload_file,
            upload_cmd::upload_bytes,
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
            llm_cmd::llm_extract_wiki,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                oauth_child::shutdown_oauth_child_sync();
            }
        });
}
