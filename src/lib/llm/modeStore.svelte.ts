/**
 * Provider-mode store — Slice 5c (AC-AUTH-ABSTRACT + AC-LOGIN-TAB-5c +
 * AC-GRACEFUL).
 *
 * Authority: agreed_contract.json#AC-AUTH-ABSTRACT + AC-LOGIN-TAB-5c +
 *            AC-GRACEFUL.
 *
 * The single, app-wide source of truth for:
 *   - the codex detection snapshot (read-only),
 *   - the per-provider availability list,
 *   - the user's SELECTED provider (the auto/copy-paste toggle).
 *
 * Default selection is ALWAYS `offline` (copy-paste) — the common-person path —
 * even when codex is available. Auto mode is an explicit opt-in (constraints:
 * "codex 강요 0", "기본 모드 = offline 복붙"). If the user has auto selected but
 * codex later becomes unavailable, `effectiveProviderId()` collapses back to
 * `offline` so the UI degrades gracefully without the user having to re-toggle.
 *
 * Uses a Svelte 5 rune `$state` object so views react to changes.
 */

import {
  detectCodex,
  providerAvailabilities,
  startCodexLogin,
  type CodexDetectSnapshot,
  type CodexLoginOutcome,
  type ProviderAvailability,
  type ProviderId,
  type Verification,
} from './provider';

const INITIAL_DETECT: CodexDetectSnapshot = {
  available: false,
  auth_file_present: false,
  login_probe: 'missing',
  codex_cli_missing: true,
  origin: 'none',
};

interface ModeState {
  detect: CodexDetectSnapshot;
  availabilities: ProviderAvailability[];
  /** What the user picked. Default offline (common-person). */
  selected: ProviderId;
  /** True while a detect refresh is in flight. */
  refreshing: boolean;
  /** True while a `codex login` spawn is in flight (Slice 6 — button busy). */
  loggingIn: boolean;
  /**
   * Korean status line from the last login button press (Slice 6). null when no
   * login has been attempted this session. Shown beneath the login button so the
   * user always gets a friendly, color-independent message (AC-CODEX-LOGIN-BTN /
   * AC-KOREAN-UI). Never holds any token/secret — only guidance text.
   */
  loginMessage: string | null;
  /**
   * A device-code verification challenge (URL + code), when codex emits one
   * (`--device-auth`). Shown so the user can complete the flow in the browser:
   * the renderer displays the code prominently + offers an open-URL / copy-code
   * affordance (Slice 8 — AC-LOGIN-CODE-UI). null otherwise. NON-SECRET — the
   * access token is written by codex into auth.json and never surfaced here.
   */
  loginVerification: Verification | null;
  /**
   * True once a detect-first check (Slice 8 — AC-LOGIN-DETECT-FIRST) found the
   * machine ALREADY authed and short-circuited the login button: no `codex
   * login` was spawned and no browser was opened (correct — re-auth is not
   * needed). The renderer uses this to show the "이미 로그인되어 있습니다" message
   * without the device-code UI.
   */
  alreadyAuthed: boolean;
  /**
   * Polarity of the last login outcome, for the status rail's visual accent
   * (Slice 6 repair #3). 'success' iff codex is now authed; 'attention' for any
   * non-success outcome (not_authed/pending/cli_missing/failed) that still needs
   * a user action; null before any attempt. The Korean text already disambiguates
   * — this only keeps the accent COLOR from contradicting the message (color +
   * text dual-coded; never color-only).
   */
  loginOutcomeKind: 'success' | 'attention' | null;
  /**
   * True once a default (browser-callback) login attempt has finished WITHOUT
   * reaching `authed` this session (Slice 6 repair #2). The device-code fallback
   * affordance is emphasized when this is set — it is the exact case device-auth
   * exists for (browser cannot open / locked-down environment). The fallback is
   * still reachable before any attempt too, just less prominent.
   */
  defaultLoginUnfinished: boolean;
}

export const modeStore = $state<ModeState>({
  detect: INITIAL_DETECT,
  availabilities: providerAvailabilities(INITIAL_DETECT),
  selected: 'offline',
  refreshing: false,
  loggingIn: false,
  loginMessage: null,
  loginVerification: null,
  loginOutcomeKind: null,
  defaultLoginUnfinished: false,
  alreadyAuthed: false,
});

/** Re-run codex detection (read-only) and refresh the availability list. */
export async function refreshDetect(): Promise<void> {
  modeStore.refreshing = true;
  try {
    const detect = await detectCodex();
    applyDetect(detect);
    // If the user had auto selected but it is no longer available, do NOT force
    // them off it in the store (so the toggle still shows their intent), but
    // `effectiveProviderId()` will collapse to offline at use time.
  } finally {
    modeStore.refreshing = false;
  }
}

/** Apply a detect snapshot to the store (shared by refresh + login). */
function applyDetect(detect: CodexDetectSnapshot): void {
  modeStore.detect = detect;
  modeStore.availabilities = providerAvailabilities(detect);
}

