# llmwiki

Desktop extraction app: Tauri 2 shell + SvelteKit (static) UI + Rust commands. Built to take user-uploaded sources (plaintext, Markdown, PDF), split them into chunks, extract academic wiki candidates, and let the user review evidence before saving draft wiki entries.

**Status**: Offline extraction, copy-paste bridge, optional Codex/openai-oauth automatic extraction, diagnostic reports, and Windows Tauri bundles are implemented. Current local verification produces both MSI and NSIS installers.

## Stack

- **Shell**: Tauri 2.11 (Rust 2021 edition, MSRV 1.77.2)
- **UI**: SvelteKit 2.57 + Svelte 5.55 (runes mode) + Vite 6.3
- **Adapter**: `@sveltejs/adapter-static` (no SSR; Tauri serves the prerendered SPA from `build/` via `tauri://localhost`)
- **TypeScript**: 5.9
- **Rust backend**: Tauri commands under `src-tauri/src/` for upload validation, wiki persistence, Codex detection/login, and OAuth proxy lifecycle.

## Layout

```
.
+- src/                      SvelteKit source (routes, lib)
|  +- routes/                page components + +layout.ts (prerender=true, ssr=false)
|  +- lib/
|     +- bridge/             copy-paste / automatic LLM prompt, parse, validation, import
|     +- candidate/          rule-engine scoring and candidate card model
|     +- chunk/              deterministic source chunking
|     +- components/         Korean UI components
|     +- extract/            offline txt/md/pdf candidate extraction
|     +- pipeline/           upload -> extract -> score -> build workflow state
|     +- upload/             drag/drop + magic-bytes validation
|
+- src-tauri/                Tauri shell (Rust)
|  +- src/                   lib.rs + main.rs
|  +- icons/                 bundle icons
|  +- capabilities/          permission scopes
|  +- Cargo.toml             pinned tauri 2.11.2, tauri-plugin-log 2
|
+- shared/schemas/           shared JSON-Schema for candidate items
+- fixtures/                 deterministic smoke fixtures for extraction, bridge, diagnostics, auth/proxy
+- docs/
|  +- adaptation-from-harness-core.md   upstream commit ref + per-file diff policy
+- build/                    SvelteKit static output (consumed by Tauri); regenerated on every npm run build
```

## Prerequisites

| tool   | version known to work | notes |
|--------|-----------------------|-------|
| Node   | 20.15.0               | Node 20.19+ or 22.12+ recommended; older deps pinned in `package.json` to support 20.15 |
| npm    | 10.7.0                | bundled with Node 20.15 |
| Rust   | 1.95.0 (stable)       | install via `rustup`; MSRV 1.77.2 per `src-tauri/Cargo.toml` |
| Cargo  | 1.95.0                | bundled with Rust toolchain |
| **Visual Studio Build Tools** (Windows) | **2019 or later, "Desktop development with C++" workload** | provides `link.exe` — required for `cargo build` on `x86_64-pc-windows-msvc` |

## Install

```powershell
# from project root
npm install        # produces package-lock.json (already committed)
cd src-tauri
cargo fetch        # populates registry cache against committed Cargo.lock (already committed)
cd ..
```

### Lockfile policy

`package-lock.json` and `src-tauri/Cargo.lock` are **committed** and must remain in sync with `package.json` / `Cargo.toml`. To respect them on subsequent installs:

```powershell
# refresh deps from lockfiles only — fails if lockfile and manifest disagree
npm ci                                  # exact npm reproduction
cargo build --locked                    # cargo, run from src-tauri/
```

CI is expected to use `npm ci` and `cargo --locked` always. `npm install` and bare `cargo build` are allowed locally only when intentionally updating deps; lockfile diffs in PRs must be reviewed.

## Develop

```powershell
# UI hot-reload (SvelteKit dev server only)
npm run dev

# Full Tauri dev (UI + Rust shell, with hot-reload)
# Requires MSVC linker
npm run tauri dev
```

## Build

```powershell
# Frontend only (static SPA into ./build/)
npm run build

# Full Tauri bundle (frontend + Rust shell + installer)
# Requires MSVC linker
npm run tauri build
```

## Portability and auth policy

- User wiki data is kept local to the install/runtime workspace; original source text is preserved and translated text is stored separately.
- Codex/OpenAI automatic mode is optional. The app may read Codex installation/login status and start an `openai-oauth` loopback proxy, but it must not write Codex `auth.json`.
- If Codex/automatic extraction is unavailable, the offline extraction and copy-paste review path remain usable.

## Optional automatic LLM mode setup

The default workflow does not require Node.js, Codex, or API keys: users can use
the copy-paste mode with ChatGPT in a browser. Automatic mode is an advanced
option and must be set up on each user's own PC.

1. Install Node.js LTS from https://nodejs.org/ko, then reopen PowerShell.
2. Confirm Node/npm are available:
   ```powershell
   node -v
   npm -v
   ```
3. Install Codex CLI:
   ```powershell
   npm i -g @openai/codex
   codex --version
   ```
4. Log in with the user's own ChatGPT account:
   ```powershell
   codex login
   codex login status
   ```
5. In llmwiki, open the Login tab and run detection again. If automatic mode
   fails or hits account limits, the copy-paste/offline path remains available.

## Current verification snapshot

The following commands are expected to pass on the current Windows development host:

```powershell
npm run check
npm run build
npm run tauri build
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run tauri build` writes installers to:

- `src-tauri/target/release/bundle/msi/llmwiki_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/llmwiki_0.1.0_x64-setup.exe`

See `docs/adaptation-from-harness-core.md` for the upstream provenance contract that Slice 2 must honor.
