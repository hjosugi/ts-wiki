<!-- i18n: language-switcher -->
[English](CONFIGURATION.md) | [日本語](CONFIGURATION.ja.md)

# 設定リファレンス

サーバーは起動時に環境変数を読み込みます。**bootstrap** とマークされた値は初回セットアップ時にデータベースを初期化し、その後は管理画面で変更可能です。シークレットやインフラ関連の値は環境変数のみで管理されます。`KAWAII_WIKI_*` が推奨されるプレフィックスで、レガシーの `TS_WIKI_*` エイリアスも1.x系では引き続き使用可能です。

## コアとデータベース

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `PORT` | `4000` | HTTPリッスンポート |
| `NODE_ENV` | 未設定 | デプロイ時は `production` を使用 |
| `JWT_SECRET` | 本番環境以外はプロセスごとにランダム | 本番環境で必須。少なくとも32バイトのランダム値を使用。公式Dockerイメージは省略時に `/data/.jwt-secret` に生成・保存します。 |
| `KAWAII_WIKI_JWT_SECRET_FILE` | Dockerでは `/data/.jwt-secret` | `JWT_SECRET` が省略された場合にDockerエントリポイントが使用するファイル |
| `DATA_DIR` | `./data` | ランタイムファイルとローカルアセット |
| `WEB_DIST_DIR` | `apps/web/dist` | ビルド済みSPAのディレクトリ |
| `DATABASE_DRIVER` | `sqlite` | `sqlite` または `libsql` |
| `DATABASE_PATH` | `DATA_DIR/ts-wiki.sqlite` | SQLiteファイルのパス |
| `LIBSQL_URL` | 未設定 | ローカルまたはリモートのlibSQL URL |
| `LIBSQL_AUTH_TOKEN` | 未設定 | リモートlibSQLの認証トークン |
| `LIBSQL_REPLICA_PATH` | `DATA_DIR` 配下 | 埋め込みレプリカファイル |
| `KAWAII_WIKI_FTS_TOKENIZER` | `unicode61` | `unicode61` または `trigram`。既存のインデックスを変更する前にバックアップ推奨 |

## 認証とポリシー

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `KAWAII_WIKI_PUBLIC_ORIGIN` | ローカルサーバーのURL | リダイレクトやパスキー用のHTTPS公開オリジン |
| `PASSKEY_RP_ID` | public-originのホスト名 | WebAuthnのリライイングパーティID |
| `KAWAII_WIKI_SITE_NAME` | `kawaii-wiki.ts` | 認証発行者・表示名 |
| `KAWAII_WIKI_PRIVATE` | `false` | **Bootstrap:** ウィキの閲覧にログインを必須にする |
| `KAWAII_WIKI_REGISTRATION` | `open` | **Bootstrap:** `open` または `off` |
| `KAWAII_WIKI_REQUIRE_EMAIL_VERIFICATION` | `false` | **Bootstrap:** ログイン前にローカルメールの検証を要求 |
| `KAWAII_WIKI_REQUIRE_2FA` | `false` | **Bootstrap:** TOTPまたはパスキーを必須にする |
| `KAWAII_WIKI_JWT_TTL_SECONDS` | `2592000` | **Bootstrap:** セッションの有効期限（秒） |
| `KAWAII_WIKI_SEED_ADMIN_PASSWORD` | 生成される | `db:seed` でのみ使用される任意のパスワード |

OIDCは `OIDC_ENABLED`、`OIDC_PROVIDER_ID`、`OIDC_PROVIDER_LABEL`、`OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_REDIRECT_URI`、`OIDC_SCOPES`、`OIDC_ALLOW_REGISTRATION`、`OIDC_EMAIL_DOMAINS`、`OIDC_DEFAULT_ROLE` をサポートします。これらは `OIDC_1_*`、`OIDC_2_*` のように繰り返すか、JSON配列 `KAWAII_WIKI_OIDC_PROVIDERS` を使用してください。

## メール

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `SMTP_URL` | 未設定 | SMTP接続URL。検証メールやリカバリメール送信に必須 |
| `SMTP_FROM` | サイト由来のアドレス | RFC 5322のFromヘッダー値 |
| `KAWAII_WIKI_SMTP_TIMEOUT_MS` | `10000` | SMTP操作のタイムアウト（ミリ秒） |

