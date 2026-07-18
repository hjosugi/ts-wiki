<!-- i18n: language-switcher -->
[English](HANDOFF.md) | [日本語](HANDOFF.ja.md)

# kawaii-wiki.ts — 引き継ぎ資料 / Handoff

次にこれを引き継ぐ人（人間でもAIでも）向けの実践的ガイドです。ユーザー向けの概要は
[../README.md](../README.md) にあります。このドキュメントは**開発者向けの引き継ぎ資料**であり、
現在の状況、なぜそうなっているのか、問題点、そして次の機能をどこに組み込むかを正確に示しています。

- **時点:** 2026-07-11
- **状態:** v0.5.0 — 小規模ながら*完全かつ検証済み*の垂直スライス。以下の✅が付いた項目は
  すべて実行・確認済み（テスト＋ライブHTTP＋型付きクライアント＋ビルド＋型チェック）。
- **スタック:** Bun 1.3 · Elysia · Drizzle ORM · SQLite/libSQL + FTS5 · Vue 3 · Vite ·
  UnoCSS · Pinia · CodeMirror 6 · Eden Treaty · SimpleWebAuthn（コード生成なし）。

---

## 1. 現状の概要

| 領域 | 状態 | 備考 |
|---|---|---|
| Monorepo + Bunワークスペース | ✅ | `packages/*`、`apps/*`；ルートスクリプトは `bun --filter` で制御 |
| `@kawaii-wiki/core`（純粋ドメイン） | ✅ | Result, errors, slug, permissions, markdown+TOC/link抽出、レンダラープラグインの継ぎ目、検証、共有の公開設定/認証プロバイダ契約 |
| DBスキーマ + FTS5マイグレーション | ✅ | SQLiteデフォルト＋libSQL/Turso埋め込みレプリカ対応 |
| ページサービス（CRUD） | ✅ | トランザクション処理：レンダー＋リビジョン＋FTSインデックスを一括処理 |
| 検索サービス（FTS5/BM25） | ✅ | 重み付けカラム、スニペット、プレフィックスクエリ対応 |
| ユーザー + 認証 | ✅ | 初回 `/setup`、ローカルパスワード、有効期限付き/取り消し可能JWT、汎用認証プロバイダレジストリ（OIDC実装あり）、TOTP＋ワンタイムリカバリーコード、パスキー、プライベートモード；初期アカウントは管理者にフォールバック |
| グループ + ページルール | ✅ | 役割デフォルトグループ、メンバーシップ、パスACLルール、拒否優先 |
| アセットアップロード | ✅ | ローカルまたはR2バイト、DBメタデータ、アップロード/ピッカーUI、ロゴ/ファビコン再利用 |
| Elysia HTTPアプリ + Eden型 | ✅ | `App`をエクスポート；エラーマッピングは集中管理 |
| Vueアプリ：閲覧/編集/検索/グラフ/ログイン | ✅ | パンくずリスト、ページヘッダーアクションとインサイト、ページアイコン/カバー、デスクトップツリーサイドバー＋モバイルドロワー、キーボード操作可能なグラフビュー、空状態、ランタイムブランディング |
| Markdownエディタ（CodeMirror + ビジュアルモード） | ✅ | Markdownは正統；ビジュアルモードは一般的なブロックを往復可能 |
| Webhook + 自動化 | ✅ | 署名付き配信、リトライ履歴、優先度/条件/アクション付きイベント自動化ルール |
| サイト設定 | ✅ | ランタイムブランディング、テーマプリセット/フォント/背景、ナビ設定、日次ノートパス、サイトポリシー、デフォルトロケール/タイムゾーン/日付形式、Webhookリトライポリシー、共有の `PublicSettings` 形状 |
| テスト / 型チェック / ビルド | ✅ | core/server Bunテスト、サービス直接カバレッジ、web Vitestテスト；3パッケージすべて型チェック済み；webビルド |
| モバイルシェル | ✅ | コンパクトヘッダー、タッチで見えるコマンドパレットトリガー、フォーカスマネージドナビゲーションドロワー、`xl`以下で折りたたみ可能なページTOC、全高モバイルエディタのWrite/Previewペイン |
| アクセシビリティシェル | ✅ | コンテンツへスキップリンク、ナビ後のフォーカスされたメインランドマーク、可視フォーカスリング、ラベル付きコントロール、モーション軽減対応、スケルトンローディング状態、ダイアログセマンティクス、Escape処理、アプリモーダルのフォーカストラップ/復元 |
| ルーターの認証ガード | ✅ | グローバルルーターガードで編集者/管理者ルートを制御 |

