/**
 * Pipeline store — shared, layout-level state for the tabbed shell.
 *
 * Authority: agreed_contract.json (Slice 4)#AC-NAV + AC-MAIN-TAB +
 *            AC-WIKI-TAB (state preserved across tab switches).
 *
 * Routing decision (open-question #1): a single `+layout.svelte` holds the
 * sidebar + an active-tab string; the four "views" are components, not routes.
 * Because the pipeline state lives HERE (module-level Svelte 5 `$state` rune,
 * shared by every importer) rather than inside a view component, switching
 * tabs unmounts/remounts a view WITHOUT discarding bundle / chunks / outline /
 * entries. SPA fallback + adapter-static prerender are unaffected (no new
 * routes were added).
 */

import type { CandidateBundle } from '$lib/extract/candidateExtractor';
import type { Chunk } from '$lib/chunk/chunker';
import type { ParsedOutline } from '$lib/outline/outlineParser';
import type { WikiEntry } from '$lib/wiki/wikiTypes';
import type { LlmConfigSnapshot } from '$lib/llm/llmClient';

export type TabId = 'main' | 'wiki' | 'login' | 'feedback';

/**
 * One reactive object exported as a singleton. Components read/write fields on
 * `pipeline.*`; Svelte 5 deep reactivity propagates the changes across views.
 */
function createPipeline() {
  let bundle = $state<CandidateBundle | null>(null);
  let chunks = $state<Chunk[]>([]);
  let chunkStatus = $state<string | null>(null);
  let extracting = $state(false);

  let outline = $state<ParsedOutline | null>(null);
  let entries = $state<WikiEntry[]>([]);
  let llmCfg = $state<LlmConfigSnapshot>({
    model: 'gpt-5.4',
    auth: 'oauth_subscription',
    endpoint_base: null,
    reachable: false,
  });
  let notice = $state<string | null>(null);
  let busy = $state(false);
  /** Set true once onMount in the layout has loaded persisted entries + cfg. */
  let bootstrapped = $state(false);

  return {
    get bundle() { return bundle; },
    set bundle(v) { bundle = v; },
    get chunks() { return chunks; },
    set chunks(v) { chunks = v; },
    get chunkStatus() { return chunkStatus; },
    set chunkStatus(v) { chunkStatus = v; },
    get extracting() { return extracting; },
    set extracting(v) { extracting = v; },
    get outline() { return outline; },
    set outline(v) { outline = v; },
    get entries() { return entries; },
    set entries(v) { entries = v; },
    get llmCfg() { return llmCfg; },
    set llmCfg(v) { llmCfg = v; },
    get notice() { return notice; },
    set notice(v) { notice = v; },
    get busy() { return busy; },
    set busy(v) { busy = v; },
    get bootstrapped() { return bootstrapped; },
    set bootstrapped(v) { bootstrapped = v; },
  };
}

export const pipeline = createPipeline();
