/**
 * PDF extractor — deterministic text extraction via pdfjs-dist (legacy build).
 *
 * Authority: agreed_contract.json#AC-5 (same-host re-parse byte-identical).
 *
 * Determinism plan:
 *   - We use the legacy ESM build of pdfjs-dist.
 *   - The worker is provided through Vite's `?worker` import wired to
 *     `GlobalWorkerOptions.workerPort`. In a packaged WebView2 (a `window`
 *     context) pdfjs-dist v4 REQUIRES a worker and throws
 *     "No GlobalWorkerOptions.workerSrc specified" otherwise — the older
 *     "run on the main thread" path only auto-applies under Node. Vite bundles
 *     the worker as a same-origin module worker, so it loads from the embedded
 *     Tauri assets without a network fetch. Text extraction is deterministic
 *     regardless of worker vs main-thread, so this does not affect AC-5.
 *   - Font loading is disabled (`disableFontFace: true`,
 *     `useSystemFonts: false`). For text extraction we do not need glyph
 *     rendering — only the text content stream.
 *   - We extract via `page.getTextContent()` and concatenate `item.str`
 *     values in document order, inserting a single `\n` at each `hasEOL`
 *     marker and a single space between items on the same line.
 *
 * Because the input PDF buffer is identical across calls and the
 * concatenation procedure is pure, the output text is byte-identical
 * across calls on the same host.
 */

export interface PdfExtractionResult {
  /** Per-page raw text in document order. */
  pages: string[];
  /** All pages joined with `\f` (form-feed) separator. */
  text: string;
}

/** Lazy import so consumers that never call this extractor do not pay the cost. */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  // Use the legacy ESM build. Heavy payload stays lazily imported.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Wire a Vite-bundled module worker once. pdfjs-dist v4 requires a worker in a
  // `window` context (the packaged WebView2): without one it throws
  // "No GlobalWorkerOptions.workerSrc specified". Vite's `?worker` import yields
  // a same-origin worker constructor, so it loads from the embedded Tauri assets
  // with no network fetch. Setting `workerPort` (vs `workerSrc`) lets Vite own
  // the module-worker instantiation, which is the reliable path under the Tauri
  // custom protocol.
  if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: PdfWorker } = (await import(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'
    )) as unknown as { default: new () => Worker };
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
  return pdfjs;
}

export async function extractPdfText(buffer: Uint8Array): Promise<PdfExtractionResult> {
  const pdfjs = await loadPdfjs();
  // Defensive copy: pdfjs may mutate the underlying ArrayBuffer otherwise.
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    // Determinism + Node-friendliness:
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    // No verbosity. Workaround: pdfjs-dist exposes verbosity via property.
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const parts: string[] = [];
      let lastY: number | null = null;
      for (const it of content.items as Array<{ str: string; hasEOL?: boolean; transform?: number[] }>) {
        const y = it.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(lastY - y) > 0.5) {
          // Y-coordinate changed → assume new line. Idempotent with hasEOL.
          if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
            parts.push('\n');
          }
        }
        parts.push(it.str ?? '');
        if (it.hasEOL) {
          parts.push('\n');
        } else {
          parts.push(' ');
        }
        if (y !== undefined) lastY = y;
      }
      // Collapse trailing whitespace runs introduced by item separators.
      const pageText = parts
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
      pages.push(pageText);
      // Free per-page resources for determinism.
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }
  const text = pages.join('\f');
  return { pages, text };
}
