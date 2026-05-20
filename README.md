# llmwiki

Standalone desktop wiki-extractor split from `harness-core` academic
extraction workflow. Single-user Windows binary.

**Status:** Slice 1 scaffold (in progress) — see
`docs/adaptation-from-harness-core.md` for adaptation log.

## Stack

- **Shell:** Tauri 2 (Rust + WebView2)
- **Frontend:** SvelteKit (TypeScript)
- **Sidecar:** TypeScript runner under `sidecar/` (extraction logic;
  deterministic in slice 1, LLM-assisted in slice 2+)
- **PDF:** pdfjs-dist (Apache-2.0)
- **Schema validation:** ajv (JSON Schema 2020-12)
- **Auth:** OpenAI Sign-in-with-ChatGPT (PKCE) with deterministic
  dev-fallback when the real OAuth client is unavailable

## Portability (AC-7 / AC-PORTABLE)

The app reads and writes **only** under its install folder
(`<install>\data\<provider>-<sub>\` for user data,
`<install>\data\sources\<source_id>\` for uploaded originals).
No `%APPDATA%`, no `app_data_dir()` API call in non-test code.
Moving the folder to another drive does not break startup.

## Slice 1 scope

- scaffold + git + lockfiles
- plaintext / Markdown / PDF input via drag-drop or file-picker
- deterministic extraction emitting ≥2 of 7 candidate types
- adapted JSON schemas + field-level diff vs harness-core
- OpenAI OAuth PKCE OR dev-fallback (with persistent UI banner)
- unsigned `tauri build` succeeds

## Out of slice 1

- signed `.exe` packaging and distribution
- auto-update / telemetry / analytics
- OCR for image-only PDFs
- HWPX / EPUB / URL inputs
- multi-user / shared-service mode
- LLM-assisted extraction (next slice)

## Build

```powershell
# first install (writes lockfiles)
npm install
cd src-tauri && cargo build && cd ..

# subsequent installs (lockfile-bound)
npm ci
cd src-tauri && cargo build --locked && cd ..

# dev
npx tauri dev

# unsigned release
npx tauri build
```

## Reference

This project adapts code and patterns from `harness-core` academic
extraction workflow. See `docs/adaptation-from-harness-core.md` for the
full source-by-source adaptation rationale and field-level schema diff.
