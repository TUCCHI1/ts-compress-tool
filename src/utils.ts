import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { exec } from 'node:child_process';
import type { FileStats, FileFilter, IOEffect } from './types.js';

// ディレクトリ存在確認（IO分離）
export const directoryExists =
  (path: string): IOEffect<boolean> =>
  async () => {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  };

// パターンをRegExpに変換（純粋関数）
const patternToRegex = (pattern: string): RegExp =>
  new RegExp(pattern.replace(/\*/g, '.*'));

// フィルター関数の作成（純粋関数）
export const createFileFilter = (
  includePatterns: readonly string[],
  excludePatterns: readonly string[],
): FileFilter => {
  const includeRegexes = includePatterns.map(patternToRegex);
  const excludeRegexes = excludePatterns.map(patternToRegex);

  return (fileName: string): boolean => {
    if (!fileName.endsWith('.ts')) return false;
    if (excludeRegexes.some(regex => regex.test(fileName))) return false;
    return includeRegexes.some(regex => regex.test(fileName));
  };
};

// ディレクトリスキップ判定（純粋関数）
const shouldSkipDirectory = (name: string): boolean =>
  name === 'node_modules' || name.startsWith('.') || name === 'dist';

// 再帰的ファイル取得（IO分離）
const getFilesRecursiveIO =
  (dir: string, filter: FileFilter): IOEffect<readonly string[]> =>
  async () => {
    const entries = await readdir(dir, { withFileTypes: true });

    const results = await Promise.all(
      entries.map(async entry => {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          return shouldSkipDirectory(entry.name)
            ? []
            : await getFilesRecursiveIO(fullPath, filter)();
        }

        return filter(entry.name) ? [fullPath] : [];
      }),
    );

    return results.flat().sort();
  };

// TypeScriptファイル取得
export const getTypeScriptFiles = (
  dir: string,
  includePatterns: readonly string[] = ['*.ts'],
  excludePatterns: readonly string[] = ['*.d.ts', '*.test.ts', '*.spec.ts'],
): IOEffect<readonly string[]> => {
  const filter = createFileFilter(includePatterns, excludePatterns);
  return getFilesRecursiveIO(dir, filter);
};

// 統計情報計算（純粋関数）
export const calculateStats = (
  originalSize: number,
  compressedSize: number,
): FileStats => ({
  originalSize,
  compressedSize,
  ratio:
    originalSize > 0
      ? Math.round((1 - compressedSize / originalSize) * 100)
      : 0,
});

// プラットフォーム別クリップボードコマンド（純粋関数）
const getClipboardCommand = (platform: string): string => {
  const commands: Record<string, string> = {
    darwin: 'pbcopy',
    win32: 'clip',
    linux: 'xclip -selection clipboard',
  };
  return commands[platform] ?? 'xclip -selection clipboard';
};

// クリップボードコピー（IO分離）
export const copyToClipboard =
  (text: string): IOEffect<void> =>
  async () => {
    const command = getClipboardCommand(process.platform);

    const child = exec(command);
    if (!child.stdin)
      throw new Error('Failed to access clipboard command stdin');

    child.stdin.write(text);
    child.stdin.end();

    await new Promise<void>((resolve, reject) => {
      child.on('exit', code => {
        code === 0 ? resolve() : reject(new Error(`Exit code: ${code}`));
      });
      child.on('error', reject);
    });
  };

// ファイルサイズフォーマット（純粋関数）
export const formatFileSize = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const size = (bytes / Math.pow(1024, index)).toFixed(2);
  return `${size} ${units[index]}`;
};

// 相対パス取得（純粋関数）
export const getRelativePath = (filePath: string, baseDir: string): string =>
  relative(baseDir, filePath).replace(/\\/g, '/');

// 配列結合（純粋関数）
export const concat = <T>(...arrays: readonly (readonly T[])[]): readonly T[] =>
  arrays.reduce<readonly T[]>((acc, arr) => [...acc, ...arr], []);

// オブジェクトマージ（純粋関数）
export const merge = <T extends object>(...objects: readonly T[]): T =>
  Object.assign({}, ...objects) as T;

// パイプライン合成（純粋関数）
export const pipe =
  <A, B, C>(f: (a: A) => B, g: (b: B) => C): ((a: A) => C) =>
  (a: A) =>
    g(f(a));

// 非同期パイプライン
export const pipeAsync =
  <A, B, C>(
    f: (a: A) => Promise<B>,
    g: (b: B) => Promise<C>,
  ): ((a: A) => Promise<C>) =>
  async (a: A) =>
    g(await f(a));
