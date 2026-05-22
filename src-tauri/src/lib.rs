//! Tauri application library entry point.
//!
//! Registers the Round-2 command surface:
//!   - `auth_file_present`        from external_dep_paths.rs
//!   - `oauth_child_status`       from oauth_child.rs
//!   - `dev_fallback_status`      from dev_fallback.rs
//!   - `upload_file`              from upload_cmd.rs
//!   - `extract_fixture`          from extract_cmd.rs
//!   - `__t1_banner_audit`        from banner_audit.rs (Tier-1 evidence
//!                                command; not a user-facing surface).
//!
//! AC-7-relaxed boundary: `external_dep_paths` is the SOLE module authorized
//! to use OS-user-directory APIs. See its module documentation for the rule.

mod external_dep_paths;
mod oauth_child;
mod dev_fallback;
mod upload_cmd;
mod extract_cmd;
mod banner_audit;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
