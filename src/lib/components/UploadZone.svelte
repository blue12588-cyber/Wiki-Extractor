<!--
  UploadZone.svelte
  -----------------
  AC-UPLOAD: drag/drop + file-picker zone with five visual states.

  Round-1 scope:
    - Five states with distinct shape + icon + text signals (color is third):
        idle / drag-over / accepting / rejecting / success
    - Drop target shape is radius-asymmetric in every state.
    - Selecting a file emits `select` with the File object.
    - Magic-bytes + source_id (SHA-256 prefix) copy = Round-2 (this Round
      stubs the data flow at the boundary of the `select` event).

  ARIA:
    - role="button"
    - aria-describedby points to the accepted-mime hint
    - keyboard reach via Enter / Space on the focused zone

  Visual transitions: every state change uses var(--ease-deliberate) over
  var(--motion-fast) for icon/border or var(--motion-base) for surface tone.
-->
<script lang="ts">
  type ZoneState = 'idle' | 'drag-over' | 'accepting' | 'rejecting' | 'success';

  type Props = {
    initial_state?: ZoneState;
    initial_reason?: string;
    initial_success_text?: string;
    onselect?: (file: File) => void;
    onselectmany?: (files: File[]) => void;
  };

  let {
    initial_state = 'idle',
    initial_reason = '',
    initial_success_text = '',
    onselect,
    onselectmany,
  }: Props = $props();

  // Round-1 surface: the props are *initial* values only — they seed the
  // component-local state and are intentionally not reactive afterward.
  // Round-2 will swap this for a Tauri-event-driven store when host upload
  // pipeline wiring lands. The $state cells start at the design defaults;
  // an $effect synchronizes the first prop snapshot after mount so callers
  // that pass non-default initial values still see the seeded state.
  let zone_state: ZoneState = $state('idle');
  let reason: string = $state('');
  let success_text: string = $state('');

  $effect(() => {
    // One-shot prop -> state seeding. The cells stay locally writable from
    // exported imperative API (set_success / set_reject / reset).
    zone_state = initial_state;
    reason = initial_reason;
    success_text = initial_success_text;
  });

  let file_input_el: HTMLInputElement | null = null;
  const accepted_mime = 'text/plain, text/markdown, application/pdf';
  const accepted_hint_id = 'upload-zone-mime-hint';

  function open_picker() {
    file_input_el?.click();
  }

  function on_files(file_list: FileList | null) {
    if (!file_list || file_list.length === 0) return;
    const files = Array.from(file_list);
    zone_state = 'accepting';
    if (files.length === 1) {
      onselect?.(files[0]);
      return;
    }
    onselectmany?.(files);
  }

  function on_change(ev: Event) {
    const t = ev.target as HTMLInputElement;
    on_files(t.files);
    // Reset so re-selecting the same file fires the change event again.
    t.value = '';
  }

  function on_drop(ev: DragEvent) {
    ev.preventDefault();
    zone_state = 'idle';
    if (ev.dataTransfer?.files) {
      on_files(ev.dataTransfer.files);
    }
  }

  function on_dragover(ev: DragEvent) {
    ev.preventDefault();
    if (zone_state === 'idle' || zone_state === 'drag-over') {
      zone_state = 'drag-over';
    }
  }

  function on_dragleave() {
    if (zone_state === 'drag-over') zone_state = 'idle';
  }

  function on_keydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open_picker();
    }
  }

  /**
   * Imperative API for Round-2 wiring: after the host has hashed the file and
   * computed the source_id, call set_success(text) or set_reject(reason) to
   * transition to the terminal visual state.
   */
  export function set_success(text: string) {
    success_text = text;
    zone_state = 'success';
  }
  export function set_reject(why: string) {
    reason = why;
    zone_state = 'rejecting';
  }
  export function reset() {
    reason = '';
    success_text = '';
    zone_state = 'idle';
  }
</script>

<div
  class="upload-zone state-{zone_state} focus-ring"
  data-state={zone_state}
  role="button"
  tabindex="0"
  aria-describedby={accepted_hint_id}
  aria-label="Upload a plaintext, Markdown, or PDF file"
  onclick={open_picker}
  onkeydown={on_keydown}
  ondrop={on_drop}
  ondragover={on_dragover}
  ondragleave={on_dragleave}
