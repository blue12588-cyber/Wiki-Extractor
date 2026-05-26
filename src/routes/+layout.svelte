<!--
  +layout.svelte — sidebar shell (AC-NAV).

  Routing decision (open-question #1): ONE layout owns the left sidebar + the
  active-tab string; the four views are components rendered by +page.svelte, not
  separate routes. Pipeline state lives in $lib/pipeline/store.svelte (module
  scope), so switching tabs preserves bundle / chunks / outline / entries
  (AC-MAIN-TAB / AC-WIKI-TAB). adapter-static prerender + SPA fallback are
  unchanged (no routes added).

  The bootstrap (load persisted wiki entries + llm config) runs ONCE here on
  mount so it is not re-run every time a tab is shown.

  Active-tab signal is triple-encoded for accessibility (AC-NAV): shape glyph +
  aria-current="page" + accent colour. Shape + aria-current work without colour.

  Slice-7 layout (AC-SIDEBAR-INDEPENDENT): the shell is a fixed-viewport flex row
  (height:100vh, no body scroll). The sidebar is its OWN flex track that fills the
  viewport height and scrolls internally only if its menu ever overflows — it does
  NOT participate in the main content's scroll, so all five tabs stay visible and
  clickable no matter how far the article scrolls. The `.content` column is the
  single scroll surface; an inner `.content-inner` keeps the reading column
  centered with a max-width (AC-LAYOUT-NO-HSCROLL: 가로 스크롤 0 + 중앙 정렬 유지).
  This replaces the Slice-6 `position:sticky` sidebar, which was defeated when the
  content overflowed the shared grid row (the menu scrolled away with the body).

  Tab rows are full-width (AC-TAB-FULLWIDTH): each `.tab` spans the sidebar width
  edge-to-edge as a single row (no carved box / card border / radius). The active
  row is marked by a left oxblood rail PLUS a background contrast and a filled
  shape glyph — three redundant cues so the active tab is unambiguous without
  relying on colour alone (color-blind safe).

  All copy is Korean (AC-KOREAN-UI).
-->
<script lang="ts">
  import favicon from '$lib/assets/favicon.svg';
  import '$lib/tokens.css';
  import { onMount, setContext } from 'svelte';
  import { writable, type Writable } from 'svelte/store';
  import { TABS, DEFAULT_TAB, type TabId } from '$lib/nav/tabs';
  import { pipeline } from '$lib/pipeline/store.svelte';
  import { llmConfig } from '$lib/llm/llmClient';
  import { loadAllEntries } from '$lib/wiki/wikiStore';
  import {
    loadPersistedCandidateReviewState,
    loadPersistedOutline,
    loadPersistedSourceSummaries,
  } from '$lib/pipeline/actions';

  let { children } = $props();

  // Active-tab store shared with +page.svelte via context (single source).
  const activeTab: Writable<TabId> = writable(DEFAULT_TAB);
  setContext('activeTab', activeTab);

  let current = $state<TabId>(DEFAULT_TAB);
  activeTab.subscribe((v) => (current = v));

  function select(id: TabId) {
    activeTab.set(id);
  }

  onMount(async () => {
    if (pipeline.bootstrapped) return;
    loadPersistedOutline();
    loadPersistedSourceSummaries();
    await loadPersistedCandidateReviewState();
    pipeline.llmCfg = await llmConfig();
    try {
      pipeline.entries = await loadAllEntries();
    } catch {
      pipeline.entries = [];
    }
    pipeline.bootstrapped = true;
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="app-shell">
  <nav class="sidebar" aria-label="주 메뉴">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">llmwiki</span>
    </div>
    <ul class="tab-list" role="list">
      {#each TABS as tab (tab.id)}
        <li>
          <button
            type="button"
            class="tab"
            class:active={current === tab.id}
            aria-current={current === tab.id ? 'page' : undefined}
            title={tab.hint}
            onclick={() => select(tab.id)}
          >
            <span class="tab-inner">
            <span class="tab-shape" aria-hidden="true">
              {#if tab.shape === 'square'}
                <svg viewBox="0 0 16 16" width="14" height="14"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /></svg>
              {:else if tab.shape === 'circle'}
                <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" /></svg>
              {:else if tab.shape === 'key'}
                <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M8.2 8.2 L13 13 M11 11 L13 9.5 M12 12 L13.5 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
              {:else if tab.shape === 'book'}
                <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2.5 3 H7 a1 1 0 0 1 1 1 v9 a1 1 0 0 0 -1 -1 H2.5 z M13.5 3 H9 a1 1 0 0 0 -1 1 v9 a1 1 0 0 1 1 -1 H13.5 z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
              {:else}
                <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2.5 3.5 h11 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 H7 l-3 2.5 V12.5 H2.5 a1 1 0 0 1 -1 -1 v-6 a1 1 0 0 1 1 -1 z" /></svg>
              {/if}
            </span>
            <span class="tab-label">{tab.label}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </nav>

  <main class="content">
    <div class="content-inner" class:wiki-wide={current === 'wiki'}>
      {@render children()}
    </div>
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--body-family);
    /* AC-SIDEBAR-INDEPENDENT: the body itself never scrolls — the shell is exactly
       100vh and the .content column is the only scroll surface. This is what keeps
       the sidebar pinned (it cannot ride a body scroll that does not exist). */
    height: 100%;
    overflow: hidden;
  }

  :global(*:focus-visible) {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }

  .app-shell {
    /* AC-SIDEBAR-INDEPENDENT: a fixed-viewport flex row. The shell is exactly the
       viewport height and never scrolls itself; each child track owns its own
       overflow, so the sidebar and the article scroll independently. This is what
       guarantees the five tabs stay on-screen no matter how long the article is —
       unlike the Slice-6 sticky sidebar, which rode the shared grid-row scroll. */
    display: flex;
    height: 100vh;
    /* No horizontal overflow at the shell level: the sidebar track is fixed
       (220px) and the content column wraps its own text. (AC-LAYOUT-NO-HSCROLL) */
    overflow-x: hidden;
  }

  .sidebar {
    /* Fixed-width track that fills the full viewport height. It is independent of
       the content scroll; it only scrolls INTERNALLY if its own menu were ever to
       overflow a very short viewport (overflow-y:auto), never dropping a tab. */
    flex: 0 0 220px;
    height: 100vh;
    overflow-y: auto;
    border-right: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
    padding: var(--space-xl) var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
    box-sizing: border-box;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 0 var(--space-sm);
  }

  .brand-mark {
    width: 10px;
    height: 10px;
    border-radius: 2px 6px 2px 6px;
    background: var(--accent-oxblood);
  }

  .brand-name {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-primary);
  }

  .tab-list {
    list-style: none;
    margin: 0;
    /* AC-TAB-FULLWIDTH: rows run edge-to-edge of the sidebar. Negative inline
       margins cancel the sidebar's horizontal padding so each row reaches the
       full sidebar width (끝까지 가는 한 줄) instead of sitting inside an inset
       box. The vertical sidebar padding is preserved. */
    margin-inline: calc(-1 * var(--space-md));
    padding: 0;
    display: flex;
    flex-direction: column;
    /* No gap: rows stack as a contiguous full-width list (not separated cards). */
    gap: 0;
  }

  .tab {
    /* Full-width single row — no carved box, no card border, no radius. */
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-md);
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    /* Active marker = a left oxblood rail. Reserved transparently on every row so
       the label does not shift when a row becomes active (color-blind cue: the
       rail is a SHAPE change, independent of the colour). */
    border-left: 3px solid transparent;
    transition: color var(--motion-fast) var(--ease-deliberate),
      background var(--motion-fast) var(--ease-deliberate),
      border-color var(--motion-fast) var(--ease-deliberate);
  }

  /* Glyph + label sit on one line; the row itself is the full-width block. */
  .tab-inner {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .tab:hover {
    color: var(--text-primary);
    background: var(--surface-base);
  }

  /* AC-TAB-FULLWIDTH active state: three redundant cues — left oxblood rail
     (shape), a background contrast (surface-elevated), and the filled glyph
     below — so the active row reads without relying on colour alone. */
  .tab.active {
    color: var(--text-primary);
    background: var(--surface-elevated);
    border-left-color: var(--accent-oxblood);
  }

  /* Active shape glyph becomes filled (shape cue, independent of colour). */
  .tab-shape :global(svg) {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  .tab.active .tab-shape :global(svg) {
    fill: currentColor;
    stroke: currentColor;
  }

  .tab-shape {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    color: inherit;
  }

  .content {
    /* AC-SIDEBAR-INDEPENDENT: the content column is the single scroll surface.
       It fills the remaining width, owns the full viewport height, and scrolls
       internally — the sidebar is untouched by this scroll. */
    flex: 1 1 auto;
    min-width: 0;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-xl) var(--space-2xl);
    box-sizing: border-box;
  }

  /* AC-LAYOUT-NO-HSCROLL: the reading column keeps its max-width and is centered
     within the (now full-width) scroll column, preserving the centered aesthetic
     while the scrollbar tracks the full content area. */
  .content-inner {
    max-width: 860px;
    margin-inline: auto;
  }

  .content-inner.wiki-wide {
    max-width: 1480px;
  }
</style>
