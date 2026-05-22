<!--
  WikiEntryEditor.svelte
  ----------------------
  AC-EDIT-PERSIST: 위키 항목과 그 매핑·주장을 사용자가 직접 수정하고, 저장 버튼으로
  data/wiki/ 에 영속한다(앱 재시작 후 유지). 위키 항목은 READ-ONLY 가 아니라
  편집 가능(read-write)하다.

  Authority: agreed_contract.json#AC-EDIT-PERSIST + AC-WIKI-PERSIST +
             AC-ANNOTATION + AC-TRANSLATE + AC-OFFLINE.

  - 전체 한글 UI (AC-KOREAN-UI).
  - 저장은 LLM 비의존(오프라인 동작). 번역만 LLM 사용(미인증 시 원문 유지).
  - 원문 보존: claim.original_text 는 편집 불가(읽기 전용)로 표시한다.
-->
<script lang="ts">
  import type { WikiEntry } from '$lib/wiki/wikiTypes';
  import type { ParsedOutline } from '$lib/outline/outlineParser';
  import ClaimAnnotation from './ClaimAnnotation.svelte';

  type Props = {
    entry: WikiEntry;
    outline?: ParsedOutline | null;
    /** 저장 콜백 — 부모가 wikiStore 로 영속. */
    onsave?: (entry: WikiEntry) => Promise<void> | void;
    /** 한 주장 번역 요청(가톨릭 용어). null 반환 시 degradation. */
    ontranslate?: (claimId: string, original: string) => Promise<void> | void;
    busy?: boolean;
  };
  let { entry = $bindable(), outline = null, onsave, ontranslate, busy = false }: Props = $props();

  let dirty = $state(false);
  let saved_at = $state<string | null>(null);

  function mark_dirty() {
    dirty = true;
    saved_at = null;
  }

  async function handle_save() {
    entry.updated_at = new Date().toISOString();
    await onsave?.(entry);
    dirty = false;
    saved_at = new Date().toLocaleTimeString('ko-KR');
  }

  let outline_options = $derived(outline?.nodes ?? []);
</script>

<article class="entry" aria-label={`위키 항목: ${entry.title}`}>
  <header class="entry-head">
    <div class="field">
      <label class="lbl" for={`title-${entry.id}`}>제목</label>
      <input
        id={`title-${entry.id}`}
        class="inp title"
        bind:value={entry.title}
        oninput={mark_dirty}
      />
    </div>

    <div class="meta-row">
      <div class="field">
        <label class="lbl" for={`node-${entry.id}`}>목차 항목 매핑</label>
        <select
          id={`node-${entry.id}`}
          class="inp"
          bind:value={entry.outline_node_id}
          onchange={mark_dirty}
        >
          <option value={null}>(미분류)</option>
          {#each outline_options as n (n.id)}
            <option value={n.id}>{n.label ? `${n.label} ` : ''}{n.title}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label class="lbl" for={`status-${entry.id}`}>상태</label>
        <select id={`status-${entry.id}`} class="inp" bind:value={entry.status} onchange={mark_dirty}>
          <option value="draft">초안</option>
          <option value="reviewed">검토됨</option>
          <option value="verified">확정</option>
          <option value="deprecated">폐기</option>
          <option value="superseded">대체됨</option>
        </select>
      </div>
    </div>
  </header>

  <section class="claims" aria-label="주장 목록">
    <h4 class="claims-title">주장 ({entry.claims.length})</h4>
    {#each entry.claims as claim, ci (claim.claim_id)}
      <div class="claim-edit">
        <label class="lbl" for={`stmt-${claim.claim_id}`}>주장 {ci + 1}</label>
        <textarea
          id={`stmt-${claim.claim_id}`}
          class="inp stmt"
          rows="2"
          bind:value={claim.statement}
          oninput={mark_dirty}
        ></textarea>

        <div class="translate-row">
          <label class="lbl" for={`tr-${claim.claim_id}`}>번역(가톨릭 용어) — 별도 필드, 원문 보존</label>
          <textarea
            id={`tr-${claim.claim_id}`}
            class="inp tr"
            rows="2"
            bind:value={claim.translated_text}
            oninput={mark_dirty}
            placeholder="LLM 번역 또는 직접 입력. 원문은 변경되지 않습니다."
          ></textarea>
          <button
            type="button"
            class="btn small"
            onclick={() => ontranslate?.(claim.claim_id, claim.original_text)}
            disabled={busy}
          >
            가톨릭 용어로 번역
          </button>
        </div>

        <ClaimAnnotation
          statement={claim.statement}
          translated_text={claim.translated_text}
          original_text={claim.original_text}
          evidence_refs={claim.evidence_refs}
        />
      </div>
    {/each}
    {#if entry.claims.length === 0}
      <p class="empty">이 항목에는 아직 주장이 없습니다.</p>
    {/if}
  </section>

  <footer class="entry-foot">
    <button type="button" class="btn primary" onclick={handle_save} disabled={busy}>
      저장
    </button>
    {#if dirty}
      <span class="status dirty">저장되지 않은 변경 사항</span>
    {:else if saved_at}
      <span class="status ok">저장됨 · {saved_at}</span>
    {/if}
  </footer>
</article>

<style>
  .entry {
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    box-shadow: var(--shadow-hairline);
  }

  .entry-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .meta-row {
    display: flex;
    gap: var(--space-md);
    flex-wrap: wrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    flex: 1 1 auto;
    min-width: 160px;
  }

  .lbl {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }

  .inp {
    font-family: var(--body-family);
    font-size: 0.9375rem;
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    color: var(--text-primary);
    box-sizing: border-box;
    width: 100%;
  }

  .inp:focus-visible {
    outline: 2px solid var(--accent-oxblood);
    outline-offset: 1px;
  }

  .inp.title {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
  }

  textarea.inp {
    resize: vertical;
    line-height: 1.5;
  }

  .claims {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .claims-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .claim-edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
  }

  .translate-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
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
    align-self: flex-start;
  }

  .btn.small {
    font-size: 0.75rem;
    padding: 2px var(--space-sm);
  }

  .btn.primary {
    background: var(--accent-oxblood);
    color: var(--surface-elevated);
    border-color: var(--accent-oxblood);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .entry-foot {
    display: flex;
    align-items: center;
    gap: var(--space-md);
  }

  .status {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .status.dirty {
    color: var(--warn-amber);
  }

  .status.ok {
    color: var(--success-moss);
  }

  .empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
</style>
