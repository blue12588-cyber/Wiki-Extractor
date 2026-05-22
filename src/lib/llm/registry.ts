/**
 * Provider registry — Slice 5c (AC-AUTH-ABSTRACT + AC-ENCAPSULATE).
 *
 * Authority: agreed_contract.json#AC-AUTH-ABSTRACT + AC-ENCAPSULATE.
 *
 * Maps a `ProviderId` to its `ExtractionProvider` instance. The `future`
 * placeholder has no instance (selecting it always degrades to offline via the
 * mode store's effective resolver), so it is intentionally absent here. Adding a
 * real API-key provider later is a single entry here + a new module — no caller
 * changes (contract: contract_refresh_required_when API key mode implemented).
 */

import type { ExtractionProvider, ProviderId } from './provider';
import { offlineProvider } from './offlineProvider';
import { codexProvider } from './codexProvider';

const REGISTRY: Partial<Record<ProviderId, ExtractionProvider>> = {
  offline: offlineProvider,
  codex_oauth_proxy: codexProvider,
};

/** Resolve a provider instance. Unknown / placeholder ids fall back to offline
 *  (the always-available common-person path). */
export function providerFor(id: ProviderId): ExtractionProvider {
  return REGISTRY[id] ?? offlineProvider;
}