### リリースバッチで検証済み（証拠）
- `bun run test` は core/server Bunテストと web Vitestのコンポーネント/コンポーザブルテストを実行。
- 専用サービステストはパスキー成功/リプレイパス、認可ポリシー組み立て、検索クエリ構築、設定検証、コメント、アセット、ユーザー、分析、Webhook配信リトライ状態をカバー。
- ライブAPIスモークテストは登録/ログイン、権限失敗、パス正規化、保存時レンダー、検索、更新時再インデックス、移動、削除、SSE、WebSocket認証、アセットをカバー。
- Eden Treatyクライアントはすべてのリクエスト形状（`get`/`post`/`put`/`delete` + query/body）を実際のサーバー `App` 型と照合。
- `bun run typecheck`、`bun run build`、Dockerビルド、Dockerスモークはリリースチェックの一部。

---

## 2. アーキテクチャの決定（理由）

ユーザーと事前に明示的に選択した3つ：

1. **SQLite + FTS5**（Postgresではない）。ゼロセットアップで高速、BM25＋重み付けカラムは開始に十分な「リッチさ」。
   Drizzleは後でPostgresが必要になってもスキーマを移植可能に保つ。
2. **Elysia + Eden Treaty**（GraphQLではない）。ルート定義が契約そのものであり、型は**コード生成なし**でVueアプリに届く。
   Apolloより軽量かつ高速にビルド可能。
3. **Lean Vue**（Quasarではない）。Wiki.jsのVueから*ロジック*を移植（レンダラー、ブロックのアイデア、ストア）しつつ、
   新しいモダンなUnoCSSデザイン。バンドルは小さく、デザイン制御は完全。

横断的な原則（ユーザーが求めた「FP寄りアーキテクチャ」）：

- **依存は内向きに向ける。** `@kawaii-wiki/core` はI/Oもグローバルもなし。`apps/web` と `apps/server` は core に依存し、互いには依存しない（サーバーの*型*（Eden）は例外）。
- **純粋なコア、効果は端に。** レンダリング/スラッグ/検証/権限は純粋関数。
- **例外より `Result<T, E>`。** サービスは結果を返す。`apps/server/src/http/errors.ts` の (`unwrap` + `onError`) が唯一のエラー→HTTP境界。
- **DI、シングルトンではない。** `createDb()` → `createServices(db)` → `createApp({ db, env })`。
  これはWiki.jsのグローバル可変 `WIKI` オブジェクトへの意図的な対抗策。テストは `:memory:` DBを注入。
- **原子保存。** ページ書き込みはMarkdownレンダー、履歴スナップショット、検索インデックス更新を1トランザクション内で行う（`apps/server/src/services/pages.ts`）。
  呼び出しが返る時点でページはレンダー済みかつ検索可能。

---

## 3. 拡張時に守るべき慣習

> これらを守ることでコードベースの一貫性を保つ。

- **新しい純粋ドメインロジックは `@kawaii-wiki/core` に入れ、単体テストを書く。** DBやネットワークに触れるなら*サービス*。
- **サービスはファクトリー：** `createXService(db) => { ...methods }`。期待される失敗（検証/権限/競合/未発見）は `Result<T, AppError>` で返し、例外は投げない。
- **複数行の書き込みはすべて `db.transaction(...)` に入れる。** 検索に影響する場合は同一トランザクション内で `pages_fts` を更新（`pages.ts` の `reindex()` 参照）。
- **権限：** `Action` にアクションを追加し、役割→アクションマトリックスに登録。サービスメソッドの先頭で `can(principal, action)` を呼ぶ。チェックを散らさない。
- **HTTPハンドラーは薄く保つ：** Elysiaの `t.*` で検証し、サービスを呼び、Resultを `unwrap()` し、プレーンデータを返す。新しいエラー種は `packages/core/src/errors.ts` と `httpStatus()` に追加。
- **ページパスはクエリパラメータ**（`/api/page?path=...`）で、ルートセグメントではない。wikiパスはスラッシュを含むため。Edenクライアントもこれに合わせている。
- **WebクライアントはAPI形状を `apps/web/src/lib/api.ts` に集中管理。** 共有契約（`PublicSettings`、`PublicAuthProvider`）は `@kawaii-wiki/core` 由来。新メソッドはこのファイルに追加し、コンポーネントやストアは `treaty` を直接呼ばない。

