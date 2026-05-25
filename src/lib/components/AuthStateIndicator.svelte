<!--
  AuthStateIndicator.svelte
  -------------------------
  Five-state indicator (shape primary, icon secondary, color tertiary):
    unconfigured         empty square outline + minus      text-secondary
    codex-detected       filled square + dot               text-primary
    oauth-child-up       filled circle + up-triangle       success-moss
    degraded             half-filled diamond + tri-bang    warn-amber
    dev-fallback-active  hollow triangle + gear            text-secondary

  Shape alone distinguishes the five states in a monochrome / color-blind
  rendering. The state-name label appears in DOM text (not only tooltip) for
  screen-reader access.

  ARIA: role="status" aria-live="polite". Tooltip on hover/focus is revealed
  via var(--motion-fast) — immediate, not slow.

  Round-1: pure presentational; state is a prop. Round-2 wires the state via
  Tauri events to lib/auth/state.ts.
-->
<script lang="ts">
  export type AuthIndicatorState =
    | 'unconfigured'
    | 'codex-detected'
    | 'oauth-child-up'
    | 'degraded'
    | 'dev-fallback-active';

  type Props = {
    state?: AuthIndicatorState;
  };
  let { state = 'unconfigured' as AuthIndicatorState }: Props = $props();

  const labels: Record<AuthIndicatorState, string> = {
    'unconfigured': '인증 미설정',
    'codex-detected': 'Codex 인증 감지됨',
    'oauth-child-up': '프록시 준비됨',
    'degraded': '프록시 응답 저하',
    'dev-fallback-active': '개발용 대체 모드',
  };

  const tooltips: Record<AuthIndicatorState, string> = {
    'unconfigured':
      'Codex 인증 파일을 찾을 수 없습니다. 자동 모드를 쓰려면 Node.js 설치 후 `npm i -g @openai/codex`, `codex login`을 실행하세요. 후보별 복붙 모드는 그대로 사용할 수 있습니다.',
    'codex-detected':
      'Codex 인증 파일이 있습니다. 프록시가 시작되면 LLM 기능을 사용할 수 있습니다.',
    'oauth-child-up':
      'openai-oauth 자식 프로세스가 http://127.0.0.1:<port>/v1 에서 실행 중입니다.',
    'degraded':
      'openai-oauth 자식 프로세스가 종료되었거나 준비 신호가 감지되지 않았습니다. 재시도 대기 중입니다.',
    'dev-fallback-active':
      '개발용 대체 플래그가 설정되었거나 Codex 인증 파일이 없습니다. LLM 기능은 스텁(모의)으로 동작합니다.',
  };
</script>

<span
  class="auth-indicator focus-ring"
  data-state={state}
  role="status"
  aria-live="polite"
  title={tooltips[state]}
>
  <span class="shape" aria-hidden="true">
    {#if state === 'unconfigured'}
      <!-- empty square + minus -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <rect x="4" y="4" width="16" height="16" />
        <line x1="9" y1="12" x2="15" y2="12" />
      </svg>
    {:else if state === 'codex-detected'}
      <!-- filled square + dot -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <rect x="4" y="4" width="16" height="16" />
        <circle cx="12" cy="12" r="1.5" fill="var(--surface-base)" stroke="none" />
      </svg>
    {:else if state === 'oauth-child-up'}
      <!-- filled circle + up triangle -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <circle cx="12" cy="12" r="8" />
        <polygon points="12,7 16,14 8,14" fill="var(--surface-base)" stroke="none" />
      </svg>
    {:else if state === 'degraded'}
      <!-- half-filled diamond + exclamation in triangle -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <polygon points="12,3 21,12 12,21 3,12" />
        <path d="M3 12 L12 3 L12 21 Z" fill="currentColor" stroke="none" />
        <polygon points="12,9 16,16 8,16" fill="var(--surface-base)" stroke="currentColor" stroke-width="1.2" />
        <line x1="12" y1="11" x2="12" y2="13.5" stroke="currentColor" stroke-width="1.4" />
        <circle cx="12" cy="14.8" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    {:else if state === 'dev-fallback-active'}
      <!-- hollow triangle + gear -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <polygon points="12,3 22,20 2,20" />
        <circle cx="12" cy="14" r="2" />
        <line x1="12" y1="10.5" x2="12" y2="9" />
        <line x1="12" y1="17.5" x2="12" y2="19" />
        <line x1="9" y1="14" x2="7.5" y2="14" />
        <line x1="15" y1="14" x2="16.5" y2="14" />
      </svg>
    {/if}
  </span>
  <span class="label">{labels[state]}</span>
</span>

<style>
  .auth-indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    font-family: var(--body-family);
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: default;
    box-shadow: var(--shadow-press);
    transition: color var(--motion-fast) var(--ease-deliberate),
      border-color var(--motion-fast) var(--ease-deliberate),
      background var(--motion-fast) var(--ease-deliberate);
  }

  .auth-indicator[data-state='unconfigured'] {
    color: var(--text-secondary);
  }

  .auth-indicator[data-state='codex-detected'] {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }

  .auth-indicator[data-state='oauth-child-up'] {
    color: var(--success-moss);
    border-color: var(--success-moss);
    background: var(--surface-elevated);
  }

  .auth-indicator[data-state='degraded'] {
    color: var(--warn-amber);
    border-color: var(--warn-amber);
  }

  .auth-indicator[data-state='dev-fallback-active'] {
    color: var(--text-secondary);
    border-style: dashed;
  }

  .shape {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
  }

  .label {
    font-family: var(--body-family);
    color: inherit;
  }
</style>
