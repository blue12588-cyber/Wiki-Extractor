# llmwiki

Desktop extraction app: Tauri 2 shell + SvelteKit (static) UI + Rust sidecar. Built to take user-uploaded sources (plaintext, Markdown, PDF) and produce candidate items for downstream wiki authoring.

**Status**: Slice 1 scaffold (round-3 closeout). Frontend builds; Rust backend lockfile resolved but full `tauri build` blocked by host toolchain gap (see §Known Slice 1 limits).

## Stack

- **Shell**: Tauri 2.11 (Rust 2021 edition, MSRV 1.77.2)
- **UI**: SvelteKit 2.57 + Svelte 5.55 (runes mode) + Vite 6.3
- **Adapter**: `@sveltejs/adapter-static` (no SSR; Tauri serves the prerendered SPA from `build/` via `tauri://localhost`)
- **TypeScript**: 5.9
- **Sidecar (planned for Slice 2)**: Rust binary under `sidecar/` for extraction/parsing

## Layout

```
.
+- src/                      SvelteKit source (routes, lib)
|  +- routes/                page components + +layout.ts (prerender=true, ssr=false)
|  +- lib/
|     +- auth/               (Slice 2) OAuth PKCE state machine
|     +- upload/             (Slice 2) drag/drop + magic-bytes validation
|
+- src-tauri/                Tauri shell (Rust)
|  +- src/                   lib.rs + main.rs
|  +- icons/                 bundle icons
|  +- capabilities/          permission scopes
|  +- Cargo.toml             pinned tauri 2.11.2, tauri-plugin-log 2
|
+- sidecar/                  (Slice 2) extraction sidecar (Rust)
|  +- src/
|  |  +- gates/              extraction gate dispatch (port from harness-core)
|  |  +- extractor/          pattern + synthesizer passes
|  |  +- path-resolver/      install-folder-relative path resolution
|  |  +- sources/            UI-upload-driven source ingestion
|  +- test/                  fixtures + integration tests
|
+- shared/schemas/           shared JSON-Schema (Slice 2; adapted subset of harness-core schemas)
+- fixtures/                 test fixtures (plaintext/, markdown/, pdf/) — populated in Slice 2
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
| **Visual Studio Build Tools** (Windows) | **2019 or later, "Desktop development with C++" workload** | provides `link.exe` — required for `cargo build` on `x86_64-pc-windows-msvc`. **Currently absent on dev host as of round-3 close** — see §Known Slice 1 limits |

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
# Requires MSVC linker (see §Known Slice 1 limits)
npm run tauri dev
```

## Build

```powershell
# Frontend only (static SPA into ./build/) — works today
npm run build

# Full Tauri bundle (frontend + Rust shell + installer)
# Requires MSVC linker; currently blocked
npm run tauri build
```

## Portability policy (AC-7)

- All runtime read/write paths must be resolved relative to the install folder (the Tauri executable's parent directory).
- **Forbidden** in non-test code: `app_data_dir`, `app_local_data_dir`, `app_config_dir` (Tauri path-resolver helpers), and any direct read of `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`, `$HOME`.
- A static scan over `src/`, `src-tauri/src/`, `sidecar/` for those patterns is run as part of release gate. Round-3 close result: **0 hits** (only docs and this README reference the forbidden tokens).
- User data lands in `<install-folder>/data/` (gitignored). Moving the install folder must not break the app — verified by §AC-PORTABLE in Slice 2.

## Known Slice 1 limits

| AC | status | blocker |
|---|---|---|
| AC-1 scaffold builds (frontend) | satisfied | `npm run build` produces `build/` cleanly |
| AC-1 scaffold builds (Tauri full bundle) | blocked | MSVC `link.exe` absent on dev host; install VS Build Tools 2019+ with C++ workload, or add `x86_64-pc-windows-gnu` target + MinGW |
| AC-2 git + lockfiles | satisfied | `package-lock.json` + `src-tauri/Cargo.lock` both committed |
| AC-7 portable (static scan) | satisfied (partial) | runtime relocation test deferred to Slice 2 (needs running app) |
| AC-8 adaptation log | stub satisfied | substantive per-file diff deferred to Slice 2 |
| AC-9 harness-core safety | satisfied | pre/post HEAD = `f7dddc38eab9004b2dfe73e8d6805de07dbbeb48` |
| AC-LOCKFILE policy | satisfied (partial) | first lockfile commit + `npm ci`/`cargo --locked` policy documented; CI verification in Slice 2 |
| AC-3 OAuth, AC-4 extraction, AC-5 PDF, AC-6 schema, AC-UPLOAD upload, AC-PORTABLE relocate | deferred to Slice 2 | per scope-reduction note |

See `docs/adaptation-from-harness-core.md` for the upstream provenance contract that Slice 2 must honor.
