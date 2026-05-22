/**
 * Magic-bytes signature verification.
 *
 * Authority: agreed_contract.json#AC-UPLOAD.
 *
 * Three-way detection: PDF / Markdown / plaintext.
 *
 *   - PDF: must start with the literal bytes "%PDF-" (per the PDF spec; the
 *     first 5 bytes; trailing chars are version markers).
 *   - Markdown: declared `.md` / `.markdown` files must be UTF-8 decodable
 *     AND must NOT carry a PDF magic / a PE/MZ (Windows executable) magic /
 *     a ZIP (PK\x03\x04) magic.
 *   - Plaintext: declared `.txt` / no-extension files must be UTF-8 decodable
 *     AND must NOT carry any other recognized binary magic.
 *
 * A mismatch is the only signal: e.g. a file declared `.pdf` whose first 5
 * bytes are not `%PDF-` is rejected with `signature_mismatch`.
 */

export type DetectedType = 'pdf' | 'markdown' | 'plaintext';

export interface MagicBytesResult {
  ok: boolean;
  detectedType: DetectedType | null;
  reason?: string;
}

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const MZ_MAGIC = new Uint8Array([0x4d, 0x5a]); // PE/MZ
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP / docx / pptx
const ELF_MAGIC = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF

function startsWith(buf: Uint8Array, needle: Uint8Array): boolean {
  if (buf.length < needle.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (buf[i] !== needle[i]) return false;
  }
  return true;
}

function isUtf8Decodable(buf: Uint8Array): boolean {
  try {
    const dec = new TextDecoder('utf-8', { fatal: true });
    dec.decode(buf);
    return true;
  } catch {
    return false;
  }
}

function inferDeclaredType(filename: string): DetectedType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'plaintext';
}

/**
 * Verify the file's magic bytes against its declared extension.
 *
 * `head` is the file's first N bytes (≥ 64 recommended). The function returns
 * `ok=true` with the detected type when the declared extension matches the
 * signature; `ok=false` with a `reason` string when there is a mismatch.
 */
export function verifyMagicBytes(filename: string, head: Uint8Array): MagicBytesResult {
  const declared = inferDeclaredType(filename);

  if (declared === 'pdf') {
    if (startsWith(head, PDF_MAGIC)) {
      return { ok: true, detectedType: 'pdf' };
    }
    return {
      ok: false,
      detectedType: null,
      reason: 'declared .pdf but signature is not %PDF-',
    };
  }

  // For text-like declared types: reject if any recognized binary signature.
  if (startsWith(head, PDF_MAGIC)) {
    return {
      ok: false,
      detectedType: 'pdf',
      reason: `declared .${declared === 'markdown' ? 'md' : 'txt'} but signature is %PDF-`,
    };
  }
  if (startsWith(head, MZ_MAGIC)) {
    return { ok: false, detectedType: null, reason: 'Windows PE/MZ executable signature detected' };
  }
  if (startsWith(head, ELF_MAGIC)) {
    return { ok: false, detectedType: null, reason: 'ELF executable signature detected' };
  }
  if (startsWith(head, ZIP_MAGIC)) {
    return { ok: false, detectedType: null, reason: 'ZIP container signature detected' };
  }

  // Must be UTF-8 decodable.
  if (!isUtf8Decodable(head)) {
    return {
      ok: false,
      detectedType: null,
      reason: 'declared text-like file but bytes are not valid UTF-8',
    };
  }

  return { ok: true, detectedType: declared };
}
