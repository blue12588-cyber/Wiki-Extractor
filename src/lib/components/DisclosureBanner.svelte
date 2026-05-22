<!--
  DisclosureBanner.svelte
  -----------------------
  AC-OAUTH-DISCLOSURE: persistent legal/security banner.

  Renders four required key-phrases in the user's voice (paraphrase, not a
  verbatim README quote). Each phrase is on its own row so the
  T1-banner-mount-and-disclosure-text scenario can assert visible-phrase
  presence without HTML parsing heuristics.

  Visual treatment (per agreed_contract.json#design_criteria):
    - surface-elevated background
    - 1px border-subtle outline
    - 4px left rule in accent-oxblood (NO red bg / NO exclamation glyph / NO close-X)
    - heading-family title row, body-family phrase rows
    - radius-pill acknowledgment CTA, filled accent-oxblood
    - "Why this banner" toggle = inline disclosure, not modal
    - All transitions use var(--ease-deliberate) over var(--motion-base)

  Round-1 scaffold note:
    - O-3 acknowledgment lifetime is deferred. Round-1 keeps the banner mounted
      whenever auth_reachable=true; acknowledgment is component-local state.
-->
<script lang="ts">
  type Props = {
    auth_reachable?: boolean;
  };
  let { auth_reachable = true }: Props = $props();

  let why_open = $state(false);
  let acknowledged = $state(false);

  function toggle_why() {
    why_open = !why_open;
  }

  function acknowledge() {
    acknowledged = true;
  }

  // Phrase matchers exported for T1-banner-mount-and-disclosure-text alignment.
  // Each phrase row's DOM text contains the matcher substring exactly.
  const phrase_rows: ReadonlyArray<{ id: string; text: string; emphasize?: boolean }> = [
    {
      id: 'community-unofficial',
      text: 'Community / unofficial — not affiliated with OpenAI',
    },
    {
      id: 'tos-risk',
      text: 'Using your ChatGPT credentials carries OpenAI Terms of Service risk; you accept that risk',
    },
    {
      id: 'password-equivalent',
      text: 'Your auth token is password-equivalent; do not share or host',
      emphasize: true,
    },
    {
      id: 'single-machine',
      text: 'Personal use on this single machine only',
    },
  ];
</script>

{#if auth_reachable}
  <section
    class="disclosure-banner"
    data-test="disclosure-banner"
    aria-label="Legal and security disclosure"
  >
    <div class="left-rule" aria-hidden="true"></div>
    <div class="content">
      <h2 class="title">Before LLM features can run on this machine</h2>
      <ul class="phrase-list">
        {#each phrase_rows as row (row.id)}
          <li
            class="phrase-row"
            data-test="disclosure-key-phrase"
            data-phrase-id={row.id}
            class:emphasize={row.emphasize === true}
          >
            {row.text}
          </li>
        {/each}
      </ul>

      <div class="action-row">
        <button
          type="button"
          class="ack-cta focus-ring"
          aria-pressed={acknowledged}
          onclick={acknowledge}
          disabled={acknowledged}
        >
          {acknowledged ? 'Acknowledged' : 'I understand and accept'}
        </button>
        <button
          type="button"
          class="why-toggle focus-ring"
          aria-expanded={why_open}
          aria-controls="disclosure-why"
          onclick={toggle_why}
        >
          {why_open ? 'Hide why' : 'Why this banner'}
        </button>
      </div>

      {#if why_open}
        <div id="disclosure-why" class="why-body" role="note">
          <p>
            openai-oauth's own README states (§Legal): "This is an unofficial,
            community-maintained project and is not affiliated with, endorsed
            by, or sponsored by OpenAI, Inc."
          </p>
          <p>
            The project uses your local Codex / ChatGPT authentication cache
            (auth.json, e.g. ~/.codex/auth.json) and treats it as
            password-equivalent. Personal, local experimentation on trusted
            single-user machines only — no hosted service, no shared access,
            no pooled or redistributed tokens. See
            <a
              href="https://github.com/EvanZhouDev/openai-oauth"
              rel="noreferrer noopener"
              target="_blank"
              class="focus-ring"
            >openai-oauth on GitHub</a>
            for the full legal section.
          </p>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .disclosure-banner {
    display: grid;
    grid-template-columns: 4px 1fr;
    background: var(--surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    box-shadow: var(--shadow-hairline);
    margin-bottom: var(--space-xl);
    overflow: hidden;
    font-family: var(--body-family);
    color: var(--text-primary);
  }

  .left-rule {
    width: 4px;
    background: var(--accent-oxblood);
  }

  .content {
    padding: var(--space-lg) var(--space-xl);
  }

  .title {
    font-family: var(--heading-family);
    font-weight: 600;
    font-size: 1.0625rem;
    line-height: 1.3;
    margin: 0 0 var(--space-md) 0;
    color: var(--text-primary);
  }

  .phrase-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .phrase-row {
    font-family: var(--body-family);
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-primary);
    padding-left: var(--space-md);
    position: relative;
  }

  .phrase-row::before {
    content: "·";
    position: absolute;
    left: var(--space-xs);
    color: var(--accent-oxblood);
    font-weight: 700;
  }

  .phrase-row.emphasize {
    color: var(--danger-rust);
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    margin-top: var(--space-lg);
    flex-wrap: wrap;
  }

  .ack-cta {
    appearance: none;
    background: var(--accent-oxblood);
    color: var(--surface-elevated);
    border: 1px solid var(--accent-oxblood);
    border-radius: var(--radius-pill);
    padding: var(--space-sm) var(--space-lg);
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--motion-base) var(--ease-deliberate),
      color var(--motion-base) var(--ease-deliberate),
      box-shadow var(--motion-fast) var(--ease-deliberate);
  }

  .ack-cta:hover:not(:disabled) {
    box-shadow: var(--shadow-press);
  }

  .ack-cta:disabled {
    background: transparent;
    color: var(--text-secondary);
    border-color: var(--border-subtle);
    cursor: default;
  }

  .why-toggle {
    appearance: none;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    padding: var(--space-sm) var(--space-md);
    font-family: var(--body-family);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background var(--motion-base) var(--ease-deliberate),
      color var(--motion-base) var(--ease-deliberate);
  }

  .why-toggle:hover {
    color: var(--text-primary);
    background: var(--surface-base);
  }

  .why-body {
    margin-top: var(--space-lg);
    padding: var(--space-md) var(--space-lg);
    background: var(--surface-base);
    border-radius: var(--radius-soft);
    color: var(--text-secondary);
    font-family: var(--body-family);
    font-size: 0.875rem;
    line-height: 1.55;
    /* Inline disclosure animates open via the parent {#if} mount + token-based
       opacity/transform on Round-2; Round-1 leaves the instant mount intact. */
    animation: disclosure-open var(--motion-base) var(--ease-deliberate);
  }

  .why-body p {
    margin: 0 0 var(--space-sm) 0;
  }

  .why-body p:last-child {
    margin-bottom: 0;
  }

  .why-body a {
    color: var(--accent-oxblood);
    text-decoration: underline;
  }

  @keyframes disclosure-open {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
