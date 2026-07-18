<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# kawaii-wiki.ts サーバー

kawaii-wiki.ts ハンズオンプロジェクトのための Bun + Elysia API サーバー。

## これで学べること

- Elysia を使った型付き HTTP ルート
- 環境変数 -> データベース -> サービス -> アプリへの依存性注入
- Drizzle を使った SQLite バックエンドの永続化
- 保存 -> レンダリング -> リビジョン -> 検索インデックスのトランザクション境界
- ローカル認証、OIDC、TOTP、パスキー、権限、API エッジでのエラー変換
- ページ変更通知のためのサーバー送信イベント（SSE）

## 実行方法

リポジトリのルートから：

```bash
bun install
bun run db:seed
bun run dev:server
```

サーバーはデフォルトで `http://localhost:4000` をリッスンします。

`db:seed` は `admin@example.com` が存在しない場合のみ作成します。シード前に
`KAWAII_WIKI_SEED_ADMIN_PASSWORD` を設定するとその管理者パスワードを指定できます。指定しない場合は
シードコマンドが一時的なランダムパスワードを生成して表示します。

## 本番環境設定

`JWT_SECRET` は各デプロイメントごとに強力でユニークな値を設定してください。これがないと本番環境は起動を拒否します。ローカル開発では省略すると一時的なランダムシークレットが生成され、再起動時にセッションが意図的にリセットされます。

JWT はデフォルトで30日後に期限切れになります。`KAWAII_WIKI_JWT_TTL_SECONDS` は初期セッションの有効期間を設定し、管理者は後で管理画面の「サイトポリシー」から変更可能です。ロール変更やユーザー無効化はリクエストごとにデータベースで再確認されるため、古いトークンでの管理者権限の保持はありません。

`KAWAII_WIKI_PRIVATE`、`KAWAII_WIKI_REGISTRATION`、`KAWAII_WIKI_REQUIRE_EMAIL_VERIFICATION`、`KAWAII_WIKI_REQUIRE_2FA`、`KAWAII_WIKI_JWT_TTL_SECONDS`、`ASSET_MAX_BYTES` は安全なサイトポリシーのための初期設定です。管理者は後でウェブUIから変更可能です。シークレットやインフラ設定は環境変数のみで管理します：`JWT_SECRET`、データベース/ストレージ認証情報、SMTP/OIDC シークレット、ポート、CORS、Webhook SSRF ポリシー、Git リモートなど。

初期の外観設定は環境変数から指定可能です：
`KAWAII_WIKI_SITE_TITLE`、`KAWAII_WIKI_ACCENT_COLOR`（`#rrggbb`形式）、`KAWAII_WIKI_THEME`（`system`、`light`、`dark`）。管理者は後でウェブUIから同じ値を編集できます。カスタムの head HTML/JavaScript は `KAWAII_WIKI_ALLOW_HEAD_INJECTION=true` を設定しない限り無効化されています。カスタムCSSはこの制限を受けません。

管理者の外観設定は Markdown 機能も制御します。絵文字ショートコードはデフォルトで有効、KaTeX 数式と Mermaid 図のレンダリングはオプトインです。ページの書き込みは現在の設定でレンダリングされますが、Mermaid はクライアント側で処理され、無効時はエスケープされたソースにフォールバックします。

ページテンプレートは `page_templates` テーブルに保存され、編集者限定の `/api/templates` CRUD API で公開されます。テンプレートのメタデータは新規ページ作成時にタイトル、パス、ラベル、ステータス、ロケール、レビュー日を事前入力できます。

公開設定にはナビゲーション設定も含まれます：`homePath`、組み込みヘッダーリンクの順序付き `navItems`、カスタムナビゲーション用のグループ化されたアイコン付き `navLinks`。

本番環境でのシード時は `KAWAII_WIKI_SEED_ADMIN_PASSWORD` を設定するか、`db:seed` の出力から生成されたパスワードを控えてください。シードスクリプトは共有のデフォルト管理者パスワードには決してフォールバックしません。

SQLite がデフォルトのデータベースランタイムです：

