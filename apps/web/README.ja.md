<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# kawaii-wiki.ts Web

kawaii-wiki.ts ハンズオンプロジェクトのための Vue 3 + Vite フロントエンド。

## これで学べること

- サーバーの `App` 型から Eden Treaty を使った型付き API コール
- Vue コンポーネントの状態管理と Pinia ストア
- CodeMirror を使った Markdown 編集
- 検索、ページ閲覧、編集、ログイン、管理フロー
- サーバー送信イベントによるリアルタイムのページ変更更新
- 公開設定と CSS 変数によるランタイムブランディング
- 公開設定からのホーム/ヘッダー ナビゲーションの設定
- KaTeX CSS、Mermaid 図、コンテンツタブのための遅延 Markdown 強化
- 新規ページ作成用の組み込みかつ永続化されたページテンプレート
- UI コードを薄く保ちつつ、ドメインルールは `@kawaii-wiki/core` に保持

## 実行方法

リポジトリのルートから:

```bash
bun install
bun run db:seed
bun run dev
```

`http://localhost:5180` を開きます。シード済みアカウントでサインインしてください:

```text
admin@example.com / password
```

## 便利なコマンド

```bash
bun --filter '@kawaii-wiki/web' dev
bun --filter '@kawaii-wiki/web' build
bun --filter '@kawaii-wiki/web' preview
bun --filter '@kawaii-wiki/web' typecheck
```

## 最初に読むべきファイル

| ファイル | 重要な理由 |
| --- | --- |
| `src/main.ts` | アプリのブートストラップとプラグイン設定 |
| `src/App.vue` | トップレベルのレイアウトとルートシェル |
| `src/lib/api.ts` | サーバーとの型付きクライアント契約 |
| `src/lib/branding.ts` | タイトル、ファビコン、カスタム CSS、信頼済みヘッド HTML の適用 |
| `src/lib/markdownEnhance.ts` | コピー ボタン、KaTeX CSS、Mermaid、タブでレンダリング済み Markdown を強化 |
| `src/lib/pageTemplates.ts` | 組み込みスターターテンプレートとカスタムテンプレートオプションヘルパー |
| `src/stores/auth.ts` | ログイン/セッション状態 |
| `src/views/PageEdit.vue` | Markdown 編集フロー |
| `src/views/PageTemplatesView.vue` | エディター向けカスタムテンプレートマネージャー |
| `src/app.css` / `uno.config.ts` | テーマ変数とトークン対応ショートカット |

## 演習

1. 検索ビューにローディング状態と空状態を追加する。
2. 編集済みページを保存するための小さなキーボードショートカットを追加する。
3. サーバーが対応したら、ページのリビジョン履歴を表示するルートを作成する。
4. API 契約の型を保ちつつ、エディタープレビューを改善する。