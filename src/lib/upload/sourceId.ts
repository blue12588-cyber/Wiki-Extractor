/**
 * source_id derivation — SHA-256 hex prefix.
 *
 * Authority: agreed_contract.json#AC-UPLOAD.
 *
 * The id is deterministic and content-derived: identical bytes → identical id.
 * Slice-2 prefix length is fixed at 16 hex chars (64 bits of collision
 * resistance — plenty for a single-user desktop binary).
 */

const PREFIX_LEN = 16;

export async function computeSourceId(buffer: Uint8Array): Promise<string> {
  // Copy into a fresh, exactly-sized ArrayBuffer-backed view. This both
  // narrows the type away from `ArrayBuffer | SharedArrayBuffer` (newer DOM
  // lib) and guarantees we hash exactly byteLength bytes from byteOffset.
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, PREFIX_LEN);
}
