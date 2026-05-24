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
  import { structuralReasonForCandidate } from '$lib/candidate/structuralFilter';
  import { pipeline } from '$lib/pipeline/store.svelte';
  import { onSaveEntry, onTranslate } from '$lib/pipeline/actions';

  let showStructural = $state(false);

  function structureReason(entry: (typeof pipeline.entries)[number]): string | null {
    return structuralReasonForCandidate({
      title: entry.title,
      summary: entry.summary ?? '',
      evidence: entry.claims.map((claim) => ({
        quote: [claim.statement, claim.original_text].filter(Boolean).join('\n'),
        translation_ko: claim.translated_text,
      })),
    });
  }

  let entryRows = $derived(
    pipeline.entries.map((entry, index) => ({
      entry,
      index,
      structuralReason: structureReason(entry),
    })),
  );
  let hiddenStructuralCount = $derived(entryRows.filter((row) => row.structuralReason).length);
  let visibleRows = $derived(
    showStructural ? entryRows : entryRows.filter((row) => !row.structuralReason),
  );
</script>

<section class="block">
  <div class="title-row">
    <h2 class="section-title">
      위키 ({visibleRows.length}{hiddenStructuralCount > 0 ? `/${pipeline.entries.length}` : ''})
    </h2>
    {#if hiddenStructuralCount > 0}
      <button type="button" class="structure-toggle" onclick={() => (showStructural = !showStructural)}>
        {showStructural ? '구조 항목 숨기기' : `숨긴 구조 항목 ${hiddenStructuralCount}개 보기`}
      </button>
    {/if}
  </div>
  <p class="section-lede">
    항목·매핑·주장을 직접 수정하고 저장하세요. 저장 내용은 <code>data/wiki/</code>에 영속되어
    재시작 후에도 유지됩니다. 각 주장의 근거는 hover 또는 클릭으로 펼칠 수 있습니다.
  </p>
  {#if hiddenStructuralCount > 0 && !showStructural}
    <p class="structure-note" role="note">
      목차·장 제목·단독 저자명·참고문헌 조각처럼 구조 파악용으로 보이는 항목
      {hiddenStructuralCount}개는 기본 위키 목록에서 숨겼습니다. 저장 파일은 삭제하지 않았습니다.
    </p>
  {/if}
  {#if pipeline.entries.length === 0}
    <div class="wiki-empty" role="status">
      아직 위키 항목이 없습니다. “메인” 탭에서 원문을 올리고 “위키 생성”을 누르세요.
    </div>
  {:else if visibleRows.length === 0}
    <div class="wiki-empty" role="status">
      표시할 위키 지식 항목이 없습니다. 숨긴 구조 항목을 확인하려면 위 버튼을 누르세요.
    </div>
  {:else}
    <div class="entry-stack">
      {#each visibleRows as row (row.entry.id)}
        <WikiEntryEditor
          bind:entry={pipeline.entries[row.index]}
          outline={pipeline.outline}
          busy={pipeline.busy}
          onsave={onSaveEntry}
          ontranslate={(cid, orig) => onTranslate(pipeline.entries[row.index], cid, orig)}
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

  .title-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    flex-wrap: wrap;
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

  .structure-toggle {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-elevated);
    color: var(--text-secondary);
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }
  .structure-toggle:hover {
    border-color: var(--accent-oxblood);
    color: var(--text-primary);
  }

  .structure-note {
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    border-left: 3px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    font-size: 0.8125rem;
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
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: var(--space-lg);
    align-items: start;
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-elevated);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
