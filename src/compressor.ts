import { createSourceFile, ScriptTarget, createPrinter } from 'typescript';
import { readFile } from 'node:fs/promises';
import type {
  CompressOptions,
  CompressResult,
  ProcessedFile,
  CompressFunction,
  IOEffect,
} from './types.js';
import {
  getTypeScriptFiles,
  calculateStats,
  getRelativePath,
  pipe,
} from './utils.js';

// TypeScript ASTを使用したコメント削除（純粋関数）
export const removeCommentsWithAST: CompressFunction = (
  content: string,
): string => {
  const sourceFile = createSourceFile(
    'temp.ts',
    content,
    ScriptTarget.Latest,
    true,
  );

  const printer = createPrinter({
    removeComments: true,
    omitTrailingSemicolon: false,
  });

  return printer.printFile(sourceFile);
};

// 圧縮ルール定義
const compressionRules: ReadonlyArray<readonly [RegExp, string]> = [
  [/\n\s*\n/g, '\n'],
  [/^\s+/gm, ''],
  [/\s+$/gm, ''],
  [/\s*([{}:;,=()[\]<>])\s*/g, '$1'],
  [/import\s*{/g, 'import{'],
  [/}\s*from/g, '}from'],
  [/export\s*{/g, 'export{'],
  [/export\s+type/g, 'export type'],
  [/export\s+const/g, 'export const'],
  [/export\s+enum/g, 'export enum'],
  [/export\s+interface/g, 'export interface'],
  [/type\s+(\w+)\s*=/g, 'type $1='],
  [/:\s*([A-Za-z])/g, ':$1'],
];

// ルール適用（純粋関数）
const applyRule = (
  content: string,
  [pattern, replacement]: readonly [RegExp, string],
): string => content.replace(pattern, replacement);

// 行処理（純粋関数）
const processLines = (content: string): string =>
  content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('');

// 高度な圧縮（純粋関数）
export const advancedCompress: CompressFunction = (content: string): string => {
  const afterRules = compressionRules.reduce(applyRule, content);
  return processLines(afterRules);
};

// 圧縮パイプライン作成（純粋関数）
export const createCompressionPipeline = (
  ...functions: CompressFunction[]
): CompressFunction => functions.reduce((acc, fn) => pipe(acc, fn));

// デフォルト圧縮パイプライン
export const defaultCompressionPipeline = createCompressionPipeline(
  removeCommentsWithAST,
  advancedCompress,
);

// ファイル読み込みIO
const readFileContent =
  (filePath: string): IOEffect<string> =>
  async () =>
    readFile(filePath, 'utf-8');

// 単一ファイル処理（IO分離）
export const processFile =
  (
    filePath: string,
    compress: CompressFunction = defaultCompressionPipeline,
  ): IOEffect<ProcessedFile> =>
  async () => {
    const originalContent = await readFileContent(filePath)();
    const compressedContent = compress(originalContent);
    const stats = calculateStats(
      originalContent.length,
      compressedContent.length,
    );

    return {
      path: filePath,
      originalContent,
      compressedContent,
      stats,
    };
  };

// ファイル出力フォーマット（純粋関数）
export const formatFileOutput = (
  file: ProcessedFile,
  baseDir: string,
  preserveStructure: boolean,
): string => {
  const relativePath = getRelativePath(file.path, baseDir);

  return preserveStructure
    ? `\n/*=== ${relativePath} ===*/\n${file.compressedContent}\n`
    : `/*${relativePath}*/${file.compressedContent}`;
};

// 統計情報集計（純粋関数）
export const aggregateStats = (
  files: readonly ProcessedFile[],
): { totalOriginalSize: number; totalCompressedSize: number } =>
  files.reduce(
    (acc, file) => ({
      totalOriginalSize: acc.totalOriginalSize + file.stats.originalSize,
      totalCompressedSize: acc.totalCompressedSize + file.stats.compressedSize,
    }),
    { totalOriginalSize: 0, totalCompressedSize: 0 },
  );

// 出力生成（純粋関数）
export const generateOutput = (
  files: readonly ProcessedFile[],
  baseDir: string,
  preserveStructure: boolean,
): string =>
  files
    .map(file => formatFileOutput(file, baseDir, preserveStructure))
    .join(preserveStructure ? '\n' : '');

// メイン圧縮関数（IO分離）
export const compressTypeScriptFiles =
  (options: CompressOptions): IOEffect<CompressResult> =>
  async () => {
    const {
      targetDir,
      includePatterns,
      excludePatterns,
      preserveStructure = false,
      verbose = false,
    } = options;

    // ファイル取得
    const files = await getTypeScriptFiles(
      targetDir,
      includePatterns,
      excludePatterns,
    )();

    if (files.length === 0) {
      throw new Error(`No TypeScript files found in ${targetDir}`);
    }

    if (verbose) {
      console.log(`Found ${files.length} TypeScript files`);
    }

    // 並列処理でファイル圧縮
    const processedFiles = await Promise.all(
      files.map(file => processFile(file)()),
    );

    // 出力生成
    const output = generateOutput(processedFiles, targetDir, preserveStructure);

    // 統計情報集計
    const { totalOriginalSize } = aggregateStats(processedFiles);
    const totalCompressedSize = output.length;
    const totalStats = calculateStats(totalOriginalSize, totalCompressedSize);

    return {
      files: processedFiles,
      totalStats,
      output,
    };
  };