## アセット、ネットワーク、Webhook

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `ASSET_MAX_BYTES` | `26214400` | **Bootstrap:** アップロード制限サイズ（バイト） |
| `ASSET_STORAGE` | `local` | `local` または `r2` |
| `ASSET_PUBLIC_BASE_URL` | 未設定 | 外部アセットのURLプレフィックス（任意） |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | 未設定 | R2の認証情報とバケット名 |
| `R2_ENDPOINT` | Cloudflareのエンドポイント | S3互換のエンドポイント（任意） |
| `KAWAII_WIKI_CORS_ORIGINS` | 本番環境では同一オリジン | カンマ区切りの許可ブラウザオリジン |
| `KAWAII_WIKI_TRUST_PROXY_HEADERS` | `false` | 信頼できるプロキシの背後でのみ転送ヘッダーを信頼 |
| `KAWAII_WIKI_WEBHOOK_ALLOW_PRIVATE` | `false` | プライベート/リンクローカルのWebhookターゲットを許可。信頼できるネットワーク外では危険 |
| `KAWAII_WIKI_WEBHOOK_MAX_ATTEMPTS` | `3` | 配信試行回数 |
| `KAWAII_WIKI_WEBHOOK_BACKOFF_MS` | `60000,120000,240000,480000,900000` | リトライ間隔（ミリ秒） |
| `KAWAII_WIKI_WEBHOOK_MAX_RESPONSE_BYTES` | `2000` | 保存されるレスポンスの先頭バイト数 |
| `KAWAII_WIKI_WEBHOOK_MAX_ERROR_BYTES` | `1000` | 保存されるエラーの先頭バイト数 |

## 外観、監査、リアルタイム、Git

外観のbootstrap変数は `KAWAII_WIKI_SITE_TITLE`、`KAWAII_WIKI_ACCENT_COLOR`、`KAWAII_WIKI_THEME`、`KAWAII_WIKI_ALLOW_HEAD_INJECTION`、`KAWAII_WIKI_DEFAULT_LOCALE`、`KAWAII_WIKI_TIMEZONE`、`KAWAII_WIKI_DATE_FORMAT` です。

監査の保持期間は `KAWAII_WIKI_AUDIT_DB`、`KAWAII_WIKI_AUDIT_RETENTION_DAYS`、`KAWAII_WIKI_AUDIT_MAX_ROWS` を使用します。マルチインスタンスのリアルタイムは `KAWAII_WIKI_EVENT_BUS`、`KAWAII_WIKI_INSTANCE_ID`、`KAWAII_WIKI_EVENT_POLL_MS` を使用します。

Gitミラーリングは `KAWAII_WIKI_GIT_ENABLED`、`KAWAII_WIKI_GIT_DIR`、`KAWAII_WIKI_GIT_BRANCH`、`KAWAII_WIKI_GIT_REMOTE`、`KAWAII_WIKI_GIT_REMOTE_URL`、`KAWAII_WIKI_GIT_SOURCE_OF_TRUTH`、`KAWAII_WIKI_GIT_AUTHOR_NAME`、`KAWAII_WIKI_GIT_AUTHOR_EMAIL`、`KAWAII_WIKI_GIT_SYNC_INTERVAL_MS` を使用します。デフォルトではGitはコンテンツのミラーです。リモートリポジトリを正本とする場合は `KAWAII_WIKI_GIT_SOURCE_OF_TRUTH=true` を設定してください。この場合、起動時にGitを待機し、追跡されたMarkdownをインポートし、リポジトリに存在しないアクティブなデータベースページを削除します。ただしGitはデータベースのバックアップではありません。

公開コンテンツリポジトリの例:

```env
KAWAII_WIKI_GIT_ENABLED=true
KAWAII_WIKI_GIT_SOURCE_OF_TRUTH=false
KAWAII_WIKI_GIT_REMOTE_URL=https://github.com/OWNER/wiki-content.git
KAWAII_WIKI_GIT_BRANCH=main
KAWAII_WIKI_GIT_AUTHOR_NAME=Wiki Editor
KAWAII_WIKI_GIT_AUTHOR_EMAIL=wiki@example.com
KAWAII_WIKI_GIT_SYNC_INTERVAL_MS=300000
```

`KAWAII_WIKI_GIT_REMOTE_URL` に個人アクセストークンを埋め込まないでください。プライベートまたは書き込み可能なリモートにはホストやコンテナレベルでSSHデプロイキーを設定してください。管理者用Gitパネルはステータスを表示し、これらの設定でサービスを再デプロイ後に明示的な同期を実行します。