---

## 4. 既に遭遇した落とし穴（再発見しないように）

1. **Edenの `delete` は `(body, options)` を取る** — クエリは*第2引数*：`client().api.page.delete(null, { query: { path } })`。
   `delete({ query })` は静かに422になる。
2. **Eden + グローバル `onError` はエラーボディを各ルートの成功型にユニオンする。** そのため `res.data.page` は狭められない。
   これを `api.ts` で呼び出しごとに成功形状を `call<T>()` で明示し局所化。*リクエスト*（path/query/body）は完全に型チェックされるので安全。
3. **ルートの `bun test` は無関係なテストも拾う。** ルートの `test` スクリプトは `bun test packages apps/server && bun --filter '@kawaii-wiki/web' test` に限定。webのSFCテストはVitestで行い、ルートスクリプトを単純な `bun test` に戻さない。
4. **自動説明は更新時に再生成が必要。** 古い自動要約を引き継ぐと検索インデックスに古い語句が残る。`pages.update` は `description: patch.description`（undefinedなら新内容から再要約）を渡す。コメント参照。
5. **`author_id` はソフトリファレンスでFKではない。** トークンは毎リクエストでユーザーロウと再検証されるが、過去のページ/リビジョンはユーザー削除後も残る必要がある。単なるカラム（`schema.ts`/`migrate.ts`に記載）。
6. **スラッグは許可リスト方式**（`[^\p{L}\p{N}]+ → -`）で、日本語/Unicodeを生かし、任意の句読点を均一に処理。ASCIIに「簡略化」しない。
7. **FTS5トークナイザーとCJK。** デフォルトの `unicode61` は日本語を分割しない。CJK多用コンテンツは最初のマイグレーション前に `KAWAII_WIKI_FTS_TOKENIZER=trigram` を設定。既存DBはバックアップ後に `KAWAII_WIKI_FTS_TOKENIZER=trigram bun run db:reindex-search` を実行。
8. **drizzle-kitは使わない。** DDL（FTS5仮想テーブル含む）は手書きで `migrate.ts` にあり、`schema.ts` と同期が必要。後でdrizzle-kit導入は可能だがFTS5は手動マイグレーションが必要。
9. **バックアップはSQLite優先。** `data/ts-wiki.sqlite` は `.backup` を使い、`data/assets/` はコピー。Gitミラーはコンテンツミラーで完全なシステムバックアップではない。
10. **構造化ログは標準出力JSON＋任意のDB監査行。** リクエストログはメソッド/パス/ステータス/時間/IP/ユーザーをカバー。監査ログは認証、ページ/管理変更、アセットアップロード、Git同期、コラボ自動保存をカバー。`KAWAII_WIKI_AUDIT_DB=false` で標準出力のみモード。
11. **リアルタイム認証分離。** SSEとYjsコラボはトークン必須。パブリックモードではプレゼンスは装飾的だが、プライベートモードはソケットオープン前に有効トークンが必要。
12. **カスタムhead HTMLは2段階で制御。** サーバーは `KAWAII_WIKI_ALLOW_HEAD_INJECTION=true` でない限り保存済み `customHeadHtml` を抑制。webアプリは信頼済み `<script>` タグを再生成し、解析スニペットを実行可能にする。管理者信頼コードとして扱い、ユーザーコンテンツではない。
13. **サイトの日付設定は両レンダラーに供給。** 管理者設定と `KAWAII_WIKI_DEFAULT_LOCALE` / `KAWAII_WIKI_TIMEZONE` / `KAWAII_WIKI_DATE_FORMAT` はサーバーの保存時レンダーとブラウザプレビューに影響。新しい表示デフォルト追加時は `markdownEnhance.ts`、`i18n.ts`、`createServices()` を同期。

