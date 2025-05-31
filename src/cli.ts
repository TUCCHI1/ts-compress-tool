#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compressTypeScriptFiles } from './compressor.js';
import {
  copyToClipboard,
  directoryExists,
  formatFileSize,
  getRelativePath,
} from './utils.js';
import { interactiveMode } from './interactive.js';
import type {
  CompressOptions,
  CompressResult,
  ProcessedFile,
  IOEffect,
} from './types.js';

// CLI設定作成（純粋関数）
const createProgram = (): Command => {
  const program = new Command();

  return program
    .name('ts-compress')
    .description('TypeScript file compression tool')
    .version('2.0.0')
    .argument(
      '[directory]',
      'Target directory containing TypeScript files',
      '.',
    )
    .option('-o, --output <file>', 'Output to file instead of clipboard')
    .option('-i, --interactive', 'Interactive mode to select files')
    .option('-p, --preserve-structure', 'Preserve file structure in output')
    .option('-v, --verbose', 'Verbose output')
    .option('--include <patterns...>', 'Include file patterns', ['*.ts'])
    .option('--exclude <patterns...>', 'Exclude file patterns', [
      '*.d.ts',
      '*.test.ts',
      '*.spec.ts',
    ]);
};

// 統計情報表示作成（純粋関数）
const createStatsSummary = (result: CompressResult): string =>
  [
    chalk.cyan('\n📊 Statistics:'),
    `   Files processed: ${chalk.bold(result.files.length)}`,
    `   Original size: ${chalk.bold(
      formatFileSize(result.totalStats.originalSize),
    )}`,
    `   Compressed size: ${chalk.bold(
      formatFileSize(result.totalStats.compressedSize),
    )}`,
    `   Compression ratio: ${chalk.bold(result.totalStats.ratio + '%')}`,
  ].join('\n');

// ファイル詳細表示作成（純粋関数）
const createFileDetails = (
  files: readonly ProcessedFile[],
  targetDir: string,
): string =>
  [
    chalk.cyan('\n📁 File details:'),
    ...files.map(file => {
      const relativePath = getRelativePath(file.path, targetDir);
      return [
        `   ${relativePath}:`,
        `     Original: ${formatFileSize(file.stats.originalSize)}`,
        `     Compressed: ${formatFileSize(file.stats.compressedSize)}`,
        `     Ratio: ${file.stats.ratio}%`,
      ].join('\n');
    }),
  ].join('\n');

// 結果表示作成（純粋関数）
const createResultDisplay = (
  result: CompressResult,
  options: { verbose?: boolean; targetDir: string },
): string => {
  const mainStats = createStatsSummary(result);
  return options.verbose
    ? `${mainStats}\n${createFileDetails(result.files, options.targetDir)}`
    : mainStats;
};

// 出力処理（IO分離）
const handleOutput =
  (output: string, outputFile?: string): IOEffect<string> =>
  async () => {
    if (outputFile) {
      await writeFile(outputFile, output, 'utf-8');
      return chalk.green(`✅ Output written to ${outputFile}`);
    }

    await copyToClipboard(output)();
    return chalk.green('✅ Compressed output copied to clipboard');
  };

// 圧縮オプション作成（純粋関数）
const createCompressOptions = (
  targetDir: string,
  options: any,
): CompressOptions => ({
  targetDir,
  outputFile: options.output,
  includePatterns: options.include,
  excludePatterns: options.exclude,
  preserveStructure: options.preserveStructure,
  verbose: options.verbose,
  interactive: options.interactive,
});

// エラーメッセージ作成（純粋関数）
const formatErrorMessage = (error: unknown): string =>
  chalk.red('Error: ') +
  (error instanceof Error ? error.message : String(error));

// メイン処理（IO分離）
const mainProcess =
  (directory: string, options: any): IOEffect<void> =>
  async () => {
    const targetDir = resolve(directory);
    const spinner = ora();

    // ディレクトリ確認
    const dirExists = await directoryExists(targetDir)();
    if (!dirExists) {
      throw new Error(`Directory '${targetDir}' does not exist`);
    }

    const compressOptions = createCompressOptions(targetDir, options);

    // インタラクティブモード
    if (options.interactive) {
      await interactiveMode(compressOptions)();
      return;
    }

    // 通常モード
    spinner.start('Compressing TypeScript files...');

    try {
      const result = await compressTypeScriptFiles(compressOptions)();
      spinner.succeed('Compression complete');

      // 出力処理
      const outputMessage = await handleOutput(result.output, options.output)();
      console.log(outputMessage);

      // 統計情報表示
      console.log(createResultDisplay(result, { ...options, targetDir }));
    } catch (error) {
      spinner.fail('Compression failed');
      throw error;
    }
  };

// CLIアクション（副作用の境界）
const cliAction = async (directory: string, options: any): Promise<void> => {
  try {
    await mainProcess(directory, options)();
  } catch (error) {
    console.error(formatErrorMessage(error));
    process.exit(1);
  }
};

// エラーハンドリング設定（副作用）
const setupErrorHandling = (): void => {
  process.on('unhandledRejection', error => {
    console.error(formatErrorMessage(error));
    process.exit(1);
  });
};

// CLI実行（副作用の境界）
const runCLI = (): void => {
  setupErrorHandling();
  const program = createProgram();
  program.action(cliAction);
  program.parse();
};

// エントリーポイント
runCLI();