```bash
DATABASE_DRIVER=sqlite DATABASE_PATH=/data/ts-wiki.sqlite
```

検索は SQLite FTS5 を使用します。デフォルトのトークナイザーは `unicode61` で、英語やヨーロッパ言語の文章には適していますが、日本語やCJKのトークンはプレフィックスのみマッチします。日本語、中国語、韓国語、または混合CJK環境の場合は最初のマイグレーション前に
`KAWAII_WIKI_FTS_TOKENIZER=trigram` を設定してください。

既存のウィキにCJKコンテンツがある場合、管理画面に現在のトークナイザー、CJKコンテンツ比率、保護された「トライグラムでインデックス再構築」アクションが表示されます。再構築前にデータベースのバックアップを必ず取ってください。同じ再構築は CLI からも可能です：

```bash
KAWAII_WIKI_FTS_TOKENIZER=trigram bun --filter '@kawaii-wiki/server' db:reindex-search
```

libSQL/Turso もサポートしています。ローカル libSQL は `file:` URL を使えます。リモート Turso URL はローカルの埋め込みレプリカファイル経由で動作します：

```bash
DATABASE_DRIVER=libsql
LIBSQL_URL=libsql://your-database.turso.io
LIBSQL_AUTH_TOKEN=your-turso-token
# 任意。リモートURLの場合はデフォルトで DATA_DIR/kawaii-wiki.ts-libsql-replica.db を使用。
LIBSQL_REPLICA_PATH=/data/kawaii-wiki.ts-libsql-replica.db
```

パスキー/WebAuthn は本番環境で安定した HTTPS オリジンが必要です：

```bash
KAWAII_WIKI_PUBLIC_ORIGIN=https://wiki.example.com
PASSKEY_RP_ID=wiki.example.com
```

OIDC は `OIDC_ENABLED=true` と単一プロバイダーの発行者/クライアント/リダイレクト設定で有効化できます。複数プロバイダーの場合は番号付きプレフィックス（`OIDC_1_*`、`OIDC_2_*`）か `KAWAII_WIKI_OIDC_PROVIDERS` JSON 配列を使います。詳細は `../../docs/CONFIGURATION.md` を参照してください。

サイトレベルの日付デフォルトは環境変数で設定可能です：`KAWAII_WIKI_DEFAULT_LOCALE`、`KAWAII_WIKI_TIMEZONE`、`KAWAII_WIKI_DATE_FORMAT`。これらは後で管理画面の「外観」から調整できます。新規ページのロケールやイベントカード、クロームのタイムスタンプのサーバー/クライアント日付レンダリングに使われます。

Webhook の配信リトライやキャプチャ制限は以下で設定可能です：
`KAWAII_WIKI_WEBHOOK_MAX_ATTEMPTS`、`KAWAII_WIKI_WEBHOOK_BACKOFF_MS`、`KAWAII_WIKI_WEBHOOK_MAX_RESPONSE_BYTES`、`KAWAII_WIKI_WEBHOOK_MAX_ERROR_BYTES`。
自動化ルールは管理UIで管理し、ページの作成/更新/削除/移動やコメント作成イベントに反応できます。ルールはパス、ラベル、ステータス、作成者、ロケール、スペースでマッチし、優先度順に実行、後続ルールを停止可能で、メタデータ更新、ページのパス移動、カスタムWebhookイベント発火ができます。

アップロードされたアセットはデフォルトでローカルディスクに保存されます。Cloudflare R2 に保存したい場合は `ASSET_STORAGE=r2` と R2 アカウント認証情報を設定すると、同じ `/assets/...` 配信ルートを維持しつつ R2 に保存可能です。`ASSET_MAX_BYTES` はアップロード制限の初期値（デフォルト25MiB）で、管理者が後でサイトポリシーから変更可能です。非画像アセットはダウンロードとして配信されます。

サーバーはビルド済みの Vue アプリを直接配信可能です。ウェブワークスペースをビルドし、デフォルトの `apps/web/dist` 以外の場合は `WEB_DIST_DIR` を設定してください：

```bash
bun run build
WEB_DIST_DIR=/srv/kawaii-wiki.ts/web/dist bun --filter '@kawaii-wiki/server' start
```