/**
 * Press the ChatGPT-login button (Slice 6 + Slice 8 fix).
 *
 * Slice-8 DETECT-FIRST (AC-LOGIN-DETECT-FIRST): before spawning anything, run a
 * READ-ONLY `codex_detect`. If the machine is ALREADY authed, we DO NOT spawn
 * `codex login` and DO NOT open a browser (re-auth is unnecessary — this is the
 * exact "I pressed the button and nothing opened" confusion the user hit). We
 * instead flip availability on, show a friendly "이미 로그인되어 있습니다 · 자동
 * 모드를 바로 쓸 수 있어요" message, and return an `authed` outcome WITHOUT a
 * spawn. The auto-mode radio becomes selectable; we do not force-select it.
 *
 * When NOT already authed, spawn `codex login` (Slice-8 defaults to the
 * `--device-auth` device-code flow so a verification URL+code is emitted even on
 * a piped/no-TTY spawn). The Rust side opens the URL in the browser + parses the
 * code; we surface it here:
 *
 *   - `authed`     → apply the carried detect snapshot (now available).
 *   - `not_authed` → apply the carried snapshot (still unavailable) + message.
 *   - `pending`    → keep current state; show the device-code + URL + a "다시
 *                    검출" hint (AC-LOGIN-CODE-UI). A read-only refresh is run so
 *                    a meanwhile-completed flow is still picked up.
 *   - `cli_missing`/`failed` → message only; copy-paste stays the default
 *                    (AC-LOGIN-GRACEFUL).
 *
 * The app NEVER writes the auth file — codex does. This action only detects,
 * spawns, opens a URL, and re-reads. Never throws; always leaves a Korean
 * `loginMessage`.
 */
export async function loginWithChatGPT(deviceAuth = true): Promise<CodexLoginOutcome> {
  modeStore.loggingIn = true;
  modeStore.loginVerification = null;
  modeStore.alreadyAuthed = false;
  try {
    // DETECT-FIRST (AC-LOGIN-DETECT-FIRST): already authed → never spawn, never
    // open a browser; just enable auto mode + reassure the user.
    const pre = await detectCodex();
    if (pre.available) {
      applyDetect(pre);
      modeStore.loginMessage =
        '이미 ChatGPT에 로그인되어 있습니다. [추출 모드]에서 자동 LLM 모드를 바로 쓸 수 있어요. (다시 로그인할 필요가 없어 브라우저가 열리지 않은 것이 정상입니다. 원하면 복붙 모드를 그대로 쓰셔도 됩니다.)';
      modeStore.loginOutcomeKind = 'success';
      modeStore.defaultLoginUnfinished = false;
      modeStore.alreadyAuthed = true;
      return { state: 'authed', detect: pre };
    }

    const outcome = await startCodexLogin(deviceAuth);
    switch (outcome.state) {
      case 'authed':
        applyDetect(outcome.detect);
        modeStore.loginMessage =
          'ChatGPT 로그인이 확인되었습니다. 이제 [추출 모드]에서 자동 LLM 모드를 켤 수 있습니다. (원하지 않으면 복붙 모드를 그대로 쓰셔도 됩니다.)';
        modeStore.loginOutcomeKind = 'success';
        // Login finished successfully — the device-code fallback no longer needs
        // emphasis (and applyDetect already flipped availability).
        modeStore.defaultLoginUnfinished = false;
        break;
      case 'not_authed':
        applyDetect(outcome.detect);
        modeStore.loginMessage = outcome.message;
        modeStore.loginOutcomeKind = 'attention';
        break;
      case 'pending':
        modeStore.loginMessage = outcome.message;
        modeStore.loginVerification = outcome.verification;
        modeStore.loginOutcomeKind = 'attention';
        // A meanwhile-completed flow may already have written auth.json; pick it
        // up with a read-only re-detect (does not block on the codex child).
        await refreshDetect();
        break;
      case 'cli_missing':
      case 'failed':
        modeStore.loginMessage = outcome.message;
        modeStore.loginOutcomeKind = 'attention';
        break;
    }
    // Repair #2: a DEFAULT (browser-callback) attempt that did not reach `authed`
    // marks the device-code fallback as the recommended next step — this is the
    // browser-cannot-open / firewalled case device-auth exists for. A device-auth
    // attempt itself does not (re)arm this flag.
    if (!deviceAuth) {
      modeStore.defaultLoginUnfinished = outcome.state !== 'authed';
    }
    return outcome;
  } finally {
    modeStore.loggingIn = false;
  }
}

/** Select a provider (the toggle). Selecting an unavailable provider is allowed
 *  in the store; the effective resolver guards actual use. */
export function selectProvider(id: ProviderId): void {
  modeStore.selected = id;
}

/**
 * The provider that will ACTUALLY run, given availability. Collapses an
 * unavailable selection back to `offline` so the app always has a working path
 * (AC-GRACEFUL): if the user chose auto but codex is gone, the effective mode is
 * copy-paste.
 */
export function effectiveProviderId(): ProviderId {
  if (modeStore.selected === 'offline') return 'offline';
  const avail = modeStore.availabilities.find((a) => a.id === modeStore.selected);
  return avail?.available ? modeStore.selected : 'offline';
}

/** True iff the effective mode is the auto-LLM provider. */
export function autoModeActive(): boolean {
  return effectiveProviderId() === 'codex_oauth_proxy';
}
