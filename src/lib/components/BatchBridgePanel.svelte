<!--
  BatchBridgePanel.svelte — top-N ChatGPT copy-paste package.

  Lets non-technical users copy one prompt for several offline candidates,
  paste one JSON reply back, validate all chunk_id evidence, then import every
  importable wiki candidate in one action.
-->
<script lang="ts">
  import { buildBatchPrompt, type BatchPromptInput } from '$lib/bridge/promptBuilder';
  import { parseResponse } from '$lib/bridge/responseParser';
  import { validateResponse, type ValidationResult, type ValidatedCandidate } from '$lib/bridge/responseValidator';

  type BridgeChunk = BatchPromptInput['chunks'][number];

  type Props = {
    input: BatchPromptInput;
    onimport?: (cands: ValidatedCandidate[]) => Promise<number> | number;
    onclose?: () => void;
  };

  let { input, onimport, onclose }: Props = $props();

  let prompt = $derived(buildBatchPrompt(input));
  let chunkLookup = $derived(new Map(input.chunks.map((chunk) => [chunk.chunk_id, chunk])));
  let pasted = $state('');
  let result = $state<ValidationResult | null>(null);
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let importing = $state(false);
  let importedCount = $state<number | null>(null);

  async function copyPrompt() {
    copyState = 'idle';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        copyState = 'copied';
        return;
      }
      throw new Error('clipboard unavailable');
    } catch {
      copyState = 'failed';
    }
  }

  function openChatGpt() {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
    }
  }

  function runValidate() {
    importedCount = null;
    const parsed = parseResponse(pasted);
    if (!parsed.ok) {
      result = {
        shapeOk: false,
        topLevelError: parsed.message,
        candidates: [],
        importable: [],
      };
      return;
    }
    result = validateResponse(parsed.value, input.chunks);
  }

  async function importAll() {
    if (!result?.importable.length || !onimport) return;
    importing = true;
    try {
      importedCount = await onimport(result.importable);
    } finally {
      importing = false;
    }
  }

  function evidenceLocation(chunk: BridgeChunk | null, quote: string): string {
    if (!chunk) return '';
    const parts: string[] = [chunk.source_id];
    if (chunk.location.page != null) parts.push(`p.${chunk.location.page}`);
    parts.push(`문자 ${chunk.location.char_start}-${chunk.location.char_end}`);
    const quoteOffset = chunk.text.indexOf(quote);
    if (quoteOffset >= 0) {
      const lineInChunk = chunk.text.slice(0, quoteOffset).split('\n').length;
      parts.push(`청크 ${lineInChunk}행`);
    }
    return parts.join(' · ');
  }
</script>

