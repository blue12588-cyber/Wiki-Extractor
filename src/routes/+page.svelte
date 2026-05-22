<script lang="ts">
	import DisclosureBanner from '$lib/components/DisclosureBanner.svelte';
	import UploadZone from '$lib/components/UploadZone.svelte';
	import AuthStateIndicator from '$lib/components/AuthStateIndicator.svelte';
	import CandidateList from '$lib/components/CandidateList.svelte';
	import { authState } from '$lib/auth/store';
	import { verifyMagicBytes } from '$lib/upload/magicBytes';
	import { computeSourceId } from '$lib/upload/sourceId';
	import { extractCandidates, type CandidateBundle } from '$lib/extract/candidateExtractor';

	let auth_reachable = $state(true);
	let upload_zone: ReturnType<typeof UploadZone> | null = null;

	// AC-WIKI-DISPLAY: the extracted bundle drives the wiki read surface below.
	let bundle: CandidateBundle | null = $state(null);
	let extracting = $state(false);

	type UploadResponse = {
		source_id: string;
		written_path: string;
		byte_count: number;
		detected_type: string;
	};
	type UploadErr = { kind: string; reason: string };

	function resolve_invoke():
		| (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)
		| null {
		if (typeof window === 'undefined') return null;
		const w = window as unknown as {
			__TAURI__?: {
				core?: {
					invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
				};
			};
		};
		const fn = w.__TAURI__?.core?.invoke;
		return typeof fn === 'function' ? fn : null;
	}

	/**
	 * Run the deterministic, no-LLM extractor on the just-ingested bytes and
	 * publish the resulting bundle to the wiki view. Extraction runs in the
	 * renderer in BOTH preview and Tauri contexts: the logic is pure TS and the
	 * renderer already holds the file bytes, so we avoid a redundant Rust round
	 * trip while keeping the disk-copy + source_id authority on the host
	 * (upload_file). AC-4 / AC-5 / AC-6 are exercised on this exact path.
	 */
	async function run_extraction(file: File, full: Uint8Array, source_id: string) {
		extracting = true;
		bundle = null;
		try {
			bundle = await extractCandidates({ source_id, filename: file.name, buffer: full });
		} catch (err) {
			const e = err as { message?: string };
			upload_zone?.set_reject(`extraction failed: ${e?.message ?? String(err)}`);
		} finally {
			extracting = false;
		}
	}

	async function on_file_selected(file: File) {
		// Step 1: read head bytes for magic-bytes check (TS-side preview check).
		const headLen = Math.min(256, file.size);
		const head = new Uint8Array(await file.slice(0, headLen).arrayBuffer());
		const mb = verifyMagicBytes(file.name, head);
		if (!mb.ok) {
			upload_zone?.set_reject(mb.reason ?? 'Magic-bytes signature mismatch.');
			return;
		}

		// We need the full bytes for both the source_id (preview) and the
		// deterministic extractor regardless of context, so read once here.
		const full = new Uint8Array(await file.arrayBuffer());

		// Step 2: in non-Tauri context, hash in-renderer (no disk copy is
		// possible) and run extraction so the wiki view works in preview.
		const invoke = resolve_invoke();
		if (!invoke) {
			const sid = await computeSourceId(full);
			upload_zone?.set_success(`(preview) ${file.name} → data/sources/${sid}/`);
			await run_extraction(file, full, sid);
			return;
		}

		// Step 3: Tauri command — host hashes + writes to data/sources/<id>/.
		// Drag/drop File objects from the Tauri webview carry an absolute `.path`;
		// the OS picker dialog does not expose a path, so we guide the user.
		const path = (file as unknown as { path?: string }).path;
		if (!path) {
			upload_zone?.set_reject('Drag the file from the OS (the picker dialog has no path access).');
			return;
		}

		try {
			const result = await invoke<UploadResponse>('upload_file', { path });
			upload_zone?.set_success(
				`${file.name} → data/sources/${result.source_id}/ (${result.byte_count} bytes, ${result.detected_type})`,
			);
			// The host-authoritative source_id is reused so the on-screen ids
			// match the on-disk directory name.
			await run_extraction(file, full, result.source_id);
		} catch (err) {
			const e = err as UploadErr;
			upload_zone?.set_reject(e?.reason ?? 'upload failed');
		}
	}
</script>

<header class="chrome">
	<h1 class="brand">llmwiki</h1>
	<AuthStateIndicator state={$authState} />
</header>

<main class="page">
	<DisclosureBanner {auth_reachable} />

	<section class="upload-section">
		<h2 class="section-title">Add a source</h2>
		<p class="section-lede">
			Drop a plaintext, Markdown, or PDF file. The hashed source identifier becomes the
			subdirectory under <code>data/sources/</code>.
		</p>
		<UploadZone bind:this={upload_zone} onselect={on_file_selected} />
	</section>

	<section class="wiki-section">
		<h2 class="section-title">Wiki</h2>
		<CandidateList {bundle} busy={extracting} />
	</section>
</main>

<style>
	.chrome {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-md);
		margin-bottom: var(--space-xl);
	}

	.brand {
		font-family: var(--heading-family);
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		margin: 0;
		color: var(--text-primary);
	}

	.page {
		max-width: 720px;
		margin: 0 auto;
	}

	.section-title {
		font-family: var(--heading-family);
		font-size: 1.0625rem;
		font-weight: 600;
		margin: 0 0 var(--space-sm) 0;
	}

	.section-lede {
		margin: 0 0 var(--space-md) 0;
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.upload-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.wiki-section {
		margin-top: var(--space-2xl);
	}

	code {
		font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
		font-size: 0.875em;
		background: var(--surface-elevated);
		padding: 0 var(--space-xs);
		border-radius: var(--radius-tight);
	}
</style>
