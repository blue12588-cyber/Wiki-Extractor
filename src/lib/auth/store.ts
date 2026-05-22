/**
 * Auth store — derives the 5-state UI value from the three Tauri-fed inputs.
 *
 * Authority: agreed_contract.json#design_criteria (AuthStateIndicator five
 * states) + AC-OAUTH-CODEX + AC-OAUTH-DEVFALLBACK.
 *
 * The store polls (rather than subscribes to Tauri events) for Slice 2 — a
 * 2-second interval is sufficient for the desktop UI, and avoids the extra
 * complexity of registering Rust→JS event channels for what is fundamentally
 * a read-only snapshot.
 *
 * In SvelteKit prerender / Vite preview (no Tauri), the polls fall back to
 * `false` / `idle` and `deriveAuthState` produces `unconfigured`, which is
 * the safe default for the non-Tauri context.
 */

import { readable, type Readable } from 'svelte/store';
import { deriveAuthState, type AuthState, type OAuthChildStatus } from './state';
import { fetchAuthFilePresent, fetchDevFallbackStatus } from './devFallback';

interface OAuthChildSnapshot {
  state: 'idle' | 'spawning' | 'ready' | 'degraded';
  port?: number;
  url?: string;
  reason?: string;
}

function resolveInvoke(): (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
  };
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

async function fetchOAuthChildStatus(): Promise<OAuthChildStatus> {
  const invoke = resolveInvoke();
  if (!invoke) return 'idle';
  try {
    const snap = await invoke<OAuthChildSnapshot>('oauth_child_status');
    return snap.state;
  } catch {
    return 'idle';
  }
}

const POLL_MS = 2000;

export const authState: Readable<AuthState> = readable<AuthState>('unconfigured', (set) => {
  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const [codexAuthPresent, devFallbackFlag, oauthChildStatus] = await Promise.all([
      fetchAuthFilePresent(),
      fetchDevFallbackStatus(),
      fetchOAuthChildStatus(),
    ]);
    if (cancelled) return;
    set(deriveAuthState({ codexAuthPresent, devFallbackFlag, oauthChildStatus }));
  }
  tick();
  const id = setInterval(tick, POLL_MS);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
});

export async function snapshotAuthState(): Promise<AuthState> {
  const [codexAuthPresent, devFallbackFlag, oauthChildStatus] = await Promise.all([
    fetchAuthFilePresent(),
    fetchDevFallbackStatus(),
    fetchOAuthChildStatus(),
  ]);
  return deriveAuthState({ codexAuthPresent, devFallbackFlag, oauthChildStatus });
}
