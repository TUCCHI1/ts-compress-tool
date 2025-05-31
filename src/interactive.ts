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
  | { type: 'multi' }
  | { type: 'compress-selected' }
  | { type: 'clear' }
  | { type: 'quit' };

// 選択状態型
type SelectionState = ReadonlySet<number>;

// メニュー表示作成（純粋関数）
const createMenuDisplay = (
  files: readonly string[],
  baseDir: string,
  selectedIndices: SelectionState,
  isMultiSelectMode: boolean,
): string => {
  const header = [
    chalk.cyan('========================================'),
    chalk.cyan.bold('TypeScript File Compression Tool'),
    chalk.cyan('========================================\n'),
    isMultiSelectMode
      ? chalk.yellow.bold('📌 Multi-select mode (press m to exit)')
      : '',
    selectedIndices.size > 0
      ? chalk.green(`✓ ${selectedIndices.size} file(s) selected`)
      : '',
    chalk.yellow('\nAvailable files:\n'),
  ]
    .filter(Boolean)
    .join('\n');

  const fileList = files
    .map((file, index) => {
      const relativePath = getRelativePath(file, baseDir);
      const isSelected = selectedIndices.has(index);
      const prefix = isSelected ? chalk.green('✓') : ' ';
      const number = chalk.gray(`${index + 1}.`);
      const fileName = isSelected
        ? chalk.green(relativePath)
        : chalk.white(relativePath);
      return `  ${prefix} ${number} ${fileName}`;
    })
    .join('\n');

  const options = [
    chalk.gray('\n========================================'),
    isMultiSelectMode
      ? chalk.yellow('  Select files by number (comma-separated)')
      : chalk.gray('  1-9. Select single file'),
    !isMultiSelectMode && chalk.gray('  m. Multi-select mode'),
    selectedIndices.size > 0 &&
      chalk.cyan(`  c. Compress selected (${selectedIndices.size} files)`),
    selectedIndices.size > 0 && chalk.gray('  x. Clear selection'),
    chalk.gray('  a. Compress all files'),
    chalk.gray('  q. Quit\n'),
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n${fileList}${options}`;
};

// 選択肢パース（純粋関数）
const parseChoice = (
  choice: string,
  fileCount: number,
  isMultiSelectMode: boolean,
  hasSelection: boolean,
): MenuChoice | readonly number[] | null => {
  const lowerChoice = choice.toLowerCase().trim();

  if (lowerChoice === 'q') return { type: 'quit' };
  if (lowerChoice === 'a') return { type: 'all' };
  if (lowerChoice === 'm' && !isMultiSelectMode) return { type: 'multi' };
  if (lowerChoice === 'c' && hasSelection) return { type: 'compress-selected' };
  if (lowerChoice === 'x' && hasSelection) return { type: 'clear' };

  // 複数選択モードでのパース
  if (isMultiSelectMode) {
    const indices = choice
      .split(/[,\s]+/)
      .map(s => parseInt(s.trim()) - 1)
      .filter(n => !isNaN(n) && n >= 0 && n < fileCount);
    return indices.length > 0 ? indices : null;
  }

  // 単一選択
  const index = parseInt(choice) - 1;
  if (index >= 0 && index < fileCount) {
    return { type: 'file', index };
  }

  return null;
};

// 選択状態更新（純粋関数）
const toggleSelection = (
  currentSelection: SelectionState,
  indices: readonly number[],
): SelectionState => {
  const newSelection = new Set(currentSelection);
  for (const index of indices) {
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
  }
  return newSelection;
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

// 選択されたファイルの圧縮（IO分離）
const compressSelectedFiles =
  (
    files: readonly string[],
    selectedIndices: SelectionState,
    baseDir: string,
    preserveStructure: boolean = false,
  ): IOEffect<{ output: string; stats: FileStats; fileCount: number }> =>
  async () => {
    const selectedFiles = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map(i => files[i]!)
      .filter(Boolean);

    if (selectedFiles.length === 0) {
      throw new Error('No files selected');
    }

    // 各ファイルを処理
    const results = await Promise.all(
      selectedFiles.map(async file => {
        const content = await readFile(file, 'utf-8');
        return {
          path: file,
          original: content,
          compressed: defaultCompressionPipeline(content),
        };
      }),
    );

    // 出力生成
    const output = results
      .map(r => {
        const relativePath = getRelativePath(r.path, baseDir);
        return preserveStructure
          ? `\n/*=== ${relativePath} ===*/\n${r.compressed}\n`
          : `/*${relativePath}*/${r.compressed}`;
      })
      .join(preserveStructure ? '\n' : '');

    // 統計計算
    const totalOriginal = results.reduce(
      (sum, r) => sum + r.original.length,
      0,
    );
    const stats = calculateStats(totalOriginal, output.length);

    return { output, stats, fileCount: selectedFiles.length };
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
    selectedIndices: SelectionState = new Set(),
    isMultiSelectMode: boolean = false,
  ): IOEffect<void> =>
  async () => {
    console.clear();
    console.log(
      createMenuDisplay(
        files,
        options.targetDir,
        selectedIndices,
        isMultiSelectMode,
      ),
    );

    const prompt = isMultiSelectMode
      ? chalk.yellow('Select files (comma-separated) or m to exit: ')
      : chalk.green('Select option: ');

    const choice = await rl.question(prompt);
    const parsed = parseChoice(
      choice,
      files.length,
      isMultiSelectMode,
      selectedIndices.size > 0,
    );

    if (!parsed) {
      console.log(chalk.red('\n❌ Invalid selection'));
      await promptContinue(rl)();
      return menuLoop(files, options, rl, selectedIndices, isMultiSelectMode)();
    }

    // 複数のインデックスが返された場合（複数選択モード）
    if (Array.isArray(parsed)) {
      const newSelection = toggleSelection(selectedIndices, parsed);
      console.log(
        chalk.green(
          `\n✓ Selection updated: ${newSelection.size} files selected`,
        ),
      );
      await promptContinue(rl)();
      return menuLoop(files, options, rl, newSelection, isMultiSelectMode)();
    }

    // メニュー選択の処理
    const menuChoice = parsed as MenuChoice;
    switch (menuChoice.type) {
      case 'quit':
        console.log(chalk.gray('\nGoodbye!'));
        return;

      case 'multi':
        return menuLoop(files, options, rl, selectedIndices, true)();

      case 'clear':
        console.log(chalk.gray('\n✓ Selection cleared'));
        await promptContinue(rl)();
        return menuLoop(files, options, rl, new Set(), isMultiSelectMode)();

      case 'compress-selected': {
        console.log(
          chalk.cyan(`\nCompressing ${selectedIndices.size} selected files...`),
        );
        try {
          const result = await compressSelectedFiles(
            files,
            selectedIndices,
            options.targetDir,
            options.preserveStructure,
          )();
          await copyToClipboard(result.output)();
          console.log(
            createSuccessMessage(
              'Selected files compressed and copied to clipboard',
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
        return menuLoop(files, options, rl, new Set(), false)();
      }

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
        return menuLoop(
          files,
          options,
          rl,
          selectedIndices,
          isMultiSelectMode,
        )();
      }

      case 'file': {
        if (isMultiSelectMode) {
          // 複数選択モードでは単一選択を無効化
          return menuLoop(
            files,
            options,
            rl,
            selectedIndices,
            isMultiSelectMode,
          )();
        }

        const filePath = files[menuChoice.index]!;
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
        return menuLoop(
          files,
          options,
          rl,
          selectedIndices,
          isMultiSelectMode,
        )();
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
