import { isKanji, toHiragana, toKatakana } from 'wanakana';

import type { RubySegment } from './types';

export interface SourceToken {
  byteEnd: number;
  byteStart: number;
  reading: string;
  text: string;
}

export interface RubyTokenization {
  cost: number;
  tokens: SourceToken[];
}

interface RubyToken {
  end: number;
  original: string;
  ownerEnd: number;
  ownerStart: number;
  reading: string;
  start: number;
}

interface RubyCandidateOptions {
  costThreshold: number;
  maxReadings: number;
}

interface TextRange {
  end: number;
  start: number;
}

type SimplifiedToken = RubyToken;

interface KanaChunk {
  end: number;
  original: string;
  start: number;
}

export function buildRubySegments(
  tokens: SourceToken[],
  text: string,
): RubySegment[] {
  return buildSegments(toKanjiTokens(tokens, text), text);
}

export function buildRubySegmentsWithCandidates(
  tokenizations: RubyTokenization[],
  text: string,
  options: RubyCandidateOptions,
): RubySegment[] {
  const best = tokenizations[0];
  if (!best) return [{ text }];

  const bestTokens = toKanjiTokens(best.tokens, text);
  const readings = bestTokens.map((token) => [toHiragana(token.reading)]);
  const maxReadings = Math.max(1, options.maxReadings);

  for (const tokenization of tokenizations.slice(1)) {
    if (tokenization.cost - best.cost > options.costThreshold) break;

    const candidateTokens = toKanjiTokens(tokenization.tokens, text);
    if (!hasSameRubyTokenShape(bestTokens, candidateTokens)) continue;

    const differences: number[] = [];
    for (let index = 0; index < bestTokens.length; index += 1) {
      if (bestTokens[index]!.reading !== candidateTokens[index]!.reading) {
        differences.push(index);
      }
    }
    if (differences.length !== 1) continue;

    const index = differences[0]!;
    const reading = toHiragana(candidateTokens[index]!.reading);
    if (
      readings[index]!.length < maxReadings &&
      !readings[index]!.includes(reading)
    ) {
      readings[index]!.push(reading);
    }
  }

  return buildSegments(
    bestTokens.map((token, index) => ({
      ...token,
      reading: readings[index]!.join('/'),
    })),
    text,
    false,
  );
}

function buildSegments(
  tokens: RubyToken[],
  text: string,
  convertReading = true,
): RubySegment[] {
  const rubyTokens = tokens
    .filter(
      (token) =>
        token.start >= 0 && token.end <= text.length && token.start < token.end,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const segments: RubySegment[] = [];
  let cursor = 0;
  for (const token of rubyTokens) {
    if (token.start < cursor) continue;
    if (token.start > cursor) {
      segments.push({ text: text.slice(cursor, token.start) });
    }
    segments.push({
      text: token.original,
      reading: convertReading ? toHiragana(token.reading) : token.reading,
    });
    cursor = token.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  return segments.length > 0 ? segments : [{ text }];
}

function hasSameRubyTokenShape(
  bestTokens: RubyToken[],
  candidateTokens: RubyToken[],
): boolean {
  return (
    bestTokens.length === candidateTokens.length &&
    bestTokens.every((best, index) => {
      const candidate = candidateTokens[index]!;
      return (
        best.start === candidate.start &&
        best.end === candidate.end &&
        best.ownerStart === candidate.ownerStart &&
        best.ownerEnd === candidate.ownerEnd &&
        best.original === candidate.original
      );
    })
  );
}

function toKanjiTokens(tokens: SourceToken[], text: string): RubyToken[] {
  const uncertainRanges = findUncertainKanjiRanges(tokens, text);

  return tokens
    .filter(
      (token) =>
        /\p{Script=Han}/u.test(token.text) &&
        Boolean(token.reading && token.reading !== '*'),
    )
    .map<SimplifiedToken>((token) => ({
      start: byteToUtf16(token.byteStart, text),
      end: byteToUtf16(token.byteEnd, text),
      ownerStart: byteToUtf16(token.byteStart, text),
      ownerEnd: byteToUtf16(token.byteEnd, text),
      original: token.text,
      reading: token.reading,
    }))
    .filter(
      (token) =>
        !uncertainRanges.some(
          (range) => token.start < range.end && token.end > range.start,
        ),
    )
    .flatMap(splitMixedToken);
}

function findUncertainKanjiRanges(
  tokens: SourceToken[],
  text: string,
): TextRange[] {
  const unknownRanges = tokens
    .filter(
      (token) =>
        /\p{Script=Han}/u.test(token.text) &&
        (!token.reading || token.reading === '*'),
    )
    .map<TextRange>((token) => ({
      start: byteToUtf16(token.byteStart, text),
      end: byteToUtf16(token.byteEnd, text),
    }));
  if (unknownRanges.length === 0) return [];

  return Array.from(
    text.matchAll(/[\p{Script=Han}々〆ヵヶ]+/gu),
    (match): TextRange => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  ).filter((range) =>
    unknownRanges.some(
      (unknown) => unknown.start < range.end && unknown.end > range.start,
    ),
  );
}

export function byteToUtf16(byteIndex: number, text: string): number {
  const encoder = new TextEncoder();
  let bytes = 0;
  let utf16Index = 0;
  for (const character of text) {
    bytes += encoder.encode(character).length;
    if (bytes > byteIndex) return utf16Index;
    utf16Index += character.length;
  }
  return utf16Index;
}

function splitMixedToken(token: SimplifiedToken): RubyToken[] {
  if (isKanji(token.original)) return [token];

  const kanaChunks = Array.from(
    token.original.matchAll(/[\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu),
    (match): KanaChunk => ({
      original: toKatakana(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  if (kanaChunks.length === 0) return [token];

  const readingPattern = buildReadingPattern(kanaChunks, token.original.length);
  const readingParts = token.reading.match(readingPattern)?.slice(1);
  const kanjiMatches = Array.from(token.original.matchAll(/\p{Script=Han}+/gu));
  if (!readingParts || readingParts.length !== kanjiMatches.length) {
    return [token];
  }

  return kanjiMatches.map((match, index) => ({
    original: match[0],
    ownerStart: token.ownerStart,
    ownerEnd: token.ownerEnd,
    reading: readingParts[index]!,
    start: token.start + match.index,
    end: token.start + match.index + match[0].length,
  }));
}

function buildReadingPattern(
  kanaChunks: KanaChunk[],
  originalLength: number,
): RegExp {
  const first = kanaChunks[0]!;
  const last = kanaChunks[kanaChunks.length - 1]!;
  let pattern = '^';

  if (first.start > 0) pattern += '(.+)';
  for (const chunk of kanaChunks) {
    pattern += chunk.original;
    if (chunk !== last) pattern += '(.+)';
  }
  if (last.end !== originalLength) pattern += '(.+)';

  return new RegExp(`${pattern}$`, 'u');
}
