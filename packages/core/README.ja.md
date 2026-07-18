<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# kawaii-wiki.ts Core

サーバーとWebアプリで共有する、純粋TypeScriptのドメインパッケージです。

## このパッケージから学べること

- 関数型コアと命令型シェルを分離するアーキテクチャ
- ドメインロジックから例外を投げる代わりに、型付きの `Result<T, E>` で成功と失敗を表す方法
- 永続化前の入力検証と正規化
- 小さなポリシーテーブルとして表現した権限チェック
- HTTPやデータベースに依存しないMarkdownレンダリングとslug生成
- プラグイン、機能フラグ、型付きfenceブロックに対応するMarkdownレンダラーの拡張ポイント

## 実行方法

リポジトリのルートから実行します。

```bash
bun test packages/core
bun --filter '@kawaii-wiki/core' typecheck
```

## 最初に読むファイル

| ファイル | 役割 |
| --- | --- |
| `src/result.ts` | アプリ全体で使う成功・失敗の値 |
| `src/errors.ts` | 型付きアプリケーションエラー |
| `src/page.ts` | ページ入力の検証 |
| `src/permissions.ts` | 中央集約した認可ポリシー |
| `src/markdown.ts` | MarkdownからHTMLへの変換、機能フラグ、型付きfence、`createRenderer()`、`registerFenceRenderer()` |
| `src/slug.ts` | Unicodeを安全に扱うslug処理 |

## 練習課題

1. 新しい権限アクションを追加し、テストで動作を保証する。
2. サーバーコードをimportせずに、新しいページフィールドの検証を追加する。
3. `createRenderer({ features, plugins, fences })` でMarkdownレンダリングを拡張し、決定的な出力を保つ。
4. 先に失敗するテストを追加してから、純粋関数を更新する。
