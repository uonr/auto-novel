import initLindera, {
  loadDictionaryFromBytes,
  type Tokenizer,
  TokenizerBuilder,
} from 'lindera-wasm-web';
import {
  downloadDictionary,
  hasDictionary,
  type DictionaryFiles,
  loadDictionaryFiles,
} from 'lindera-wasm-web/opfs';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import {
  buildRubySegmentsWithCandidates,
  type RubyTokenization,
} from './JapaneseRubyTokens';
import type { RubyRequest, RubyResponse } from './types';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RubyRequest>) => void) | null;
  postMessage(message: RubyResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;
const candidateCostThreshold = 2_000;
const maxNbestPaths = 64;
const maxReadings = 2;
const dictionaryName = 'ipadic-5.3.0';
const dictionaryUrl = new URL(
  'lindera-ipadic-5.3.0.zip',
  new URL(import.meta.env.BASE_URL, globalThis.location.origin),
).href;
let tokenizerPromise: Promise<Tokenizer> | undefined;

workerScope.onmessage = async ({ data }) => {
  try {
    const tokenizer = await getTokenizer();
    workerScope.postMessage({
      id: data.id,
      segments: annotateText(tokenizer, data.text),
    });
  } catch (error) {
    workerScope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function getTokenizer(): Promise<Tokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      await initLindera();
      const files = await getDictionaryFiles();
      const dictionary = loadDictionaryFromBytes(
        files.metadata,
        files.dictTrie,
        files.dictValsIdx,
        files.dictVals,
        files.dictWordsIdx,
        files.dictWords,
        files.matrixMtx,
        files.charDef,
        files.unk,
      );
      const builder = new TokenizerBuilder();
      builder.setDictionaryInstance(dictionary);
      builder.setMode('normal');
      builder.appendCharacterFilter('unicode_normalize', { kind: 'nfkc' });
      builder.appendTokenFilter('lowercase', {});
      builder.appendTokenFilter('japanese_compound_word', {
        kind: 'ipadic',
        tags: ['名詞,数'],
        new_tag: '名詞,数',
      });
      return builder.build();
    })();
  }
  return tokenizerPromise;
}

async function getDictionaryFiles(): Promise<DictionaryFiles> {
  if (supportsOpfsDictionary()) {
    try {
      if (!(await hasDictionary(dictionaryName))) {
        await downloadDictionary(dictionaryUrl, dictionaryName);
      }
      return await loadDictionaryFiles(dictionaryName);
    } catch (error) {
      console.warn('[reader-ruby] 无法使用 OPFS 词典缓存，将直接加载', error);
    }
  }
  return downloadDictionaryFiles(dictionaryUrl);
}

function supportsOpfsDictionary(): boolean {
  if (typeof navigator.storage?.getDirectory !== 'function') return false;
  if (typeof DecompressionStream === 'undefined') return false;
  try {
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

async function downloadDictionaryFiles(url: string): Promise<DictionaryFiles> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`日语词典下载失败: HTTP ${response.status}`);
  }

  const zipReader = new ZipReader(new BlobReader(await response.blob()));
  try {
    const entries = await zipReader.getEntries();
    const byName = new Map(
      entries
        .filter((entry) => !entry.directory)
        .map((entry) => {
          const path = entry.filename.split('/');
          return [path[path.length - 1], entry] as const;
        }),
    );
    const read = async (name: string): Promise<Uint8Array> => {
      const entry = byName.get(name);
      if (!entry || !('getData' in entry)) {
        throw new Error(`日语词典缺少文件: ${name}`);
      }
      return entry.getData(new Uint8ArrayWriter());
    };

    return {
      metadata: await read('metadata.json'),
      dictTrie: await read('dict.trie'),
      dictValsIdx: await read('dict.valsidx'),
      dictVals: await read('dict.vals'),
      dictWordsIdx: await read('dict.wordsidx'),
      dictWords: await read('dict.words'),
      matrixMtx: await read('matrix.mtx'),
      charDef: await read('char_def.bin'),
      unk: await read('unk.bin'),
    };
  } finally {
    await zipReader.close();
  }
}

interface NbestToken {
  byteEnd: number;
  byteStart: number;
  details: string[];
  surface: string;
}

interface NbestTokenization {
  cost: number;
  tokens: NbestToken[];
}

function annotateText(tokenizer: Tokenizer, text: string) {
  return splitAnalysisUnits(text).flatMap((unit) => {
    if (!/\p{Script=Han}/u.test(unit)) return [{ text: unit }];

    const tokenizations = tokenizer.tokenizeNbest(
      unit,
      maxNbestPaths,
      false,
      BigInt(candidateCostThreshold),
    ) as NbestTokenization[];
    return buildRubySegmentsWithCandidates(
      tokenizations.map<RubyTokenization>((tokenization) => ({
        cost: tokenization.cost,
        tokens: toSourceTokens(tokenization.tokens),
      })),
      unit,
      { costThreshold: candidateCostThreshold, maxReadings },
    );
  });
}

function splitAnalysisUnits(text: string): string[] {
  const units: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/[。！？!?\r\n]/u.test(text[index]!)) continue;

    let end = index + 1;
    while (end < text.length && /[。！？!?\r\n]/u.test(text[end]!)) end += 1;
    while (end < text.length && /[」』】）]/u.test(text[end]!)) end += 1;
    units.push(text.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < text.length) units.push(text.slice(start));
  return units.length > 0 ? units : [''];
}

function toSourceToken(token: NbestToken) {
  return {
    byteStart: token.byteStart,
    byteEnd: token.byteEnd,
    text: token.surface,
    reading: token.details[7] ?? '*',
  };
}

function toSourceTokens(tokens: NbestToken[]) {
  // `setDictionaryInstance` in Lindera 5.3 bypasses builder token filters.
  // Preserve the previous japanese_compound_word effect used by ruby output.
  const sourceTokens: ReturnType<typeof toSourceToken>[] = [];
  for (let start = 0; start < tokens.length; ) {
    const first = tokens[start]!;
    if (!isNumericNoun(first)) {
      sourceTokens.push(toSourceToken(first));
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < tokens.length && isNumericNoun(tokens[end]!)) end += 1;
    if (end === start + 1) {
      sourceTokens.push(toSourceToken(first));
    } else {
      sourceTokens.push({
        byteStart: first.byteStart,
        byteEnd: tokens[end - 1]!.byteEnd,
        text: tokens
          .slice(start, end)
          .map((token) => token.surface)
          .join(''),
        reading: '*',
      });
    }
    start = end;
  }
  return sourceTokens;
}

function isNumericNoun(token: NbestToken): boolean {
  return token.details[0] === '名詞' && token.details[1] === '数';
}