---

## 5. ロードマップ — 次のステップ（優先順）

2026-06-14以降のプロダクト方針：**ストレージ/検索の幅より日常の使いやすさと再利用可能なUIコンポーネントを優先。**
SQLite + FTS5 と現在のストレージモデルはシンプルに保ち、wikiの閲覧、作成、編集、再編成、ミスからの復旧が快適になるまで磨く。
カレンダー/イベントワークフローは優先領域：会議メモ、プロジェクトイベント、ローンチ日、締切、埋め込みスケジュールをページに簡単に貼り付け、実際のカレンダーに送りやすくする。

参考にすべきパターン：
- **BookStack** (`https://www.bookstackapp.com/`)：ページリビジョン、画像管理、シンプルなコンテンツ整理がコアUX。
- **Outline** (`https://www.getoutline.com/`)：高速なドキュメント/コレクションワークフロー、素早い作成、ドキュメント単位の共有がバックエンドの多様性より重要。
- **Docusaurus** (`https://docusaurus.io/docs/sidebar`)：生成されたサイドバー/カテゴリと予測可能なドキュメントナビゲーションで大規模ドキュメントも手間なくナビ可能。
- **Wiki.js** (`https://docs.requarks.io/`)：構造化されたページツリーナビゲーション、アセット、エディター、ページ管理が日常的にユーザーが触れる実用的な表面。

各項目は**どこに組み込むか**を示す。

**高価値・低労力**
- [x] **貼り付け可能なカレンダーイベントカード** — Markdownフェンスに `event` 情報文字列を付けると
      `wiki-event-card` としてタイトル、時間、タイムゾーン、場所、URL、説明、Googleカレンダーテンプレートリンク、ダウンロード可能な `.ics` をレンダー。
      `MarkdownEditor.vue` に `Event` スニペットボタンあり。
      これは最初のカレンダー垂直スライスでOAuth不要。
- [x] **グラフビュー** — coreの `extractPageLinks()` は `[[Wiki Links]]` と内部Markdownリンクを処理；
      `pages.graph()` はページ/欠損ノード＋エッジを返す；`GET /api/graph`；
      再利用可能な `InteractiveGraph.vue` はObsidian風フォースグラフでズーム、パン、ノードドラッグ、ローカル/グローバルモード、深さ、欠損ノード切替、リンク次数によるノードサイズ調整を提供。
      `PageView.vue` は右側レールにコンパクトなローカルグラフを表示；
      `GraphView.vue` は全体グラフを表示。
- [x] **リーダークロームコンポーネント** — `PageHeader`、`WikiBreadcrumbs`、`PageTree`、`EmptyState` を追加；
      ページビューにコピー・パス、編集、新規子ページ、更新日時メタデータ、API変更なしの構造化サイドバーを追加。
- [x] **ページ名変更 / 移動** — `pages.ts` の `move(oldPath, newPath, principal)`；`POST /api/page/move`；
      `Api.movePage()`；`PageEdit.vue` で編集可能なパス；
      テストはパス正規化、FTS保持、競合拒否をカバー。
