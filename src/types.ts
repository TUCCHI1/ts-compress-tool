// 圧縮オプション
export type CompressOptions = Readonly<{
  targetDir: string;
  outputFile?: string;
  includePatterns?: readonly string[];
  excludePatterns?: readonly string[];
  preserveStructure?: boolean;
  verbose?: boolean;
  interactive?: boolean;
}>;

// ファイル統計情報
export type FileStats = Readonly<{
  originalSize: number;
  compressedSize: number;
  ratio: number;
}>;

// 処理済みファイル
export type ProcessedFile = Readonly<{
  path: string;
  originalContent: string;
  compressedContent: string;
  stats: FileStats;
}>;

// 圧縮結果
export type CompressResult = Readonly<{
  files: readonly ProcessedFile[];
  totalStats: FileStats;
  output: string;
}>;

// ファイルフィルター関数
export type FileFilter = (fileName: string) => boolean;

// 圧縮関数
export type CompressFunction = (content: string) => string;

// IOエフェクト型
export type IOEffect<T> = () => Promise<T>;

// Either型（エラーハンドリング用）
export type Either<E, A> =
  | { readonly _tag: 'Left'; readonly left: E }
  | { readonly _tag: 'Right'; readonly right: A };

// Either型のコンストラクター
export const left = <E, A>(e: E): Either<E, A> => ({ _tag: 'Left', left: e });
export const right = <E, A>(a: A): Either<E, A> => ({
  _tag: 'Right',
  right: a,
});

// Either型のユーティリティ
export const isLeft = <E, A>(e: Either<E, A>): e is { _tag: 'Left'; left: E } =>
  e._tag === 'Left';
export const isRight = <E, A>(
  e: Either<E, A>,
): e is { _tag: 'Right'; right: A } => e._tag === 'Right';
