// 型エクスポート
export type {
  CompressOptions,
  CompressResult,
  ProcessedFile,
  FileStats,
  CompressFunction,
  FileFilter,
  IOEffect,
  Either,
} from './types.js';

// 関数エクスポート
export {
  // 圧縮関数
  compressTypeScriptFiles,
  removeCommentsWithAST,
  advancedCompress,
  createCompressionPipeline,
  defaultCompressionPipeline,
  processFile,
  formatFileOutput,
  aggregateStats,
  generateOutput,
} from './compressor.js';

export {
  // ユーティリティ関数
  directoryExists,
  createFileFilter,
  getTypeScriptFiles,
  calculateStats,
  copyToClipboard,
  formatFileSize,
  getRelativePath,
  concat,
  merge,
  pipe,
  pipeAsync,
} from './utils.js';

export {
  // Either型ユーティリティ
  left,
  right,
  isLeft,
  isRight,
} from './types.js';

import { compressTypeScriptFiles } from './compressor.js';
import { copyToClipboard } from './utils.js';
import type { CompressOptions, CompressResult, IOEffect } from './types.js';

// 圧縮APIオプション型
export type CompressApiOptions = Partial<Omit<CompressOptions, 'targetDir'>>;

// TypeScriptファイル圧縮（IO分離）
export const compress = (
  targetDir: string,
  options?: CompressApiOptions,
): IOEffect<CompressResult> => {
  const fullOptions: CompressOptions = {
    targetDir,
    ...options,
  };

  return compressTypeScriptFiles(fullOptions);
};

// クリップボードへの圧縮（IO分離）
export const compressToClipboard =
  (targetDir: string, options?: CompressApiOptions): IOEffect<CompressResult> =>
  async () => {
    const result = await compress(targetDir, options)();
    await copyToClipboard(result.output)();
    return result;
  };

// 非IO版ラッパー（後方互換性のため）
export const compressSync = async (
  targetDir: string,
  options?: CompressApiOptions,
): Promise<CompressResult> => compress(targetDir, options)();

export const compressToClipboardSync = async (
  targetDir: string,
  options?: CompressApiOptions,
): Promise<CompressResult> => compressToClipboard(targetDir, options)();

// デフォルトエクスポート
const tsCompress = {
  compress,
  compressToClipboard,
  compressSync,
  compressToClipboardSync,
} as const;

export default tsCompress;
