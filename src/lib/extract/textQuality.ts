/**
 * Text extraction quality checks.
 *
 * This does not OCR or alter the extracted text. It only reports whether a PDF
 * appears to have too little machine-readable text, so the user can OCR it
 * externally and re-import a better PDF/txt source.
 */

export type TextQualityLevel = 'ok' | 'warn' | 'bad';

export interface TextQualityReport {
  kind: 'pdf_text_quality';
  level: TextQualityLevel;
  page_count: number;
  extractable_pages: number;
  low_text_pages: number;
  blank_pages: number;
  total_chars: number;
  avg_chars_per_page: number;
  suspicious_chars: number;
  suspicious_ratio: number;
  page_char_counts: number[];
  summary_ko: string;
  suggestion_ko: string;
}

const BLANK_PAGE_CHARS = 10;
const LOW_PAGE_CHARS = 80;
const GOOD_PAGE_CHARS = 180;

function countMeaningfulChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

function countSuspiciousChars(text: string): number {
  return (text.match(/[\u0000-\u0008\u000B\u000E-\u001F\uFFFD\u25A1\u25A0\u25AF]/g) ?? []).length;
}

function ratio(num: number, den: number): number {
  return den <= 0 ? 0 : num / den;
}

export function analyzePdfTextQuality(pages: string[]): TextQualityReport {
  const page_char_counts = pages.map(countMeaningfulChars);
  const page_count = pages.length;
  const total_chars = page_char_counts.reduce((sum, n) => sum + n, 0);
  const avg_chars_per_page = page_count === 0 ? 0 : Math.round(total_chars / page_count);
  const blank_pages = page_char_counts.filter((n) => n < BLANK_PAGE_CHARS).length;
  const low_text_pages = page_char_counts.filter((n) => n < LOW_PAGE_CHARS).length;
  const extractable_pages = page_char_counts.filter((n) => n >= LOW_PAGE_CHARS).length;
  const allText = pages.join('\n');
  const suspicious_chars = countSuspiciousChars(allText);
  const suspicious_ratio = ratio(suspicious_chars, Math.max(allText.length, 1));
  const extractable_ratio = ratio(extractable_pages, page_count);
  const low_ratio = ratio(low_text_pages, page_count);

  let level: TextQualityLevel = 'ok';
  if (
    page_count === 0 ||
    total_chars === 0 ||
    extractable_ratio < 0.35 ||
    avg_chars_per_page < LOW_PAGE_CHARS ||
    suspicious_ratio >= 0.08
  ) {
    level = 'bad';
  } else if (
    extractable_ratio < 0.7 ||
    low_ratio > 0.25 ||
    avg_chars_per_page < GOOD_PAGE_CHARS ||
    suspicious_ratio >= 0.03
  ) {
    level = 'warn';
  }

  const percent = Math.round(extractable_ratio * 100);
  const summary_ko =
    level === 'ok'
      ? `PDF 텍스트 추출 상태가 괜찮습니다. ${page_count}쪽 중 ${extractable_pages}쪽에서 충분한 텍스트를 읽었습니다.`
      : level === 'bad'
        ? `PDF에서 읽을 수 있는 텍스트가 매우 적습니다. ${page_count}쪽 중 ${extractable_pages}쪽만 충분한 텍스트가 있고, 평균 ${avg_chars_per_page}자/쪽입니다.`
        : `PDF 텍스트 추출 품질이 낮을 수 있습니다. ${page_count}쪽 중 ${extractable_pages}쪽(${percent}%)에서 충분한 텍스트를 읽었습니다.`;

  const suggestion_ko =
    level === 'ok'
      ? '그대로 추출을 진행해도 됩니다.'
      : '스캔본이거나 OCR이 약한 PDF일 수 있습니다. 외부 OCR 도구로 텍스트 인식한 PDF 또는 txt/md 파일을 만든 뒤 다시 넣는 편이 안전합니다.';

  return {
    kind: 'pdf_text_quality',
    level,
    page_count,
    extractable_pages,
    low_text_pages,
    blank_pages,
    total_chars,
    avg_chars_per_page,
    suspicious_chars,
    suspicious_ratio,
    page_char_counts,
    summary_ko,
    suggestion_ko,
  };
}