- [x] **ページ履歴UI** — `pages.history()`、`/api/page/history`、`Api.history()`、`HistoryView.vue` でリビジョン閲覧、差分表示、リビジョン復元を提供。
- [x] **アセット画像UI** — `MarkdownEditor.vue` はアップロードボタン、ドラッグ＆ドロップ、画像貼り付けアップロード、既存アセット閲覧用の `AssetPicker.vue` をサポート。
- [x] **エディターの使い勝手** — ツールバーは見出し/太字/リンク/コード/表/イベント/アセットボタンをカバーし、画像貼り付け対応、`.ics` インポート、未保存変更警告、保存状態を `MarkdownEditor.vue` / `PageEdit.vue` に表示。
- [x] **カレンダーのインポート/エクスポートUX** — `.ics` パースは `@kawaii-wiki/core` にあり、エディターは `.ics` イベントを `event` フェンスにインポート可能、レンダーされたイベントカードはダウンロード可能な `.ics` をエクスポート。
- [x] **クイックスイッチャー / コマンドパレット** — `CommandPalette.vue` はキーボード主体の検索、ページジャンプ、新規ページ作成、共通ナビゲーションアクションをサポート。
- [x] **テンプレート / スターターページ** — `_new` は空白、意思決定、ハウツー、会議メモ、仕様、永続カスタムテンプレートを事前入力可能。エディターは `/_templates` でテンプレート管理可能、管理者は管理画面にもアクセス可能、`PageEdit.vue` は現在ページを再利用可能テンプレートとして保存可能。会議メモはブラウザのタイムゾーンを使用。
- [x] **グローバルルーター認証ガード** — `router.beforeEach` で管理者/編集ルートを制御し、ログイン時にリダイレクトクエリを保持。
- [x] **ランタイムブランディングとテーマレイヤー** — 管理画面の外観でサイトタイトル、アクセントカラー、ライト/ダーク/システムデフォルト、ロゴ、ファビコン、フッターテキスト/リンク、カスタムCSS、制限付きカスタムhead HTMLを制御。
  CSS変数（`--c-bg`、`--c-surface`、`--c-text`、`--c-border`、`--c-accent`、`--radius`）がアプリクロームとレンダーブロックを駆動。
- [x] **設定コントロール** — 安全なサイトポリシー設定（登録、プライベートwikiモード、メール/2FA必須、セッション寿命、アップロード制限）を環境変数から初期化し、後に管理画面で管理可能。
  複数OIDCプロバイダは `KAWAII_WIKI_OIDC_PROVIDERS` JSONまたは番号付き `OIDC_1_*` プレフィックスで指定可能。
  サイトのロケール/タイムゾーン/日付形式デフォルトはページロケールとレンダリング日付に反映。
  Webhookリトライ試行/バックオフ/ボディ/エラー制限は環境変数で設定可能。
- [x] **自動化拡張** — ルールはトリガー/条件/アクションを使い、ページ作成/更新/削除/移動とコメント作成トリガー、パス/ラベル/ステータス/作成者/ロケール/スペース条件、優先度＋マッチ時停止、ラベル/ステータス/レビュー日付変更、パス下移動、カスタムWebhookイベント発火アクションをサポート。

**中規模**
- [x] **イベント抽出 + イベントインデックス** — `pages.events()` と `/api/events/index` はページ全体のイベントフェンスを抽出；
      `EventsView.vue` は今後/過去イベントをページリンクと `.ics` 付きで表示。
- [x] **Googleカレンダー連携（OAuthなし）** — イベントカードにGoogleカレンダーテンプレートリンクと `.ics` のインポート/エクスポートを含む。
      OAuthカレンダー操作はスリムコアの範囲外。`docs/ISSUE_RESOLUTION.md` 参照。
- [x] **バックリンク + ページビューのリンク言及** — `pages.backlinks()`、`/api/page/backlinks`、`PageView.vue` はリーダービューに直接受信リンクを表示。
- [x] **ナビゲーション管理** — ヘッダー/ルートナビは公開設定（`homePath`、組み込みナビの表示/順序、グループ化されたカスタムナビリンク）で設定可能。
      ページメタデータは共有サイドバーピン/手動順序をサポートし、認証ユーザーはサーバー管理のスター付きページ、折りたたみフォルダ、個人サイドバー順序を持つ。
- [x] **Markdownプラグイン / 型付きブロック** — `packages/core/src/markdown.ts` は安全なコールアウト、埋め込み、イベント、インフォボックス/プロフィール、リンク/ソーシャル、コンテンツタブ、Mermaidソースフェンスをサポート。
      `createRenderer({ features, plugins, fences })` と `registerFenceRenderer()` はサーバーレンダーとライブプレビューで共有。
      絵文字ショートコードはデフォルト有効；KaTeX数式とMermaidレンダーは管理者オプトイン。
