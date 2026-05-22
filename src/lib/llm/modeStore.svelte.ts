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
  type CodexDetectSnapshot,
  type ProviderAvailability,
  type ProviderId,
} from './provider';

const INITIAL_DETECT: CodexDetectSnapshot = {
  available: false,
  auth_file_present: false,
  login_probe: 'missing',
  codex_cli_missing: true,
};

interface ModeState {
  detect: CodexDetectSnapshot;
  availabilities: ProviderAvailability[];
  /** What the user picked. Default offline (common-person). */
  selected: ProviderId;
  /** True while a detect refresh is in flight. */
  refreshing: boolean;
}

export const modeStore = $state<ModeState>({
  detect: INITIAL_DETECT,
  availabilities: providerAvailabilities(INITIAL_DETECT),
  selected: 'offline',
  refreshing: false,
});

/** Re-run codex detection (read-only) and refresh the availability list. */
export async function refreshDetect(): Promise<void> {
  modeStore.refreshing = true;
  try {
    const detect = await detectCodex();
    modeStore.detect = detect;
    modeStore.availabilities = providerAvailabilities(detect);
    // If the user had auto selected but it is no longer available, do NOT force
    // them off it in the store (so the toggle still shows their intent), but
    // `effectiveProviderId()` will collapse to offline at use time.
  } finally {
    modeStore.refreshing = false;
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
