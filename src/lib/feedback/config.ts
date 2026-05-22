/**
 * Feedback endpoint — single source of truth (AC-FEEDBACK-CONFIG).
 *
 * Authority: agreed_contract.json (Slice 4)#AC-FEEDBACK-CONFIG +
 *            AC-FEEDBACK-SUBMIT.
 *
 * Swapping the destination is a ONE-LINE change: edit `FEEDBACK_ENDPOINT`
 * below. No other module hard-codes the URL — submit.ts and every view import
 * this constant. The endpoint is a Formspree form action which accepts a JSON
 * body and returns `{ ok: true }` on success when `Accept: application/json`
 * is sent (so the user is never redirected to Formspree's own thank-you page).
 *
 * Network note: this is the ONLY non-OpenAI outbound host the renderer talks
 * to. CSP is null (tauri.conf.json#app.security.csp), so the renderer issues
 * the POST directly via `fetch` — no Tauri command round-trip is needed.
 */

/** The one line to change when the feedback destination moves. */
export const FEEDBACK_ENDPOINT = 'https://formspree.io/f/xjgzryoe';

/** Request shape the submitter sends (Formspree accepts arbitrary JSON keys). */
export interface FeedbackConfig {
  endpoint: string;
  /** Header that makes Formspree answer with JSON instead of an HTML redirect. */
  accept: 'application/json';
}

export function feedbackConfig(): FeedbackConfig {
  return {
    endpoint: FEEDBACK_ENDPOINT,
    accept: 'application/json',
  };
}