- [x] **「ブロック」**（Wiki.jsのベストアイデア） — 現在の型付きフェンスアプローチは便利な軽量サブセットをカバーし、まだフレームワーク固有のカスタム要素は導入していない。
- [x] **役割/権限UI + ユーザー管理** — 管理者ユーザー、役割変更、デフォルトグループ、グループメンバーシップ管理、ページパスルールを実装済み。
- [x] **本番Webサーブ** — Elysiaは `/ui` 下に `apps/web/dist` を配信し、Dockerfileは単一の本番イメージをビルド。

**大規模 / 後回し**
- [x] OAuth/OIDC戦略 — 汎用かつ複数プロバイダのOIDC設定、ログイン開始/コールバック、アカウント連携、登録制御、ドメイン許可リストを実装済み。
- [x] コメント — ページコメント（メンション、解決/更新/削除）、Webhookイベントを実装済み。
- [ ] タグ、多サイト、i18n、SSR。
- [ ] **Rustバックエンド検索アダプター。** SQLite FTS5をデフォルトの埋め込みエンジンとして維持。
      `SearchIndexer` インターフェースは存在し、将来の切り替えでページ/コメント/アセット書き込みパスがFTS5詳細を知る必要なし。
      最良の外部オプションは
      **Meilisearch** (`https://www.meilisearch.com/docs/getting_started/overview`)：Rust製、誤字許容、タイプ中検索UX。
      **Tantivy** (`https://github.com/quickwit-oss/tantivy`) は低レベルのRust/Luceneスタイルライブラリで、インデクサーを自前で持ちたい場合。
      **Quickwit** (`https://quickwit.io/`) は大規模/ログ検索向けで、コンテンツ量が大幅に増えるまで過剰。
      SQLite FTS5トライグラム (`https://sqlite.org/fts5.html`) はCJK/部分文字列マッチングの最小アップグレード。
      誤字訂正は外部アダプターに意図的に委ねる。

---

## 6. ファイルマップ（配置場所）

```
packages/core/src/
  result.ts        Result<T,E>, ok/err, map/flatMap/...        (純粋)
  errors.ts        AppError ユニオン + httpStatus()           (純粋)
  slug.ts          normalizePath / slugifyHeading (Unicode)    (純粋)
  permissions.ts   Role, Action, can()                         (純粋)
  markdown.ts      createRenderer(), registerFenceRenderer(), renderMarkdown() → {html, toc},
                   型付きフェンス、extractPageLinks(), toPlainText
  frontmatter.ts   Markdownファイルの解析/シリアライズ/パスマッピングヘルパー
  page.ts          validatePageInput()                         (純粋)
  core.test.ts     上記全ての単体テスト

apps/server/src/
  env.ts           型付き設定（loadEnv）
  db/
    schema.ts      Drizzleテーブル + 推論型
    migrate.ts     DDL（FTS5含む）＋ `bun src/db/migrate.ts`；トークナイザーは KAWAII_WIKI_FTS_TOKENIZER 由来
    client.ts      createDb() — SQLite/libSQL + drizzle、FTSの生クライアント `$client` を公開
    seed.ts        管理者＋サンプルページ   (`bun run db:seed`)
    reset.ts       DBファイル削除          (`bun run db:reset`)
  services/
    pages.ts       作成/更新/移動/削除/取得/一覧/グラフ — トランザクションコア
    search.ts      SearchIndexer 継ぎ目 + FTS5 クエリ/インデックス実装
    users.ts       カウント/検索/作成
    assets.ts      記録/一覧
    settings.ts    公開外観設定；カスタムCSSと制限付きカスタムhead HTML
    templates.ts   永続カスタムページテンプレートCRUD
    auth.ts        hashPassword/verifyPassword (Bun.password)
    index.ts       createServices(db) — コンポジションルート
  http/
    app.ts         createApp({db,env}) → Elysia；**Eden用に `App` 型をエクスポート**
    routes/templates.ts エディター制限ページテンプレートAPI
    errors.ts      HttpError, unwrap(), toErrorResponse()
  index.ts         エントリ：env → db → app.listen
  server.test.ts   インメモリDB統合テスト（作成/検索/更新/削除/権限）

apps/web/src/
  lib/api.ts       Eden Treatyクライアント + Api.* メソッド（treatyを使う唯一の場所）
  lib/branding.ts  ランタイムタイトル/ファビコン/カスタムCSS/カスタムhead HTML適用
  lib/i18n.ts      EN/JAメッセージカタログ + 日付/時間フォーマット設定
  lib/markdownEnhance.ts  コードコピー、KaTeX CSS、Mermaidレンダー、コンテンツタブ強化
  lib/pageTemplates.ts  組み込みスターターテンプレート + 永続テンプレートヘルパー
  lib/realtime.ts  SSE/WebSocketクライアントヘルパー
  composables/     useSearch, useTheme, useMarkdownFeatures, usePresence, useForceGraph, reduced motion
  stores/          auth.ts, pages.ts (Pinia)
  router/index.ts  ルート（/_login /_search /_graph /_new /_edit/:path /:path）＋ paramToPath()
  components/      AppHeader.vue, AppFooter.vue, MarkdownEditor.vue, InteractiveGraph.vue,
                   PageHeader.vue, PageTree.vue, PageTemplatesPanel.vue, WikiBreadcrumbs.vue,
                   PageComments.vue, PageToc.vue, CommandPalette.vue, VisualEditor.vue,
                   CollabEditor.vue, AssetPicker.vue, ImageUploadDialog.vue, ModalDialog.vue,
                   DrawerSheet.vue, EmptyState.vue, Skeleton.vue, ShortcutsHelp.vue
  components/admin/ AdminStatsPanel, AdminPagesPanel, AdminAppearancePanel, AdminPolicyPanel,
                   AdminSecurityPanel, AdminUsersPanel, AdminGroupsPanel, AdminPageRulesPanel,
                   AdminWebhook*, AdminAutomationPanel, AdminAssetsPanel, AdminTrashPanel
  views/           AdminView.vue, PageView.vue, PageEdit.vue, PageTemplatesView.vue,
                   SearchView.vue, GraphView.vue, EventsView.vue, ChangesView.vue,
                   LinksView.vue, TagsView.vue, LoginView.vue, SetupView.vue,
                   SharedPageView.vue, UserProfileView.vue
  main.ts, App.vue, app.css, uno.config.ts, vite.config.ts

docs/
  KAWAII_WIKI_DESIGN_RFC.md   kawaii/pop/game-wikiの製品/デザイン方針
  INLINE_COMMENTS_RFC.md      ブロック/見出しアンカー付きコメントの決定
  LIVE_PREVIEW_EDITOR_SPIKE.md オプションのCodeMirrorライブプレビューエディタ試作
```

