import { describe, expect, it } from 'vitest';

import {
  buildRubySegments,
  buildRubySegmentsWithCandidates,
  byteToUtf16,
  type SourceToken,
} from '../src/pages/reader/ruby/JapaneseRubyTokens';

describe('Japanese ruby token conversion', () => {
  it('splits the kanji out of mixed kanji-kana words', () => {
    const text = '食べる';
    const tokens: SourceToken[] = [
      {
        byteStart: 0,
        byteEnd: new TextEncoder().encode(text).length,
        text,
        reading: 'タベル',
      },
    ];

    expect(buildRubySegments(tokens, text)).toEqual([
      { text: '食', reading: 'た' },
      { text: 'べる' },
    ]);
  });

  it('keeps UTF-8 byte offsets aligned with UTF-16 rendering offsets', () => {
    const text = '😀東京へ';
    const tokens: SourceToken[] = [
      {
        byteStart: 4,
        byteEnd: 10,
        text: '東京',
        reading: 'トウキョウ',
      },
    ];

    expect(byteToUtf16(4, text)).toBe(2);
    expect(buildRubySegments(tokens, text)).toEqual([
      { text: '😀' },
      { text: '東京', reading: 'とうきょう' },
      { text: 'へ' },
    ]);
  });

  it('does not annotate a kanji run containing an unknown token', () => {
    const text = '人妖大乱中には大将軍と妖母、対妖用に特化した。';
    const tokens: SourceToken[] = [
      tokenAt(text, 0, 1, 'ヒト'),
      tokenAt(text, 1, 2, '*'),
      tokenAt(text, 2, 4, 'タイラン'),
      tokenAt(text, 4, 5, 'チュウ'),
      tokenAt(text, 7, 10, 'ダイショウグン'),
      tokenAt(text, 11, 12, '*'),
      tokenAt(text, 12, 13, 'ハハ'),
      tokenAt(text, 14, 15, 'タイ'),
      tokenAt(text, 15, 16, '*'),
      tokenAt(text, 16, 17, 'ヨウ'),
      tokenAt(text, 18, 20, 'トッカ'),
    ];

    expect(buildRubySegments(tokens, text)).toEqual([
      { text: '人妖大乱中には' },
      { text: '大将軍', reading: 'だいしょうぐん' },
      { text: 'と妖母、対妖用に' },
      { text: '特化', reading: 'とっか' },
      { text: 'した。' },
    ]);
  });

  it('shows the closest reading candidate with a slash', () => {
    const text = '視界が開ける。';
    const common = tokenAt(text, 0, 2, 'シカイ');

    expect(
      buildRubySegmentsWithCandidates(
        [
          {
            cost: -107,
            tokens: [common, tokenAt(text, 3, 6, 'アケル')],
          },
          {
            cost: 71,
            tokens: [common, tokenAt(text, 3, 6, 'ヒラケル')],
          },
        ],
        text,
        { costThreshold: 2_000, maxReadings: 2 },
      ),
    ).toEqual([
      { text: '視界', reading: 'しかい' },
      { text: 'が' },
      { text: '開', reading: 'あ/ひら' },
      { text: 'ける。' },
    ]);
  });

  it('limits a ruby position to two readings', () => {
    const text = '端から';

    expect(
      buildRubySegmentsWithCandidates(
        [
          { cost: 0, tokens: [tokenAt(text, 0, 1, 'ハジ')] },
          { cost: 56, tokens: [tokenAt(text, 0, 1, 'ハシ')] },
          { cost: 230, tokens: [tokenAt(text, 0, 1, 'タン')] },
        ],
        text,
        { costThreshold: 2_000, maxReadings: 2 },
      ),
    ).toEqual([{ text: '端', reading: 'はじ/はし' }, { text: 'から' }]);
  });

  it('does not mix candidates with different token boundaries', () => {
    const text = '一人';

    expect(
      buildRubySegmentsWithCandidates(
        [
          {
            cost: 0,
            tokens: [tokenAt(text, 0, 1, 'イチ'), tokenAt(text, 1, 2, 'ニン')],
          },
          { cost: 100, tokens: [tokenAt(text, 0, 2, 'ヒトリ')] },
        ],
        text,
        { costThreshold: 2_000, maxReadings: 2 },
      ),
    ).toEqual([
      { text: '一', reading: 'いち' },
      { text: '人', reading: 'にん' },
    ]);
  });
});

function tokenAt(
  text: string,
  start: number,
  end: number,
  reading: string,
): SourceToken {
  const encoder = new TextEncoder();
  return {
    byteStart: encoder.encode(text.slice(0, start)).length,
    byteEnd: encoder.encode(text.slice(0, end)).length,
    text: text.slice(start, end),
    reading,
  };
}