>
  {#if zone_state === 'accepting'}
    <div class="progress-hairline" aria-hidden="true"></div>
  {/if}

  <div class="icon" aria-hidden="true">
    {#if zone_state === 'idle' || zone_state === 'drag-over'}
      <!-- Upload glyph: simple up-arrow into a tray. -->
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v11" />
        <path d="M7 9l5-5 5 5" />
        <path d="M4 19h16" />
      </svg>
    {:else if zone_state === 'accepting'}
      <!-- Paper-with-arrow glyph. -->
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
        <path d="M12 11v6" />
        <path d="M9 14l3-3 3 3" />
      </svg>
    {:else if zone_state === 'rejecting'}
      <!-- Hexagonal no-entry outline. -->
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="6,3 18,3 22,12 18,21 6,21 2,12" />
        <line x1="7" y1="12" x2="17" y2="12" />
      </svg>
    {:else if zone_state === 'success'}
      <!-- Checkmark-in-square (square deliberate, not the AI-default circle). -->
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
        <path d="M8 12.5l3 3 5-7" />
      </svg>
    {/if}
  </div>

  <div class="copy">
    {#if zone_state === 'idle'}
      <p class="primary">Drop a file here or click to pick</p>
      <p id={accepted_hint_id} class="hint">Plaintext, Markdown, or PDF · multiple files OK</p>
    {:else if zone_state === 'drag-over'}
      <p class="primary">Release to upload</p>
      <p id={accepted_hint_id} class="hint">{accepted_mime}</p>
    {:else if zone_state === 'accepting'}
      <p class="primary">Reading file…</p>
      <p id={accepted_hint_id} class="hint">Hash + magic-bytes check in progress</p>
    {:else if zone_state === 'rejecting'}
      <p class="primary">Could not accept that file</p>
      <p id={accepted_hint_id} class="hint reason">{reason || 'Magic-bytes signature did not match the declared file extension.'}</p>
    {:else if zone_state === 'success'}
      <p class="primary">Saved</p>
      <p id={accepted_hint_id} class="hint">{success_text || 'Saved to data/sources/<source_id>/'}</p>
    {/if}
  </div>

  <input
    bind:this={file_input_el}
    type="file"
    accept={accepted_mime}
    onchange={on_change}
    class="hidden-input"
    tabindex="-1"
    aria-hidden="true"
    multiple
  />
</div>

<style>
  .upload-zone {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-lg) var(--space-xl);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color var(--motion-fast) var(--ease-deliberate),
      background var(--motion-base) var(--ease-deliberate);
  }

  .upload-zone.state-drag-over {
    border: 2px solid var(--accent-oxblood);
    background: var(--surface-elevated);
  }

  .upload-zone.state-accepting {
    border: 2px solid var(--accent-oxblood);
    background: var(--surface-elevated);
  }

  .upload-zone.state-rejecting {
    border: 2px solid transparent;
    background:
      repeating-linear-gradient(
        45deg,
        var(--warn-amber) 0,
        var(--warn-amber) 2px,
        var(--surface-sunken) 2px,
        var(--surface-sunken) 8px
      ) border-box;
    background-clip: padding-box, border-box;
    /* The repeating-linear-gradient sits on the BORDER channel via the
       trick of double-background-clip; the inner surface remains
       surface-sunken so the diagonal-stripe reads as a border treatment. */
    box-shadow: inset 0 0 0 6px var(--surface-sunken);
  }

  .upload-zone.state-success {
    border: 1px solid var(--success-moss);
    background: var(--surface-sunken);
  }

  .progress-hairline {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 1px;
    background: var(--accent-oxblood);
    animation: hairline-pulse var(--motion-slow) var(--ease-deliberate) infinite;
  }

  @keyframes hairline-pulse {
    0% { opacity: 0.3; transform: scaleX(0.2); transform-origin: left; }
    50% { opacity: 1; transform: scaleX(1); }
    100% { opacity: 0.3; transform: scaleX(0.2); transform-origin: right; }
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    transition: transform var(--motion-fast) var(--ease-deliberate),
      color var(--motion-fast) var(--ease-deliberate);
  }

  .upload-zone.state-drag-over .icon {
    transform: scale(1.06);
    color: var(--accent-oxblood);
  }

  .upload-zone.state-accepting .icon {
    color: var(--accent-oxblood);
  }

  .upload-zone.state-rejecting .icon {
    color: var(--warn-amber);
  }

  .upload-zone.state-success .icon {
    color: var(--success-moss);
  }

  .copy {
    font-family: var(--body-family);
  }

  .primary {
    margin: 0;
    font-family: var(--body-family);
    font-size: 0.9375rem;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .hint {
    margin: var(--space-xs) 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .hint.reason {
    color: var(--text-primary);
  }

  .hidden-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
