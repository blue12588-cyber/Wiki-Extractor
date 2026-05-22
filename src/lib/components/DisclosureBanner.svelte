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
  // Korean-ized for Slice 4 (AC-KOREAN-UI). The legal/security meaning is
  // preserved verbatim; only the language changed. The matcher substrings in
  // fixtures/disclosure-phrase-matchers.json were updated in lock-step.
  const phrase_rows: ReadonlyArray<{ id: string; text: string; emphasize?: boolean }> = [
    {
      id: 'community-unofficial',
      text: '커뮤니티 / 비공식 프로젝트 — OpenAI와 무관합니다',
    },
    {
      id: 'tos-risk',
      text: 'ChatGPT 자격 증명을 사용하면 OpenAI 이용약관 위반 위험이 있으며, 그 위험은 사용자가 감수합니다',
    },
    {
      id: 'password-equivalent',
      text: '인증 토큰은 비밀번호와 동등합니다. 공유하거나 호스팅하지 마세요',
      emphasize: true,
    },
    {
      id: 'single-machine',
      text: '이 단일 기기에서 개인 용도로만 사용하세요',
    },
  ];
</script>

{#if auth_reachable}
  <section
    class="disclosure-banner"
    data-test="disclosure-banner"
    aria-label="법적·보안 고지"
  >
    <div class="left-rule" aria-hidden="true"></div>
    <div class="content">
      <h2 class="title">이 기기에서 LLM 기능을 실행하기 전에 확인하세요</h2>
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
          {acknowledged ? '확인함' : '이해했고 동의합니다'}
        </button>
        <button
          type="button"
          class="why-toggle focus-ring"
          aria-expanded={why_open}
          aria-controls="disclosure-why"
          onclick={toggle_why}
        >
          {why_open ? '설명 숨기기' : '이 고지에 대한 설명'}
        </button>
      </div>

      {#if why_open}
        <div id="disclosure-why" class="why-body" role="note">
          <p>
            openai-oauth의 README는 다음과 같이 명시합니다(§Legal): "이것은
            비공식이며 커뮤니티가 유지보수하는 프로젝트로, OpenAI, Inc.와
            제휴·보증·후원 관계가 없습니다."
          </p>
          <p>
            이 프로젝트는 로컬 Codex / ChatGPT 인증 캐시(auth.json, 예:
            ~/.codex/auth.json)를 사용하며 이를 비밀번호와 동등하게 취급합니다.
            신뢰할 수 있는 단일 사용자 기기에서의 개인적·로컬 실험에만
            사용하세요. 호스팅 서비스, 공유 접근, 토큰의 통합·재배포는 모두
            금지됩니다. 전체 법적 고지는
            <a
              href="https://github.com/EvanZhouDev/openai-oauth"
              rel="noreferrer noopener"
              target="_blank"
              class="focus-ring"
            >GitHub의 openai-oauth</a>
            에서 확인하세요.
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