<section class="bridge" aria-label="상위 후보 일괄 ChatGPT 브릿지">
  <header class="bridge-head">
    <h4 class="bridge-title">상위 후보 일괄 ChatGPT 브릿지</h4>
    <button type="button" class="link-btn" onclick={() => onclose?.()}>닫기</button>
  </header>

  <p class="bridge-lede">
    후보 {input.candidates.length}개를 하나의 프롬프트로 묶었습니다. ChatGPT는 이 중
    재사용성이 높은 것만 골라 최대 8개 JSON 후보로 돌려주고, 앱은 실제 청크 근거만
    통과시켜 위키 초안으로 가져옵니다.
  </p>

  <div class="step">
    <span class="step-key">1. 프롬프트 패키지</span>
    <pre class="prompt" aria-label="생성된 일괄 프롬프트">{prompt}</pre>
    <div class="actions">
      <button type="button" class="btn" onclick={copyPrompt}>프롬프트 복사</button>
      <button type="button" class="btn" onclick={openChatGpt}>ChatGPT 열기</button>
      {#if copyState === 'copied'}
        <span class="hint ok" role="status">복사되었습니다. ChatGPT에 붙여넣으세요.</span>
      {:else if copyState === 'failed'}
        <span class="hint warn" role="status">자동 복사가 막혔습니다. 위 칸을 직접 선택해 복사하세요.</span>
      {/if}
    </div>
  </div>

  <div class="step">
    <label class="step-key" for="batch-bridge-paste">2. ChatGPT 응답 붙여넣기 (JSON)</label>
    <textarea
      id="batch-bridge-paste"
      class="paste"
      bind:value={pasted}
      rows="7"
      placeholder={'ChatGPT가 출력한 JSON을 붙여넣으세요. ```json … ``` 코드펜스로 감싸져 있어도 됩니다.'}
    ></textarea>
    <div class="actions">
      <button type="button" class="btn primary" onclick={runValidate} disabled={pasted.trim().length === 0}>
        검증
      </button>
    </div>
  </div>

  {#if result}
    <div class="step results" aria-live="polite">
      <span class="step-key">3. 검증 결과</span>

      {#if !result.shapeOk}
        <p class="hint warn">{result.topLevelError}</p>
      {:else if result.candidates.length === 0}
        <p class="hint warn">wiki_candidates 배열이 비어 있습니다.</p>
      {:else}
        <p class="summary-line">
          후보 {result.candidates.length}개 · 가져오기 가능 {result.importable.length}개 ·
          거부 {result.candidates.length - result.importable.length}개
        </p>
        <div class="actions">
          <button
            type="button"
            class="btn primary"
            onclick={importAll}
            disabled={importing || result.importable.length === 0 || importedCount !== null}
          >
            {#if importing}
              일괄 가져오는 중…
            {:else if importedCount !== null}
              {importedCount}개 가져옴
            {:else}
              검증 통과 후보 모두 가져오기
            {/if}
          </button>
        </div>

        <ul class="result-list">
          {#each result.candidates as c (c.index)}
            <li class="result" class:rejected={!c.importable}>
              <div class="result-head">
                <span class="status-tag" data-state={c.importable ? 'ok' : 'rejected'}>
                  {c.importable ? '검증 통과' : '거부됨'}
                </span>
                <span class="result-title">{c.title || '(제목 없음)'}</span>
                {#if c.confidence}
                  <span class="conf">신뢰도 {c.confidence}</span>
                {/if}
              </div>

              {#if c.schema_field}
                <p class="result-row"><span class="rk">분류</span> {c.schema_field}</p>
              {/if}
              {#if c.summary_ko}
                <p class="result-row"><span class="rk">요약</span> {c.summary_ko}</p>
              {/if}
              <div class="result-row evidence-section">
                <span class="rk">근거</span>
                {#if c.evidence.length}
                  <div class="evidence-list">
                    {#each c.evidence as ev (ev.chunk_id + ev.quote.slice(0, 8))}
                      <article class="evidence-card">
                        <div class="evidence-head">
                          <span class="ev">{ev.chunk_id}</span>
                          <span class="ev-loc">{evidenceLocation(chunkLookup.get(ev.chunk_id) ?? null, ev.quote)}</span>
                        </div>
                        <blockquote class="evidence-quote">{ev.quote}</blockquote>
                        {#if ev.translation_ko}
                          <p class="evidence-translation"><span class="rk">번역</span> {ev.translation_ko}</p>
                        {/if}
                      </article>
                    {/each}
                  </div>
                {/if}
                {#each c.rejectedEvidence as rev, ri (rev.claimed_chunk_id + ri)}
                  <span class="ev bad">{rev.claimed_chunk_id || '(빈 chunk_id)'}</span>
                {/each}
              </div>

              {#if c.violations.length}
                <ul class="violations">
                  {#each c.violations as v (v)}
                    <li>{v}</li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .bridge {
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--success-moss);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    margin-top: var(--space-md);
  }

  .bridge-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  .bridge-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 1rem;
    font-weight: 600;
  }
  .bridge-lede,
  .hint,
  .summary-line,
  .result-row {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .step-key {
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .prompt,
  .paste {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.45;
  }
  .prompt {
    max-height: 20rem;
    overflow: auto;
    padding: var(--space-md);
    white-space: pre-wrap;
  }
  .paste {
    min-height: 8rem;
    resize: vertical;
    padding: var(--space-md);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .btn {
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 600;
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color var(--motion-fast) var(--ease-deliberate);
  }
  .btn:hover:not(:disabled) { border-color: var(--text-secondary); }
  .btn.primary {
    background: var(--accent-oxblood);
    color: var(--surface-elevated);
    border-color: var(--accent-oxblood);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn {
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
  }
  .hint.ok { color: var(--success-moss); }
  .hint.warn { color: var(--danger-rust); }
  .result-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .result {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .result.rejected { opacity: 0.76; }
  .result-head,
  .evidence-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .status-tag,
  .conf,
  .ev {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    padding: 1px var(--space-sm);
  }
  .status-tag[data-state='ok'] { color: var(--success-moss); border-color: var(--success-moss); }
  .status-tag[data-state='rejected'],
  .ev.bad { color: var(--danger-rust); border-color: var(--danger-rust); }
  .result-title { font-weight: 600; color: var(--text-primary); }
  .rk {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--text-muted);
    margin-right: var(--space-xs);
  }
  .evidence-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    margin-top: var(--space-xs);
  }
  .evidence-card {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-elevated);
    padding: var(--space-sm);
  }
  .ev-loc {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .evidence-quote {
    margin: var(--space-xs) 0 0 0;
    padding-left: var(--space-sm);
    border-left: 2px solid var(--border-subtle);
    white-space: pre-wrap;
    color: var(--text-primary);
  }
  .evidence-translation {
    margin: var(--space-xs) 0 0 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }
  .violations {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--danger-rust);
    font-size: 0.8125rem;
  }
</style>
