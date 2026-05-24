<!--
  CandidateList.svelte
  --------------------
  AC-WIKI-DISPLAY: render the extracted candidate_items[] — the wiki's core
  read surface. After a source is ingested and the deterministic extractor
  emits candidate items, this component is the screen the user actually sees.

  Authority: agreed_contract.json#AC-WIKI-DISPLAY + AC-4.

  Behaviour:
    - Empty state when no items (idle, before any extraction).
    - Per-source grouping header (source_id + kind + item count).
    - Each candidate rendered as a card carrying: type chip, title, summary,
      verbatim evidence_text (the source-of-truth fragment), and the
      evidence_ref / page locator. The evidence_text is shown verbatim so the
      user can verify the extraction against the source — extraction is
      deterministic and rule-based, never an LLM paraphrase.

  Design:
    - Type chips use shape + label (color is the third signal), so the type
      is legible without relying on hue alone (accessibility).
    - Tokens only: no hard-coded hex / duration / curve.
    - Cards use the asymmetric radius house style.

  This component is read-only and pure: it renders whatever bundle it is
  handed. It performs no I/O and no extraction itself.
-->
<script lang="ts">
  import type { CandidateBundle, CandidateType } from '$lib/extract/candidateExtractor';

  type Props = {
    bundle: CandidateBundle | null;
    /** True while an extraction is running (shows a busy hairline). */
    busy?: boolean;
  };

  let { bundle, busy = false }: Props = $props();

  // Short human label per type. Domain-neutral (biblical_text -> religious_text
  // generalization is reflected here).
  const TYPE_LABEL: Record<CandidateType, string> = {
    concept: 'Concept',
    argument: 'Argument',
    method: 'Method',
    scholar: 'Scholar',
    religious_text: 'Source Text',
    objection: 'Objection',
    quotation: 'Quotation',
    other: 'Other',
  };

  // A short glyph per type so the type reads via shape, not color alone.
  const TYPE_GLYPH: Record<CandidateType, string> = {
    concept: '◆',
    argument: '▶',
    method: '⛭',
    scholar: '✦',
    religious_text: '§',
    objection: '⚑',
    quotation: '❝',
    other: '○',
  };

  let item_count = $derived(bundle?.candidate_items.length ?? 0);

  // Distinct type tally for the summary line, in stable first-seen order.
  let type_tally = $derived.by(() => {
    const order: CandidateType[] = [];
    const counts = new Map<CandidateType, number>();
    for (const it of bundle?.candidate_items ?? []) {
      if (!counts.has(it.type)) order.push(it.type);
      counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
    }
    return order.map((t) => ({ type: t, count: counts.get(t) ?? 0 }));
  });

  function formatEvidenceRef(ref: string): string {
    const pageLine = ref.match(/#page-(\d+)-line-(\d+)/);
    if (pageLine) return `페이지 ${pageLine[1]} · 줄 ${pageLine[2]}`;
    const line = ref.match(/#line-(\d+)/);
    if (line) return `줄 ${line[1]}`;
    const md = ref.match(/#md-block-(\d+)/);
    if (md) return `Markdown 블록 ${Number(md[1]) + 1}`;
    return ref;
  }
</script>

<section class="wiki-view" aria-label="Extracted candidate items" aria-busy={busy}>
  {#if busy}
    <div class="busy-hairline" aria-hidden="true"></div>
  {/if}

  {#if !bundle}
    <div class="empty" role="status">
      <p class="empty-title">No source extracted yet</p>
      <p class="empty-hint">
        Add a plaintext, Markdown, or PDF source above. The extractor will list
        every concept and quotation it finds — verbatim, no paraphrase.
      </p>
    </div>
  {:else if item_count === 0}
    <div class="empty" role="status">
      <p class="empty-title">No candidate items found</p>
      <p class="empty-hint">
        The source <code>{bundle.source_id}</code> ({bundle.source_kind}) parsed
        cleanly but produced no concept or quotation candidates.
      </p>
    </div>
  {:else}
    <header class="group-head">
      <h2 class="group-title">Extracted from <code>{bundle.source_id}</code></h2>
      <p class="group-meta">
        <span class="kind-tag">{bundle.source_kind}</span>
        <span class="count">{item_count} item{item_count === 1 ? '' : 's'}</span>
        {#each type_tally as t (t.type)}
          <span class="tally" title={TYPE_LABEL[t.type]}>
            <span class="tally-glyph" aria-hidden="true">{TYPE_GLYPH[t.type]}</span>
            {TYPE_LABEL[t.type]} ×{t.count}
          </span>
        {/each}
      </p>
    </header>

    <ol class="cards">
      {#each bundle.candidate_items as item (item.local_candidate_id)}
        <li class="card" data-type={item.type}>
          <div class="card-head">
            <span class="chip chip-{item.type}">
              <span class="chip-glyph" aria-hidden="true">{TYPE_GLYPH[item.type]}</span>
              {TYPE_LABEL[item.type]}
            </span>
            <h3 class="card-title">{item.title}</h3>
          </div>

          {#if item.summary && item.summary !== item.title}
            <p class="card-summary">{item.summary}</p>
          {/if}

          <blockquote class="evidence">
            {item.evidence_text}
          </blockquote>

          <p class="card-locator">
            {#if item.page !== undefined}
              <span class="loc page">페이지 {item.page}</span>
            {/if}
            {#each item.evidence_refs as ref (ref)}
              <span class="loc ref" title={ref}>{formatEvidenceRef(ref)}</span>
            {/each}
            <span class="loc id" title="local candidate id">#{item.local_candidate_id}</span>
          </p>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .wiki-view {
    position: relative;
    margin-top: var(--space-xl);
  }

  .busy-hairline {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 1px;
    background: var(--accent-oxblood);
    animation: wiki-busy var(--motion-slow) var(--ease-deliberate) infinite;
  }

  @keyframes wiki-busy {
    0% { opacity: 0.3; transform: scaleX(0.2); transform-origin: left; }
    50% { opacity: 1; transform: scaleX(1); }
    100% { opacity: 0.3; transform: scaleX(0.2); transform-origin: right; }
  }

  .empty {
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    padding: var(--space-xl);
    background: var(--surface-sunken);
  }

  .empty-title {
    margin: 0 0 var(--space-sm) 0;
    font-family: var(--heading-family);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .group-head {
    margin-bottom: var(--space-lg);
    padding-bottom: var(--space-md);
    border-bottom: 1px solid var(--border-subtle);
  }

  .group-title {
    margin: 0 0 var(--space-sm) 0;
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .group-meta {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .kind-tag {
    font-family: var(--heading-family);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.6875rem;
    padding: 1px var(--space-sm);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
  }

  .count {
    font-weight: 600;
    color: var(--text-primary);
  }

  .tally {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .tally-glyph {
    color: var(--accent-oxblood);
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .card {
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    padding: var(--space-md) var(--space-lg);
    box-shadow: var(--shadow-hairline);
    transition: border-color var(--motion-fast) var(--ease-deliberate);
  }

  /* Type accents the left rail; the chip glyph + label carry the type signal
     so color is never the only differentiator. */
  .card[data-type='concept'] { border-left-color: var(--accent-oxblood); }
  .card[data-type='quotation'] { border-left-color: var(--success-moss); }
  .card[data-type='argument'] { border-left-color: var(--warn-amber); }
  .card[data-type='objection'] { border-left-color: var(--danger-rust); }

  .card-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    flex: 0 0 auto;
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    background: var(--surface-sunken);
  }

  .chip-glyph { line-height: 1; }

  .chip-concept { color: var(--accent-oxblood); border-color: var(--accent-oxblood); }
  .chip-quotation { color: var(--success-moss); border-color: var(--success-moss); }
  .chip-argument { color: var(--warn-amber); border-color: var(--warn-amber); }
  .chip-objection { color: var(--danger-rust); border-color: var(--danger-rust); }

  .card-title {
    margin: 0;
    font-family: var(--body-family);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .card-summary {
    margin: var(--space-sm) 0 0 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .evidence {
    margin: var(--space-md) 0 0 0;
    padding: var(--space-sm) var(--space-md);
    border-left: 2px solid var(--border-subtle);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .card-locator {
    margin: var(--space-sm) 0 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    font-size: 0.6875rem;
    color: var(--text-secondary);
  }

  .loc {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
  }

  .loc.page {
    font-family: var(--heading-family);
    font-weight: 600;
    color: var(--accent-oxblood);
    background: var(--surface-elevated);
    border: 1px solid var(--border-subtle);
  }

  .loc.id { color: var(--text-secondary); opacity: 0.85; }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-sunken);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
