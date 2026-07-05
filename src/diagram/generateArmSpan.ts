import type { SourceRange } from '../ir/types';

// UHDM gives a generate arm only its expression range (condition / case value) and a
// point inside its body; the named begin..end scope carries no location. This module
// recovers the arm's full "expression + body" span from the source text: find the
// arm's `begin` just before the body anchor, depth-match to its `end`, and extend the
// start back over the arm header (`if (...)`, `else`, `default:`).

interface Token {
  word: string;
  start: number;
  end: number;
}

const OPENERS = new Set(['begin', 'case', 'casez', 'casex', 'fork']);
const CLOSERS = new Set(['end', 'endcase', 'join', 'join_any', 'join_none']);

const TOKEN_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|\b(begin|endcase|end|casez|casex|case|fork|join_any|join_none|join|else|if|default)\b/g;

export function generateArmSpan(
  text: string,
  kind: string,
  source: SourceRange,
  bodySource: SourceRange
): { start: number; end: number } | undefined {
  const lineStarts = computeLineStarts(text);
  const toOffset = (line?: number, column?: number): number => {
    const lineIndex = Math.max(0, (line || 1) - 1);
    if (lineIndex >= lineStarts.length) return text.length;
    return Math.min(text.length, lineStarts[lineIndex] + (column ?? 0));
  };

  const anchor = toOffset(bodySource.startLine, bodySource.startColumn);
  const tokens = scanTokens(text);

  let beginIndex = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].start > anchor) break;
    if (tokens[i].word === 'begin') beginIndex = i;
  }
  if (beginIndex < 0) return undefined;

  let depth = 0;
  let endToken: Token | undefined;
  for (let i = beginIndex; i < tokens.length; i += 1) {
    const word = tokens[i].word;
    if (OPENERS.has(word)) {
      depth += 1;
    } else if (CLOSERS.has(word)) {
      depth -= 1;
      if (depth === 0) {
        endToken = tokens[i];
        break;
      }
    }
  }
  // A matched end before the anchor means the nearest begin belonged to an earlier
  // block (e.g. a bodyless arm) — bail out rather than highlight the wrong block.
  if (!endToken || endToken.end < anchor) return undefined;

  let end = endToken.end;
  const closeLabel = /^[ \t]*:[ \t]*[A-Za-z_][\w$]*/.exec(text.slice(end));
  if (closeLabel) end += closeLabel[0].length;

  const beginStart = tokens[beginIndex].start;
  const headerTokens = tokens.slice(0, beginIndex);
  let start = beginStart;

  if (kind === 'else') {
    const elseToken = findLast(headerTokens, (token) => token.word === 'else');
    if (elseToken) start = elseToken.start;
  } else if (kind === 'case-default') {
    const defaultToken = findLast(headerTokens, (token) => token.word === 'default');
    if (defaultToken && /^\s*:\s*$/.test(text.slice(defaultToken.end, beginStart))) {
      start = defaultToken.start;
    }
  } else {
    const expressionStart = Math.min(toOffset(source.startLine, source.startColumn), beginStart);
    start = expressionStart;
    if (kind === 'if' || kind === 'else-if') {
      const ifToken = findLast(headerTokens, (token) => token.word === 'if' && token.end <= expressionStart);
      if (ifToken && /^\s*\(\s*$/.test(text.slice(ifToken.end, expressionStart))) {
        start = ifToken.start;
        const elseToken = findLast(headerTokens, (token) => token.word === 'else' && token.end <= ifToken.start);
        if (elseToken && /^\s*$/.test(text.slice(elseToken.end, ifToken.start))) {
          start = elseToken.start;
        }
      }
    }
  }

  return { start, end };
}

function scanTokens(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match[1]) {
      tokens.push({ word: match[1], start: match.index, end: match.index + match[1].length });
    }
  }
  return tokens;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return items[i];
  }
  return undefined;
}
