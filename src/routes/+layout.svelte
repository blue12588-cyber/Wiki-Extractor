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
            <span class="tab-shape" aria-hidden="true">
              {#if tab.shape === 'square'}
                <svg viewBox="0 0 16 16" width="14" height="14"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /></svg>
              {:else if tab.shape === 'circle'}
                <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" /></svg>
              {:else if tab.shape === 'key'}
                <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M8.2 8.2 L13 13 M11 11 L13 9.5 M12 12 L13.5 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
              {:else}
                <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2.5 3.5 h11 a1 1 0 0 1 1 1 v6 a1 1 0 0 1 -1 1 H7 l-3 2.5 V12.5 H2.5 a1 1 0 0 1 -1 -1 v-6 a1 1 0 0 1 1 -1 z" /></svg>
              {/if}
            </span>
            <span class="tab-label">{tab.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  </nav>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--body-family);
  }

  :global(*:focus-visible) {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }

  .app-shell {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
  }

  .sidebar {
    border-right: 1px solid var(--border-subtle);
    background: var(--surface-sunken);
    padding: var(--space-xl) var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-xl);
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
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .tab {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid transparent;
    border-radius: var(--radius-soft);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    /* Left rail marker is drawn via the active border-left, not colour alone. */
    border-left: 3px solid transparent;
    transition: color var(--motion-fast) var(--ease-deliberate),
      background var(--motion-fast) var(--ease-deliberate),
      border-color var(--motion-fast) var(--ease-deliberate);
  }

  .tab:hover {
    color: var(--text-primary);
    background: var(--surface-base);
  }

  .tab.active {
    color: var(--text-primary);
    background: var(--surface-elevated);
    border-color: var(--border-subtle);
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
    padding: var(--space-xl) var(--space-2xl);
    max-width: 860px;
  }
</style>
