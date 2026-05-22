<!--
  WikiTab.svelte
  --------------
  AC-WIKI-TAB: the wiki display + edit surface (slice-3 functionality), now its
  own tab. State is read from the layout-level `pipeline` store, so entries
  built on the Main tab are present here, and edits made here survive switching
  away and back (AC-NAV / AC-WIKI-TAB state preservation).

  All copy is Korean (AC-KOREAN-UI).
-->
<script lang="ts">
  import WikiEntryEditor from '$lib/components/WikiEntryEditor.svelte';
  import { pipeline } from '$lib/pipeline/store.svelte';
  import { onSaveEntry, onTranslate } from '$lib/pipeline/actions';
</script>

<section class="block">
  <h2 class="section-title">위키 ({pipeline.entries.length})</h2>
  <p class="section-lede">
    항목·매핑·주장을 직접 수정하고 저장하세요. 저장 내용은 <code>data/wiki/</code>에 영속되어
    재시작 후에도 유지됩니다. 각 주장의 근거는 hover 또는 클릭으로 펼칠 수 있습니다.
  </p>
  {#if pipeline.entries.length === 0}
    <div class="wiki-empty" role="status">
      아직 위키 항목이 없습니다. “메인” 탭에서 원문을 올리고 “위키 생성”을 누르세요.
    </div>
  {:else}
    <div class="entry-stack">
      {#each pipeline.entries as entry, i (entry.id)}
        <WikiEntryEditor
          bind:entry={pipeline.entries[i]}
          outline={pipeline.outline}
          busy={pipeline.busy}
          onsave={onSaveEntry}
          ontranslate={(cid, orig) => onTranslate(pipeline.entries[i], cid, orig)}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .section-title {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    margin: 0;
  }

  .section-lede {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .wiki-empty {
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    padding: var(--space-xl);
    background: var(--surface-sunken);
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .entry-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-elevated);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
