//! portable_data_root — exe-local writable data root.
//!
//! llmwiki is distributed as a self-contained desktop folder. Persistent user
//! data should live next to the executable, not under the process working
//! directory and not under OS profile folders. This keeps the release folder
//! portable and inspectable as one independent unit.

use std::path::PathBuf;

pub fn data_root() -> Result<PathBuf, String> {
    let exe =
        std::env::current_exe().map_err(|e| format!("실행 파일 위치를 확인할 수 없습니다: {e}"))?;
    let Some(exe_dir) = exe.parent() else {
        return Err("실행 파일 폴더를 확인할 수 없습니다.".to_string());
    };
    Ok(exe_dir.join("data"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_root_is_next_to_current_exe() {
        let exe = std::env::current_exe().expect("current exe");
        let exe_dir = exe.parent().expect("exe parent");
        assert_eq!(data_root().expect("data root"), exe_dir.join("data"));
    }
}
