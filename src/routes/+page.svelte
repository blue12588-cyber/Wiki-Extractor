<!--
  +page.svelte — the single page; renders the active tab's view.

  Routing decision (open-question #1): the sidebar + active-tab string live in
  +layout.svelte; this page reads the shared `activeTab` store from context and
  shows exactly one view. Because every view reads the layout-level `pipeline`
  store, switching tabs preserves pipeline state (AC-NAV / AC-MAIN-TAB /
  AC-WIKI-TAB).

  All four views render Korean copy (AC-KOREAN-UI).
-->
<script lang="ts">
  import { getContext } from 'svelte';
  import type { Writable } from 'svelte/store';
  import type { TabId } from '$lib/nav/tabs';
  import MainTab from '$lib/components/views/MainTab.svelte';
  import WikiTab from '$lib/components/views/WikiTab.svelte';
  import LoginTab from '$lib/components/views/LoginTab.svelte';
  import FeedbackTab from '$lib/components/views/FeedbackTab.svelte';

  const activeTab = getContext<Writable<TabId>>('activeTab');
</script>

{#if $activeTab === 'main'}
  <MainTab />
{:else if $activeTab === 'wiki'}
  <WikiTab />
{:else if $activeTab === 'login'}
  <LoginTab />
{:else if $activeTab === 'feedback'}
  <FeedbackTab />
{/if}