リリースで新しいトップレベルモジュール、大きなコンポーネント、ドキュメントが追加されたら
`rg --files packages/core/src apps/server/src apps/web/src docs` でこのマップを最新化してください。

---

## 7. 拡張レシピ

**APIエンドポイント追加** → サービスメソッド追加（`Result`を返す）→ `http/app.ts` にルート追加（`t.*`スキーマ、`unwrap()`）、
単一チェインインスタンスを保ちEdenの `App` 型を更新 → `web/src/lib/api.ts` に `Api.*` ラッパー追加 → ストア/ビューから使用。

**新エンティティ追加** → `db/schema.ts` にテーブル追加 → `db/migrate.ts` に対応DDL追加 → `services/` に `createXService` → `services/index.ts` に登録 → `http/app.ts` にルート追加。

**権限追加** → `core/permissions.ts` の `Action` とマトリックス拡張 → サービスメソッドで `can(principal, action)` 呼び出し。

**Markdown機能追加** → ブロック形状の構文なら `registerFenceRenderer('name', render)` で型付きフェンスレンダラー推奨、
孤立したmarkdown-it実験/テストは `createRenderer({ plugins })`。
パイプラインは等価なのでサーバーの保存時レンダーとエディターのライブプレビューで同じコア動作を共有。

---

## 8. 実行方法

```bash
bun install
bun run db:seed     # admin@example.com / password  + サンプルページ
bun run dev         # サーバー :4000 + web :5180
bun run test        # core/server Bunテスト + web Vitestテスト
bun run typecheck   # すべてのワークスペース
bun run build       # web本番ビルド
```

参考リポジトリは `reference/` 下にあり（`wiki-main` v2、`wiki-vega` v3）、gitignoreされているため
ローカル学習用のみです。