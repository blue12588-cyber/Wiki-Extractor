/**
 * Outline parser — paste-text → node tree.
 *
 * Authority: agreed_contract.json#AC-OUTLINE.
 *
 * Accepts a pasted table-of-contents and produces a deterministic node tree.
 * Pure (no I/O, no LLM). Recognized line shapes (checked in order):
 *
 *   1. Numbered:        "1.", "1.1", "1.2.3", "제1장", "1)" — level = dotted depth
 *   2. Markdown heading: "# ", "## " — level = hash count
 *   3. Bullet / indent:  "- ", "* ", or leading-whitespace indent — level by indent
 *
 * Blank lines are skipped. Each node carries a stable id derived from its
 * 1-based document order, so the same paste always yields the same ids
 * (deterministic mapping target for AC-CLASSIFY-MAP).
 */

export interface OutlineNode {
  /** Stable id: `n<order>` (1-based document order over non-blank lines). */
  id: string;
  /** Display title (markers stripped). */
  title: string;
  /** Original numbering label if present (e.g. "1.2", "제1장"); else null. */
  label: string | null;
  /** 1-based nesting level. */
  level: number;
  /** Child node ids in document order. */
  children: string[];
  /** Parent node id, or null for top-level. */
  parent: string | null;
}

export interface ParsedOutline {
  nodes: OutlineNode[];
  /** Top-level node ids in document order. */
  roots: string[];
}

const NUMBERED_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(.*)$/;
const KO_CHAPTER_RE = /^\s*(제\s*\d+\s*[장절항])\s*[.)]?\s*(.*)$/;
const MD_HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)([-*•])\s+(.*)$/;

interface Parsed {
  title: string;
  label: string | null;
  level: number;
}

function parseLine(line: string): Parsed | null {
  if (line.trim().length === 0) return null;

  const md = line.match(MD_HEADING_RE);
  if (md) {
    return { title: md[2].trim(), label: null, level: md[1].length };
  }

  const ko = line.match(KO_CHAPTER_RE);
  if (ko) {
    const label = ko[1].replace(/\s+/g, '');
    return { title: ko[2].trim() || label, label, level: 1 };
  }

  const num = line.match(NUMBERED_RE);
  if (num) {
    const label = num[1];
    const level = label.split('.').length; // "1" -> 1, "1.2" -> 2
    return { title: num[2].trim(), label, level };
  }

  const bullet = line.match(BULLET_RE);
  if (bullet) {
    // indent width (spaces) → level; every 2 spaces = one level, min level 1
    const indent = bullet[1].replace(/\t/g, '  ').length;
    const level = Math.floor(indent / 2) + 1;
    return { title: bullet[3].trim(), label: null, level };
  }

  // Plain indented line (no marker): level by leading whitespace.
  const leading = line.length - line.trimStart().length;
  const level = Math.floor(leading / 2) + 1;
  return { title: line.trim(), label: null, level };
}

export function parseOutline(text: string): ParsedOutline {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: OutlineNode[] = [];
  const roots: string[] = [];
  // Stack of (level, id) for parent resolution.
  const stack: { level: number; id: string }[] = [];
  let order = 0;

  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    order += 1;
    const id = `n${order}`;

    // Pop deeper-or-equal levels to find the parent.
    while (stack.length && stack[stack.length - 1].level >= parsed.level) {
      stack.pop();
    }
    const parent = stack.length ? stack[stack.length - 1].id : null;

    const node: OutlineNode = {
      id,
      title: parsed.title,
      label: parsed.label,
      level: parsed.level,
      children: [],
      parent,
    };
    nodes.push(node);
    if (parent === null) {
      roots.push(id);
    } else {
      const p = nodes.find((n) => n.id === parent);
      if (p) p.children.push(id);
    }
    stack.push({ level: parsed.level, id });
  }

  return { nodes, roots };
}

/** Compact projection for the LLM classify prompt: id + title + level only. */
export function outlineForLlm(outline: ParsedOutline): Array<{ id: string; title: string; level: number }> {
  return outline.nodes.map((n) => ({ id: n.id, title: n.title, level: n.level }));
}
