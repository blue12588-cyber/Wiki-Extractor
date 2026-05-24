<!--
  ClaimAnnotation.svelte
  ----------------------
  AC-ANNOTATION: 위키 항목의 각 주장(claim)에 대해 근거 주석을 hover 시 표시하고
  클릭으로 고정/해제(토글)한다. 주석은 위에 "번역된 원문", 아래에 "번역 안 된 원문"을
  병기한다.

  Authority: agreed_contract.json#AC-ANNOTATION + AC-TRANSLATE(원문 보존).

  원문 보존 불변: original_text 는 출처의 그대로(verbatim)이며 절대 수정되지 않는다.
  번역(translated_text)은 별도 필드로, 비어 있을 수 있다(오프라인/degradation).
  - 전체 한글 UI (AC-KOREAN-UI).
  - 색상에만 의존하지 않도록 라벨 텍스트로 구분(접근성).
-->
<script lang="ts">
  type Props = {
    statement: string;
    translated_text: string;
    original_text: string;
    evidence_refs: string[];
  };
  let { statement, translated_text, original_text, evidence_refs }: Props = $props();

  // hover 표시 + 클릭 고정. 둘 중 하나라도 활성이면 주석을 보여준다.
  let hovered = $state(false);
  let pinned = $state(false);
  let open = $derived(hovered || pinned);

  function toggle_pin() {
    pinned = !pinned;
  }
  function on_key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle_pin();
    }
  }

  function formatRef(ref: string): string {
    const pageLine = ref.match(/#page-(\d+)-line-(\d+)/);
    if (pageLine) return `페이지 ${pageLine[1]} · 줄 ${pageLine[2]}`;
    const chunkPage = ref.match(/#p(\d+)$/);
    if (chunkPage) return `페이지 ${chunkPage[1]}`;
    const line = ref.match(/#line-(\d+)/);
    if (line) return `줄 ${line[1]}`;
    const md = ref.match(/#md-block-(\d+)/);
    if (md) return `Markdown 블록 ${Number(md[1]) + 1}`;
    return ref;
  }
</script>

<div class="claim">
  <button
    type="button"
    class="claim-trigger"
    class:pinned
    aria-expanded={open}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
    onfocus={() => (hovered = true)}
    onblur={() => (hovered = false)}
    onclick={toggle_pin}
    onkeydown={on_key}
  >
    <span class="claim-statement">{statement}</span>
    <span class="claim-cue" aria-hidden="true">{pinned ? '근거 고정됨 ▾' : '근거 보기 ▸'}</span>
  </button>

  {#if open}
    <div class="annotation" role="note" aria-label="근거 주석">
      <div class="ann-block translated">
        <span class="ann-label">번역된 원문 (가톨릭 용어)</span>
        {#if translated_text && translated_text.trim()}
          <p class="ann-text">{translated_text}</p>
        {:else}
          <p class="ann-text muted">번역이 아직 적용되지 않았습니다(오프라인/미인증). 원문은 아래에 보존되어 있습니다.</p>
        {/if}
      </div>

      <div class="ann-block original">
        <span class="ann-label">원문 (보존, 번역 안 됨)</span>
        <p class="ann-text verbatim">{original_text}</p>
      </div>

      {#if evidence_refs.length > 0}
        <p class="ann-refs">
          <span class="refs-label">근거 위치</span>
          {#each evidence_refs as ref (ref)}
            <span class="ref" title={ref}>{formatRef(ref)}</span>
          {/each}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .claim {
    border-left: 2px solid var(--border-subtle);
    padding-left: var(--space-md);
  }

  .claim-trigger {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
    width: 100%;
    text-align: start;
    background: none;
    border: none;
    padding: var(--space-xs) 0;
    cursor: pointer;
    font-family: var(--body-family);
  }

  .claim-trigger:focus-visible {
    outline: 2px solid var(--accent-oxblood);
    outline-offset: 2px;
    border-radius: var(--radius-tight);
  }

  .claim-statement {
    font-size: 0.9375rem;
    color: var(--text-primary);
    line-height: 1.5;
  }

  .claim-cue {
    flex: 0 0 auto;
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    color: var(--accent-oxblood);
    white-space: nowrap;
  }

  .claim-trigger.pinned .claim-cue {
    color: var(--success-moss);
  }

  .annotation {
    margin: var(--space-xs) 0 var(--space-sm) 0;
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-sunken);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .ann-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .ann-label {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }

  .ann-block.translated .ann-label {
    color: var(--accent-oxblood);
  }

  .ann-block.original .ann-label {
    color: var(--success-moss);
  }

  .ann-text {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--text-primary);
  }

  .ann-text.verbatim {
    font-family: var(--body-family);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .ann-text.muted {
    color: var(--text-secondary);
    font-style: italic;
  }

  .ann-refs {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    font-size: 0.6875rem;
  }

  .refs-label {
    color: var(--text-secondary);
  }

  .ref {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
    background: var(--surface-elevated);
    color: var(--text-secondary);
  }
</style>
