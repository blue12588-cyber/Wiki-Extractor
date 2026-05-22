/**
 * Offline (copy-paste) provider — Slice 5c (AC-AUTH-ABSTRACT + AC-GRACEFUL).
 *
 * Authority: agreed_contract.json#AC-AUTH-ABSTRACT + AC-GRACEFUL +
 *            AC-OFFLINE-CORE (5b).
 *
 * The DEFAULT provider and the common-person path. It performs NO network call
 * and is ALWAYS available. The "extraction" for this provider is the user's
 * manual round trip in the BridgePanel (copy prompt → chatgpt.com → paste
 * reply). `runExtraction` therefore returns a `degraded:false` result whose
 * message tells the caller to use the manual copy-paste UI — it does NOT (and
 * MUST NOT) call the LLM.
 *
 * This module imports ZERO network/LLM symbols (mirrors the 5b bridge
 * offline-no-network invariant): the T1 static scenario asserts that statically.
 */

import type { ExtractionProvider, ExtractionResult } from './provider';

export const offlineProvider: ExtractionProvider = {
  id: 'offline',
  label: '복붙 모드 (기본 · 누구나)',
  mode: 'manual',
  async runExtraction(_prompt: string): Promise<ExtractionResult> {
    // Manual path: the app never calls the LLM in offline mode. The caller
    // shows the copy-paste bridge. `degraded:false` because this is the NORMAL
    // offline flow, not a failure.
    return {
      ok: false,
      degraded: false,
      message:
        '복붙 모드입니다. 아래 프롬프트를 복사해 ChatGPT에 붙여넣고, 돌려받은 JSON을 다시 붙여넣어 검증하세요(앱은 ChatGPT를 직접 호출하지 않습니다).',
    };
  },
};
