/**
 * Sidebar tab contract (AC-NAV).
 *
 * Authority: agreed_contract.json (Slice 4)#AC-NAV.
 *
 * Four tabs, Korean labels, in fixed order. Each tab carries a `shape` cue so
 * the ACTIVE tab is distinguishable without relying on colour alone
 * (color-blind accessibility): the active tab gets a filled left-rail marker +
 * `aria-current="page"`, and each tab renders a distinct geometric glyph. The
 * shape + aria-current pair is the non-colour signal; the accent colour is the
 * third, redundant signal.
 *
 * This is a plain data module (no Svelte) so the T1-nav-tabs-contract scenario
 * can assert the tab set without rendering.
 */

export type TabId = 'main' | 'wiki' | 'login' | 'feedback';

export interface TabDef {
  id: TabId;
  /** Korean label shown in the sidebar (AC-KOREAN-UI). */
  label: string;
  /** Short Korean description used for the title/tooltip. */
  hint: string;
  /**
   * Geometric shape key (color-blind cue). Rendered as a small SVG glyph next
   * to the label; distinct per tab so shape alone disambiguates.
   */
  shape: 'square' | 'circle' | 'key' | 'chat';
}

export const TABS: ReadonlyArray<TabDef> = [
  { id: 'main', label: '메인', hint: '원문 업로드 · 목차 · 추출', shape: 'square' },
  { id: 'wiki', label: '위키', hint: '위키 표시 · 편집', shape: 'circle' },
  { id: 'login', label: '로그인', hint: '인증 상태 · 보안 고지', shape: 'key' },
  { id: 'feedback', label: '피드백', hint: '의견 보내기 (로그인 불필요)', shape: 'chat' },
];

export const DEFAULT_TAB: TabId = 'main';

export function isTabId(value: string): value is TabId {
  return TABS.some((t) => t.id === value);
}