同梱の Dockerfile はこれを自動で行います：

```bash
docker build -t kawaii-wiki.ts .
docker run --rm -p 4000:4000 -v kawaii-wiki.ts-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e KAWAII_WIKI_SEED_ADMIN_PASSWORD="change-me-before-first-seed" \
  kawaii-wiki.ts
```

ローカル/開発環境の CORS はデフォルトで許可的です。本番環境ではカンマ区切りの許可リストでブラウザのクロスオリジンアクセスを設定してください：

```bash
KAWAII_WIKI_CORS_ORIGINS=https://wiki.example.com,https://admin.example.com
```

## バックアップと復元

SQLite はオンラインバックアップコマンドでバックアップし、アップロードされたアセットをコピーします：

```bash
mkdir -p backups
sqlite3 data/ts-wiki.sqlite ".backup 'backups/kawaii-wiki.ts-$(date +%F).sqlite'"
rsync -a data/assets/ backups/assets/
```

これらのコマンドはホスト上でバインドマウントされたデータディレクトリに対して実行してください。スリムなランタイムイメージには `sqlite3` が含まれていません。SQLite は WAL モードを使うため、稼働中のデータベースファイルを単純に `cp` しないでください。`.backup` はコミット済みの WAL データを安全に含みます。継続的バックアップには Litestream サイドカーが `/data` を共有し、`/data/ts-wiki.sqlite` を複製できます。最小構成はルートの README を参照してください。

復元するにはサーバーを停止し、`DATABASE_PATH` をバックアップファイルに置き換え、アセットディレクトリを `DATA_DIR` 配下に戻してからサーバーを起動します。Git ミラーは完全なバックアップではありません。ユーザー、ロール、アセット、リビジョン、検索状態は SQLite に保存されているためです。

イメージバージョンを変更する前に `../../docs/UPGRADING.md` を参照してください。起動時のマイグレーションは原子性がありバージョン管理されています。ロールバックは古いイメージで新しいスキーマに対して動かすのではなく、アップグレード前のバックアップを復元して以前のイメージを使います。

## 可観測性

HTTP アプリは処理したリクエストごとに構造化された JSON リクエストログと、認証、ページ書き込み、管理者ロール変更、アセットアップロード、Git 同期、共同編集の自動保存などの変更操作に対する監査イベントを出力します。ログは stdout/stderr に書き込まれるため、Docker、systemd、またはホストされたログパイプラインがエージェントなしで収集可能です。

## 便利なコマンド

```bash
bun --filter '@kawaii-wiki/server' db:migrate
bun --filter '@kawaii-wiki/server' db:reindex-search
bun --filter '@kawaii-wiki/server' db:seed
bun --filter '@kawaii-wiki/server' db:reset
bun --filter '@kawaii-wiki/server' typecheck
bun test apps/server
```

## 最初に読むべきファイル

| ファイル | 重要な理由 |
| --- | --- |
| `src/index.ts` | 環境変数とDBセットアップから実行中のサーバーを作る |
| `src/http/app.ts` | ルート構成とHTTPエラー変換 |
| `src/observability/logging.ts` | 構造化されたリクエスト/監査ログ |
| `src/services/pages.ts` | トランザクション付きページ書き込みとFTS更新 |
| `src/services/oidc.ts` / `src/services/passkeys.ts` | 外部ログインとWebAuthn認証 |
| `src/services/authz.ts` | グループ、メンバーシップ、ページルール |
| `src/services/webhooks.ts` | 署名付きWebhook、配信履歴、自動化ルール |
| `src/db/schema.ts` | SQLite テーブルとリレーション |
| `src/db/migrate.ts` | ローカルスキーマセットアップ（FTS5含む） |

## 演習課題

1. 最近のページリビジョンを返すルートを追加する。
2. `@kawaii-wiki/core` に権限ルールを追加し、サービスでそれを適用する。
3. イベントバスをメモリモードとデータベースモードで切り替え、SSEの挙動を観察する。
4. サービスメソッドを変更する前に新しいサーバーテストを追加する。