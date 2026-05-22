<!--
  FeedbackTab.svelte
  ------------------
  AC-FEEDBACK-FORM + AC-FEEDBACK-SUBMIT + AC-FEEDBACK-DEGRADE + AC-FEEDBACK-RATE.

  A free-standing feedback form that needs NO login:
    - 제목 (선택) / 내용 (필수) / 회신 이메일 (선택)
    - 빈 내용은 전송 전에 차단되고 한글 검증 안내가 inline 으로 뜬다.
    - 전송은 렌더러가 직접 fetch 로 Formspree 엔드포인트(설정 단일소스)에
      Accept: application/json POST 한다. CSP=null 이라 Tauri 커맨드가 필요 없다.
    - 성공: "피드백 전송 완료" + 폼 초기화.
    - 오프라인/4xx/5xx/throw: 한글 안내 + 입력 보존 + 앱 유지(크래시 없음).
    - 전송 중 + 짧은 쿨다운 동안 버튼 disable (중복 전송 방지).

  All copy is Korean (AC-KOREAN-UI). The endpoint + accept header live in
  $lib/feedback/config (one-line swap); the validation / payload / degrade
  logic lives in $lib/feedback/submit (pure, Tier-1 tested).
-->
<script lang="ts">
  import { feedbackConfig } from '$lib/feedback/config';
  import { submitFeedback, type SubmitResult } from '$lib/feedback/submit';

  // Cooldown after a send completes (success OR failure) before the button
  // re-enables. Guards against accidental double-submits. No contract number
  // is being targeted; this is simply "short".
  const COOLDOWN_MS = 1500;

  let title = $state('');
  let message = $state('');
  let email = $state('');

  let sending = $state(false);
  let cooling = $state(false);
  let validation_error = $state<string | null>(null);
  let result_notice = $state<{ tone: 'ok' | 'error'; text: string } | null>(null);

  let cooldown_timer: ReturnType<typeof setTimeout> | null = null;

  const disabled = $derived(sending || cooling);

  function start_cooldown() {
    cooling = true;
    if (cooldown_timer) clearTimeout(cooldown_timer);
    cooldown_timer = setTimeout(() => {
      cooling = false;
      cooldown_timer = null;
    }, COOLDOWN_MS);
  }

  async function on_submit(event: SubmitEvent) {
    event.preventDefault();
    if (disabled) return;

    validation_error = null;
    result_notice = null;

    // Client-side required-content guard (mirrors the pure validator). Empty /
    // whitespace-only content is blocked before any network call.
    if (message.trim().length === 0) {
      validation_error = '내용을 입력해 주세요. 내용은 필수 항목입니다.';
      return;
    }

    sending = true;
    let res: SubmitResult;
    try {
      const cfg = feedbackConfig();
      res = await submitFeedback({ title, message, email }, cfg.endpoint);
    } finally {
      sending = false;
      start_cooldown();
    }

    if (res.ok) {
      result_notice = { tone: 'ok', text: res.message };
      // Success → reset the form.
      title = '';
      message = '';
      email = '';
    } else {
      // Degrade: show the Korean message; PRESERVE the user's input (no reset).
      result_notice = { tone: 'error', text: res.message };
    }
  }
</script>

<section class="block">
  <h2 class="section-title">피드백 보내기</h2>
  <p class="section-lede">
    개선 의견이나 버그를 알려 주세요. 로그인 없이 보낼 수 있습니다. 회신 이메일을
    적으시면 답변을 받으실 수 있습니다. (제목·이메일은 선택, 내용은 필수입니다.)
  </p>

  <form class="feedback-form" onsubmit={on_submit} novalidate>
    <div class="field">
      <label class="field-label" for="fb-title">제목 <span class="opt">(선택)</span></label>
      <input
        id="fb-title"
        class="text-input"
        type="text"
        bind:value={title}
        placeholder="한 줄 요약"
        autocomplete="off"
      />
    </div>

    <div class="field">
      <label class="field-label" for="fb-message">내용 <span class="req">(필수)</span></label>
      <textarea
        id="fb-message"
        class="text-input textarea"
        bind:value={message}
        rows="6"
        placeholder="무엇이 좋았는지, 무엇을 고치면 좋을지 자유롭게 적어 주세요."
        aria-required="true"
        aria-invalid={validation_error ? 'true' : 'false'}
        aria-describedby={validation_error ? 'fb-message-error' : undefined}
        oninput={() => { if (validation_error) validation_error = null; }}
      ></textarea>
      {#if validation_error}
        <p id="fb-message-error" class="field-error" role="alert">{validation_error}</p>
      {/if}
    </div>

    <div class="field">
      <label class="field-label" for="fb-email">회신 이메일 <span class="opt">(선택)</span></label>
      <input
        id="fb-email"
        class="text-input"
        type="email"
        bind:value={email}
        placeholder="answer@example.com"
        autocomplete="email"
      />
    </div>

    <div class="action-row">
      <button type="submit" class="btn primary" disabled={disabled}>
        {#if sending}
          전송 중…
        {:else if cooling}
          잠시 후 다시 전송
        {:else}
          피드백 전송
        {/if}
      </button>
    </div>

    {#if result_notice}
      <p
        class="result-notice {result_notice.tone}"
        role={result_notice.tone === 'error' ? 'alert' : 'status'}
      >
        {result_notice.text}
      </p>
    {/if}
  </form>
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

  .feedback-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-lg);
    margin-top: var(--space-md);
    max-width: 560px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .field-label {
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .opt {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .req {
    color: var(--accent-oxblood);
    font-weight: 600;
  }

  .text-input {
    font-family: var(--body-family);
    font-size: 0.9375rem;
    color: var(--text-primary);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    padding: var(--space-sm) var(--space-md);
    transition: border-color var(--motion-fast) var(--ease-deliberate);
  }

  .text-input:focus {
    border-color: var(--accent-oxblood);
    outline: none;
  }

  .textarea {
    resize: vertical;
    line-height: 1.5;
  }

  .field-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger-rust);
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
  }

  .btn {
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 600;
    padding: var(--space-sm) var(--space-lg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    cursor: pointer;
  }

  .btn.primary {
    background: var(--accent-oxblood);
    color: var(--surface-elevated);
    border-color: var(--accent-oxblood);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .result-notice {
    margin: 0;
    font-size: 0.875rem;
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-tight);
    line-height: 1.5;
  }

  .result-notice.ok {
    color: var(--text-primary);
    border-left: 3px solid var(--success-moss);
    background: var(--surface-sunken);
  }

  .result-notice.error {
    color: var(--text-primary);
    border-left: 3px solid var(--danger-rust);
    background: var(--surface-sunken);
  }
</style>
