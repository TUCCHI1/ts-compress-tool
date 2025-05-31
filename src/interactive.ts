import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import {
  compressTypeScriptFiles,
  defaultCompressionPipeline,
} from './compressor.js';
import {
  getTypeScriptFiles,
  copyToClipboard,
  formatFileSize,
  getRelativePath,
  calculateStats,
} from './utils.js';
import type { CompressOptions, IOEffect, FileStats } from './types.js';

// メニュー項目型
type MenuChoice =
  | { type: 'file'; index: number }
  | { type: 'all' }
  | { type: 'quit' };

// メニュー表示作成（純粋関数）
const createMenuDisplay = (
  files: readonly string[],
  baseDir: string,
): string => {
  const header = [
    chalk.cyan('========================================'),
    chalk.cyan.bold('TypeScript File Compression Tool'),
    chalk.cyan('========================================\n'),
    chalk.yellow('Available files:\n'),
  ].join('\n');

  const fileList = files
    .map((file, index) => {
      const relativePath = getRelativePath(file, baseDir);
      return chalk.white(`  ${index + 1}. ${relativePath}`);
    })
    .join('\n');

  const options = [
    chalk.gray('\n  a. Compress all files'),
    chalk.gray('  q. Quit\n'),
  ].join('\n');

  return `${header}\n${fileList}${options}`;
};

// 選択肢パース（純粋関数）
const parseChoice = (choice: string, fileCount: number): MenuChoice | null => {
  const lowerChoice = choice.toLowerCase();

  if (lowerChoice === 'q') return { type: 'quit' };
  if (lowerChoice === 'a') return { type: 'all' };

  const index = parseInt(choice) - 1;
  if (index >= 0 && index < fileCount) {
    return { type: 'file', index };
  }

  return null;
};

// 統計情報表示作成（純粋関数）
const createStatsDisplay = (
  title: string,
  stats: FileStats,
  fileCount?: number,
): string => {
  const lines = [
    chalk.cyan(`\n${title}`),
    ...(fileCount !== undefined ? [`   Files: ${fileCount}`] : []),
    `   Original: ${formatFileSize(stats.originalSize)}`,
    `   Compressed: ${formatFileSize(stats.compressedSize)}`,
    `   Ratio: ${stats.ratio}%`,
  ];

  return lines.join('\n');
};

// 単一ファイル処理（IO分離）
const processSingleFile =
  (
    filePath: string,
    baseDir: string,
  ): IOEffect<{ content: string; stats: FileStats }> =>
  async () => {
    const originalContent = await readFile(filePath, 'utf-8');
    const compressedContent = defaultCompressionPipeline(originalContent);
    const relativePath = getRelativePath(filePath, baseDir);
    const output = `/*${relativePath}*/${compressedContent}`;

    const stats = calculateStats(originalContent.length, output.length);

    return { content: output, stats };
  };

// 全ファイル圧縮処理（IO分離）
const compressAllFiles =
  (
    options: CompressOptions,
  ): IOEffect<{ output: string; stats: FileStats; fileCount: number }> =>
  async () => {
    const result = await compressTypeScriptFiles(options)();
    return {
      output: result.output,
      stats: result.totalStats,
      fileCount: result.files.length,
    };
  };

// 成功メッセージ作成（純粋関数）
const createSuccessMessage = (action: string): string =>
  chalk.green(`\n✅ ${action}`);

// エラーメッセージ作成（純粋関数）
const createErrorMessage = (error: unknown): string =>
  chalk.red('\n❌ Error: ') +
  (error instanceof Error ? error.message : String(error));

// 継続プロンプト（IO分離）
const promptContinue =
  (rl: ReturnType<typeof createInterface>): IOEffect<void> =>
  async () => {
    await rl.question(chalk.gray('\nPress Enter to continue...'));
  };

// メニューループ処理
const menuLoop =
  (
    files: readonly string[],
    options: CompressOptions,
    rl: ReturnType<typeof createInterface>,
  ): IOEffect<void> =>
  async () => {
    console.clear();
    console.log(createMenuDisplay(files, options.targetDir));

    const choice = await rl.question(
      chalk.green('Select file number or option: '),
    );
    const parsed = parseChoice(choice, files.length);

    if (!parsed) {
      console.log(chalk.red('\n❌ Invalid selection'));
      await promptContinue(rl)();
      return menuLoop(files, options, rl)();
    }

    switch (parsed.type) {
      case 'quit':
        console.log(chalk.gray('\nGoodbye!'));
        return;

      case 'all': {
        console.log(chalk.cyan('\nCompressing all files...'));
        try {
          const result = await compressAllFiles(options)();
          await copyToClipboard(result.output)();
          console.log(
            createSuccessMessage(
              'All files compressed and copied to clipboard',
            ),
          );
          console.log(
            createStatsDisplay(
              '📊 Statistics:',
              result.stats,
              result.fileCount,
            ),
          );
        } catch (error) {
          console.error(createErrorMessage(error));
        }
        await promptContinue(rl)();
        return menuLoop(files, options, rl)();
      }

      case 'file': {
        const filePath = files[parsed.index]!;
        const relativePath = getRelativePath(filePath, options.targetDir);
        console.log(chalk.cyan(`\nCompressing ${relativePath}...`));

        try {
          const result = await processSingleFile(filePath, options.targetDir)();
          await copyToClipboard(result.content)();
          console.log(
            createSuccessMessage(
              `${relativePath} compressed and copied to clipboard`,
            ),
          );
          console.log(createStatsDisplay('📊 Statistics:', result.stats));
        } catch (error) {
          console.error(createErrorMessage(error));
        }

        await promptContinue(rl)();
        return menuLoop(files, options, rl)();
      }
    }
  };

// インタラクティブモード（IO分離）
export const interactiveMode =
  (options: CompressOptions): IOEffect<void> =>
  async () => {
    const rl = createInterface({ input, output });

    try {
      const files = await getTypeScriptFiles(
        options.targetDir,
        options.includePatterns,
        options.excludePatterns,
      )();

      if (files.length === 0) {
        console.log(chalk.yellow('No TypeScript files found.'));
        return;
      }

      await menuLoop(files, options, rl)();
    } finally {
      rl.close();
    }
  };
