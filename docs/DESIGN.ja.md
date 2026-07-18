<!-- i18n: language-switcher -->
[English](DESIGN.md) | [日本語](DESIGN.ja.md)

# kawaii-wiki.ts — 設計とアーキテクチャ

全体像と*なぜ*そうしたか。セットアップと1分間の概要については
[README](../README.md)を参照してください。実装状況とロードマップについては[HANDOFF.md](HANDOFF.md)を参照してください。

## Wiki.jsとの違い

kawaii-wiki.tsは[Wiki.js](https://js.wiki)に触発されており、それに対する意図的な反応です。Wiki.js v3
("vega")は2021年から開発中で2025年時点でベータ版がなく、v2は機能凍結状態にあります。kawaii-wiki.tsは良いアイデア（リッチなMarkdownレンダリング、重み付けされた全文検索、埋め込み可能な「ブロック」コンセプト）を保持しつつ、v3の完成を難しくしていたものを排除しています：グローバルな可変`WIKI`ゴッドオブジェクト、1000行のモデル、fire-and-forgetレンダリング、非トランザクション書き込み、大きなリッチエディタのフロントエンドバンドルなどです。

| | Wiki.js v3 (vega) | kawaii-wiki.ts |
|---|---|---|
| 共有状態 | グローバル可変の`WIKI`シングルトン、どこからでもアクセス可能 | 明示的な依存性注入；純粋なコア、エッジで副作用 |
| ドメインロジック | 1000行のObjectionモデルに混在 | `@kawaii-wiki/core`の純粋関数、`Result<T, E>`を返す |
| 保存 → レンダリング | レンダリングはfire-and-forgetジョブ；ページは一瞬空白になり、インデックスは遅延 | レンダリング＋リビジョン＋検索インデックスを**1トランザクション**で処理 |
| API | Apollo GraphQL（スキーマ＋リゾルバ＋コード生成） | Elysia型付きルート＝契約；**Eden Treaty**、コード生成なし |
| 検索 | すべてのバックエンド（PG、Algolia、Elasticなど） | 1つのバックエンドに特化：SQLite **FTS5**、BM25、重み付けカラム |
| フロントエンド | Quasar + TipTap + Monaco（約1MB JS） | Vue 3 + UnoCSS + CodeMirror；Viteビルド出力からバンドルサイズを検証済み |
| 認証 | 20以上のPassport戦略 | ローカル/OIDC/TOTP/passkey認証、プライベートモード、取り消し可能なJWTセッション |

## アーキテクチャ

Bunワークスペースのモノレポで、1つのルール：**依存関係は内向きに向かう**。純粋なコアはHTTPやデータベースについて何も知らず、ウェブアプリとサーバーは両方ともコアに依存し、互いには依存しません（サーバーの*型*だけはクライアントが無料でインポートします）。

```
kawaii-wiki.ts/
├── packages/
│   └── core/              @kawaii-wiki/core — 純粋でアイソモーフィック、I/Oなし
│       └── src/
│           ├── result.ts      Result<T, E> — 例外なしのエラー処理
│           ├── errors.ts      AppErrorのユニオン → HTTPステータスマッピング
│           ├── slug.ts        Unicode対応のパス/見出しスラッグ（日本語を保持）
│           ├── permissions.ts can(principal, action) — 1つの認可テーブル
│           ├── markdown.ts    markdown-itパイプライン → { html, toc }
│           ├── frontmatter.ts Markdownファイルのフロントマター解析/シリアライズヘルパー
│           └── page.ts        純粋な入力バリデーション
├── apps/
│   ├── server/            @kawaii-wiki/server — Bun + Elysia
│   │   └── src/
│   │       ├── db/            Drizzleスキーマ、FTS5マイグレーション、シード/リセット
│   │       ├── services/      pages · search · users · assets  (DIファクトリ)
│   │       ├── http/          Elysiaアプリ（`App`型をエクスポート）＋エラーマッピング
│   │       └── index.ts       env → db → app → listen
│   └── web/               @kawaii-wiki/web — Vue 3 + Vite + UnoCSS + Pinia
│       └── src/
│           ├── lib/api.ts     Eden Treatyクライアント（サーバーのAppから型取得）
│           ├── lib/           ブランディング · i18n · markdownEnhance · pageTemplates · realtime
│           ├── composables/   useSearch · useTheme · useMarkdownFeatures · usePresence · useForceGraph
│           ├── stores/        auth · pages (Pinia)
│           ├── components/    AppHeader/Footer · CommandPalette · PageHeader/Tree/Toc/Comments
│           │                  MarkdownEditor · VisualEditor · CollabEditor · ImageUploadDialog
│           │                  ModalDialog · DrawerSheet · InteractiveGraph · 管理パネル
│           └── views/         Admin · Page/View/Edit · Search · Graph · Events · Changes · Auth/Profile
└── reference/             学習用のローカルWiki.js v2/v3ソースチェックアウト（gitignore対象）
```

### 関数型プログラミングの選択

- **純粋なコア、エッジで副作用。** `@kawaii-wiki/core`はI/Oやグローバルを含みません。レンダリング、スラッグ、バリデーション、権限は純粋関数で、マイクロ秒単位でテスト可能です。
- **例外ではなく`Result<T, E>`。** サービスは型付き結果を返し、HTTP層だけがエラーをステータスコードに変換します（`unwrap` → `onError`）。
- **シングルトンではなく依存性注入。** `createDb()` → `createServices(db)` → `createApp({ db, env })`。テストはインメモリDBを起動して注入し、グローバルのモックは不要です。
- **スキーマが唯一の真実の源。** Drizzleの型はサービスを通り、Elysiaを経て、Eden Treaty経由でVueアプリに流れ、生成物はありません。

## 動作の仕組み

**ページの保存**（`createPage`/`updatePage`）は原子操作です。1トランザクション内でサーバーは：権限をチェックし（`can`）、入力を検証・正規化し、MarkdownをHTML＋目次にレンダリングし、ページ行を書き込み、前のバージョンを`page_revisions`にスナップショットし、FTS5インデックスを更新します。呼び出しが返る時点でページは完全にレンダリングされ、**かつ**検索可能です—競合はありません。

**検索**はSQLite FTS5テーブルを`SearchIndexer`インターフェースで使い、BM25ランキング、エスケープされた`snippet()`ハイライト、ページング、総件数、ページごとのACLフィルタリングを備えています。カラムの重み付けはタイトル ≫ 説明 ≫ 本文 ≫ コメント/アセットで、Wiki.jsのPostgreSQL `tsvector`の考え方を踏襲しつつ、依存なしの単一バックエンドです。ユーザー入力は寛容なプレフィックスクエリに変換され、引用符付きフレーズは正確、`-term`は除外、タイトルのみのスコープはサーバー側で構築され、正確/プレフィックスのタイトルマッチと軽い新しさブーストでランキングを形成します。コメントや参照されたアセットファイル名も所有ページの結果にインデックスされます。

> **CJK / 日本語検索の注意。** デフォルトのFTS5トークナイザーは`unicode61`で、英語や欧州言語の散文はよくランク付けしますが日本語は分割しません。CJKが多いコンテンツでは最初のマイグレーション前に
> `KAWAII_WIKI_FTS_TOKENIZER=trigram`を設定してください。既存DBはFTS仮想テーブルを再構築する必要があります：SQLiteをバックアップし、
> `KAWAII_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search`を実行してください。
> 軽量なタイプミス許容は将来的に外部エンジンの課題です：SQLite FTS5 trigramはCJK/部分文字列マッチに役立ちますが、汎用スペル補正は`SearchIndexer`の後回しです。

**テーマとブランディング**は実行時設定で、ビルド時定数ではありません。サーバーはサイトタイトル、アクセントカラー、テーマ、ロゴ、ファビコン、フッターのテキスト/リンク、ヘッダーリンク、カスタムCSSの安全な公開設定を提供します。ウェブアプリは外観設定をCSS変数（`--c-bg`、`--c-surface`、`--c-text`、`--c-border`、`--c-accent`、`--radius`）にマッピングし、主要なコントロール、レンダーブロック、コードブロックが再コンパイルなしに更新可能です。カスタムhead HTMLはカスタムCSSと意図的に分離されており、`KAWAII_WIKI_ALLOW_HEAD_INJECTION=true`のときのみサーバーから送信されます。

**Markdownレンダリング**は依然として純粋でアイソモーフィックですが、拡張の継ぎ目があります。`createRenderer({ features, plugins, fences })`はテストや埋め込み用に独立したmarkdown-itインスタンスを作成し、
`registerFenceRenderer(info, render)`はプロセス全体の型付きフェンスレンダラーをデフォルトパイプラインに追加します。組み込みはイベント、コールアウト、インフォボックス/プロフィール、リンク/ソーシャル、埋め込み、Mermaidソース、コンテンツタブフェンスをカバー。オプションのレンダラー機能は絵文字ショートコードとKaTeX数式を追加します。Mermaidは意図的にクライアント側のみでレンダリングされ、公開設定`enableMermaid`がオンのときのみ有効です。サーバーはエスケープ済みソースをフォールバックとして保存します。

**ページテンプレート**はウェブクライアントの決定論的な組み込みとSQLiteに永続化されたカスタムテンプレートに分かれています。エディタは`/api/templates`と`/_templates`でカスタムテンプレートを管理し、`_new`は両方を統合したピッカーを提供します。テンプレートのメタデータはタイトル、パス、ラベル、ステータス、ロケール、レビュー日を事前入力でき、追加のページモデルは不要です。

**ナビゲーション設定**は公開設定モデルにあります。`homePath`はルートページの解決とパンくずリストのホームリンクを制御します。`navItems`は表示される順序付きの組み込みヘッダー項目を保持し、`navLinks`はアイコン付きリンクと1階層のグループ化された子要素をデスクトップとモバイルのヘッダーメニューに対応させます。

**型**はコード生成なしで共有されます。サーバーは`App`型をエクスポートし、`apps/web/src/lib/api.ts`は`treaty<App>(...)`を使うため、すべてのリクエストのパス、クエリ、ボディはコンパイル時に実際のルートと照合されます。

**バンドルサイズはVite出力から測定され、推定ではありません。** v0.4.19時点で、ViteはVue、Markdownレンダリング、CodeMirror、Yjsコラボレーション、認証ヘルパー、KaTeX、Mermaid、highlight.jsのために手動ベンダーチャンクを使用しています。代表的な`bun run build`の報告は：エントリーポイント**36.56 KB gzip**、Vue **43.45 KB gzip**、Markdownパイプライン **68.72 KB gzip**、選択されたhighlight言語 **29.33 KB gzip**、Yjsコラボレーション **29.57 KB gzip**、CodeMirrorエディタ **855.62 KB gzip**、オプトインMermaid **943.61 KB gzip**。Markdownハイライトは`highlight.js`コアと選択された一般的な言語を使い、全言語エントリではありません。highlight.jsのCSSテーマはレンダリングされたコードブロックがある場合のみMarkdown強化で読み込まれます。将来のパフォーマンス作業は古い「`~43 KB gzip`」主張を繰り返すのではなく、チェック済みビルド出力と比較すべきです。

## マルチインスタンスモード

サーバーはデフォルトでDBベースのリアルタイムイベントバス（`KAWAII_WIKI_EVENT_BUS=db`）を使用します。ページ変更イベントは共有SQLiteデータベースに書き込まれ、すべてのサーバープロセスがそのログをポーリングするため、1つのインスタンスのSSE購読者は別のインスタンスがページを作成、編集、移動、削除したときに通知されます。

複数のAPIインスタンスを実行するには、同じ`DATABASE_PATH`を指し、`JWT_SECRET`を同一にし、各プロセスに異なる`PORT`を割り当てます：

```bash
DATABASE_PATH=./data/ts-wiki.sqlite JWT_SECRET=dev PORT=4000 KAWAII_WIKI_INSTANCE_ID=kawaii-wiki.ts-1 bun run dev:server
DATABASE_PATH=./data/ts-wiki.sqlite JWT_SECRET=dev PORT=4001 KAWAII_WIKI_INSTANCE_ID=kawaii-wiki.ts-2 bun run dev:server
```

単一プロセスのテストや非常に小規模なローカル実行では、`KAWAII_WIKI_EVENT_BUS=memory`で旧来のプロセス内イベントバスを復活させます。

## リアルタイム、プレゼンス、コラボレーション

- `/api/events`は認証済みのServer-Sent Eventsストリームです。ページ書き込み、Git同期インポート、コラボレーションの自動保存によって発行される`page:changed`イベントを運びます。
- `/api/presence`は「閲覧/編集」状態のための装飾的なWebSocketチャネルです。プレゼンスのIDは表示専用で、サーバー側でユーザーごとに重複排除されます。
- `/api/collab/:room`はYjs WebSocketプロトコルを話します。サーバーは各ルームを現在のページ内容とバージョンで初期化し、エディタートークンを要求し、`pages.saveContent`を通じて永続化します。古いバージョンのルームが新しいAPIやGit同期の書き込みを上書きできないようにバージョンチェックを行います。

## 管理、Git同期、監査ログ

最初に登録されたアカウントまたはシードされた管理者が初期管理者です。管理者専用ルートはページの変更と同じ純粋な権限チェックを使います。Git同期はページサービスのミラー/インポートアダプターで、DB書き込みはMarkdownファイルをコミットし、外部Gitコミットは通常のページ作成/更新/削除経路を通じてインポートされます。

すべてのHTTPリクエストと書き込み側アクションは構造化JSONログを発行します。リクエストログはメソッド、パス、ステータス、所要時間、IP、利用可能ならユーザーIDを記録します。監査ログは認証、ページ、管理、アセット、Git同期、コラボ自動保存アクションを記録し、デフォルトでこれらの監査イベントは`audit_log`に保持され、管理者向けの監査画面に使われます。`KAWAII_WIKI_AUDIT_DB=false`で標準出力のみのデプロイも可能です。

## バックアップ戦略

SQLiteが正準のストアです。オンラインでバックアップするには：

```bash
sqlite3 data/ts-wiki.sqlite ".backup 'backups/kawaii-wiki.ts-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

アップロードされたアセットディレクトリはデータベーススナップショットと一緒にバックアップしてください。GitミラーリングはSQLiteバックアップの代わりにはなりません。なぜならロール、リビジョンメタデータ、アセット、検索状態はMarkdownファイルだけでは完全に表現されないからです。

## スクリプト

| コマンド | 内容 |
|---|---|
| `bun run dev` | サーバー＋ウェブを一緒に起動（ホットリロード） |
| `bun run dev:server` / `dev:web` | 片方だけ起動 |
| `bun run db:migrate` | スキーマ適用（サーバー起動時にも自動実行） |
| `bun run db:seed` | 管理者＋サンプルページ（冪等） |
| `bun run db:reset` | SQLiteファイルを削除 |
| `bun run build` | ウェブアプリの本番ビルド |
| `bun run test` | コア＋サーバーテスト（`bun test`） |
| `bun run typecheck` | すべてのワークスペースの型チェック |

## 意図的にシンプル（現時点では）

v0ではあえて除外し、後で簡単に追加可能なもの：マルチサイト、i18n、SSR、より重いエディタ/プラグインマーケットプレイス。アーキテクチャにはそれらのための継ぎ目があります（例：`permissions.ts`、ストレージ非依存のサービス層、`assets`、`SearchIndexer`、Markdownレンダラーファクトリ）。

## 参考コード

`reference/wiki-main/`（Wiki.js v2）と`reference/wiki-vega/`（Wiki.js v3）は学習用にローカルでチェックアウト可能で**gitignore対象**です—このプロジェクトの一部ではありません。Wiki.jsはAGPL-3.0ライセンスで、このプロジェクトはコードをコピーせず、設計から学んでいます。