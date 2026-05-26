export type BibliographicConfidence = 'heuristic' | 'filename_fallback';

export interface BibliographicMetadata {
  display_title: string;
  title: string | null;
  author: string | null;
  translator: string | null;
  publisher: string | null;
  year: string | null;
  confidence: BibliographicConfidence;
}

type InferInput = {
  filename: string;
  normalizedText: string;
};

const SAMPLE_CHARS = 16_000;
const MAX_LINES = 90;
const MAX_FIELD_CHARS = 120;
const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

function compact(value: string): string {
  return value
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampField(value: string, max = MAX_FIELD_CHARS): string {
  const clean = compact(value).replace(/^[,.:;|\-–—\s]+|[,.:;|\-–—\s]+$/g, '');
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function filenameTitle(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return clampField(base.replace(/[_\-]+/g, ' ').replace(/\s*\(\d+\)\s*$/g, ''), 140) || filename;
}

function linesFromText(text: string): string[] {
  return text
    .replace(/\f/g, '\n')
    .slice(0, SAMPLE_CHARS)
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

function isLikelyNoise(line: string): boolean {
  const lower = line.toLowerCase();
  if (/^\d{1,4}$/.test(line)) return true;
  if (/^[-–—_*=\s]+$/.test(line)) return true;
  if (/\bisbn\b|copyright|all rights reserved|printed in|published by|table of contents|contents\b/.test(lower)) {
    return true;
  }
  if (/^(목\s*차|차례|참고문헌|색인|bibliography|references|index)$/i.test(line)) return true;
  if (/^(chapter|part|section)\s+\d+/i.test(line)) return true;
  if (/^page\s+\d+/i.test(line)) return true;
  return false;
}

function isTitleCandidate(line: string): boolean {
  const clean = compact(line);
  if (clean.length < 6 || clean.length > 150) return false;
  if (isLikelyNoise(clean)) return false;
  if (/^(by|edited by|translated by)\b/i.test(clean)) return false;
  if (/^(저자|지은이|글|옮긴이|역자|번역|출판사?)\s*[:：]/.test(clean)) return false;
  const digits = clean.match(/\d/g)?.length ?? 0;
  if (digits > clean.length * 0.35) return false;
  return true;
}

function captureAfterLabel(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return clampField(match[1]);
  }
  return null;
}

function inferAuthor(lines: string[]): string | null {
  const ko = captureAfterLabel(lines, /(?:저자|지은이|글)\s*[:：]\s*(.+)$/);
  if (ko) return ko;

  for (const line of lines) {
    const match = line.match(/\bby\s+(.+)$/i);
    if (!match?.[1]) continue;
    const raw = match[1].replace(/\btranslated by\b.+$/i, '').replace(/\bedited by\b.+$/i, '');
    const clean = clampField(raw);
    if (clean && clean.length <= MAX_FIELD_CHARS && !isLikelyNoise(clean)) return clean;
  }
  return null;
}

function inferTranslator(lines: string[]): string | null {
  const ko = captureAfterLabel(lines, /(?:옮긴이|역자|번역)\s*[:：]\s*(.+)$/);
  if (ko) return ko;

  for (const line of lines) {
    const match = line.match(/\btranslated by\s+(.+)$/i);
    if (match?.[1]) return clampField(match[1]);
  }
  return null;
}

function inferPublisher(lines: string[]): string | null {
  const ko = captureAfterLabel(lines, /(?:출판사|출판|펴낸곳)\s*[:：]\s*(.+)$/);
  if (ko) return ko;

  for (const line of lines) {
    if (isLikelyNoise(line)) continue;
    if (/\b(press|publishing|publisher|books|verlag|academic|university)\b/i.test(line)) {
      return clampField(line);
    }
    if (/(출판|출판부|출판사|대학교출판)/.test(line)) return clampField(line);
  }
  return null;
}

function inferYear(lines: string[], filename: string): string | null {
  for (const line of lines) {
    const match = line.match(YEAR_RE);
    if (match?.[1]) return match[1];
  }
  return filename.match(YEAR_RE)?.[1] ?? null;
}

function titleFromByLine(lines: string[]): string | null {
  const byIndex = lines.findIndex((line) => /\bby\s+.+/i.test(line));
  if (byIndex < 0) return null;

  const sameLine = lines[byIndex].replace(/\bby\s+.+$/i, '').trim();
  if (isTitleCandidate(sameLine)) return clampField(sameLine, 150);

  for (let i = byIndex - 1; i >= Math.max(0, byIndex - 5); i--) {
    if (isTitleCandidate(lines[i])) return clampField(lines[i], 150);
  }
  return null;
}

function inferTitle(lines: string[], filename: string): { title: string; confidence: BibliographicConfidence } {
  const byTitle = titleFromByLine(lines);
  if (byTitle) return { title: byTitle, confidence: 'heuristic' };

  const candidate = lines.slice(0, 40).find(isTitleCandidate);
  if (candidate) return { title: clampField(candidate, 150), confidence: 'heuristic' };

  return { title: filenameTitle(filename), confidence: 'filename_fallback' };
}

function displayTitle(metadata: Omit<BibliographicMetadata, 'display_title'>): string {
  const base = metadata.title || '제목 미상';
  const parts: string[] = [];
  if (metadata.author) parts.push(metadata.author);
  if (metadata.translator) parts.push(`역자 ${metadata.translator}`);
  if (metadata.publisher) parts.push(metadata.publisher);
  if (metadata.year) parts.push(metadata.year);
  if (parts.length === 0) return base;
  return clampField(`${base} — ${parts.join(' · ')}`, 220);
}

export function inferBibliographicMetadata(input: InferInput): BibliographicMetadata {
  const lines = linesFromText(input.normalizedText);
  const titleResult = inferTitle(lines, input.filename);
  const metadata = {
    title: titleResult.title,
    author: inferAuthor(lines),
    translator: inferTranslator(lines),
    publisher: inferPublisher(lines),
    year: inferYear(lines, input.filename),
    confidence: titleResult.confidence,
  };
  return {
    ...metadata,
    display_title: displayTitle(metadata),
  };
}
