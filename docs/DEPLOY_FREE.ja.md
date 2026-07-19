<!-- i18n: language-switcher -->
[English](DEPLOY_FREE.md) | [日本語](DEPLOY_FREE.ja.md)

# Render Free + Turso + R2 デプロイメント

これは issue #44 のゼロコストデプロイメントパスです。

## 現在のサポート状況

| サーフェス | ステータス |
| --- | --- |
| SQLite データベース | サポートされており、`DATABASE_DRIVER=sqlite` で引き続きデフォルトです。 |
| ローカルアセット | サポートされており、`ASSET_STORAGE=local` で引き続きデフォルトです。 |
| R2 アセット | サーバーのアセットストレージアダプターを通じてサポートされています。 |
| ローカル libSQL | `DATABASE_DRIVER=libsql` とローカルの `file:` または `:memory:` URL でサポートされています。 |
| Turso/libSQL | libSQL 埋め込みレプリカとしてサポート：サーバーはローカルのレプリカファイルを開き、リモートの Turso URL と同期します。 |
| PostgreSQL | `DATABASE_DRIVER=postgres` と `DATABASE_URL` でサポート。スキーマは起動時にマイグレーションされます。 |

## Render Free の形態

Render Free のウェブサービスは耐久性のあるローカルディスクを提供しません。データベースには Turso を、アップロードされたアセットには R2 を使用してください：

```env
NODE_ENV=production
JWT_SECRET=replace-with-a-long-random-secret

DATABASE_DRIVER=libsql
LIBSQL_URL=libsql://your-database.turso.io
LIBSQL_AUTH_TOKEN=your-turso-token
# 任意。デフォルトは DATA_DIR/kawaii-wiki.ts-libsql-replica.db です。
LIBSQL_REPLICA_PATH=/tmp/kawaii-wiki.ts-libsql-replica.db

ASSET_STORAGE=r2
ASSET_PUBLIC_BASE_URL=https://cdn.example.com/assets
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=kawaii-wiki.ts-assets
```

レプリカファイルは Render Free 上で一時的なものかもしれません。耐久性のある側はリモートの Turso データベースです。`db:reset` はローカルのレプリカファイルのみを削除し、リモートの Turso データベースは決して削除しません。

## ローカル libSQL

Turso の認証情報なしで libSQL パスをテストするにはこちらを使います：

```env
DATABASE_DRIVER=libsql
LIBSQL_URL=file:./data/kawaii-wiki.ts-libsql.db
```

同じマイグレーション、FTS5 検索、ページ書き込み、コメント、権限、Webhook、パスキー認証チャレンジのストレージが libSQL 互換の生クライアントを通じて動作します。

## R2 アセット

R2 は SQLite または libSQL のどちらでも使用可能です：

```env
ASSET_STORAGE=r2
ASSET_PUBLIC_BASE_URL=https://cdn.example.com/assets
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=kawaii-wiki.ts-assets
```

カスタムの S3 互換エンドポイントが必要な場合は `R2_ACCOUNT_ID` の代わりに `R2_ENDPOINT` を使用してください。

## 運用上の注意

- 最初の起動前に `bun --filter '@kawaii-wiki/server' db:migrate` を実行するか、サーバーに起動時のマイグレーションを任せてください。
- 最初の管理者を作成するために一度だけ `bun --filter '@kawaii-wiki/server' db:seed` を実行してください。
- `KAWAII_WIKI_PUBLIC_ORIGIN` はユーザーが開く HTTPS URL に設定したままにしてください。パスキーや OIDC リダイレクトはこれに依存します。
- 公開オリジンのホスト名が WebAuthn のリライイングパーティ ID と異なる場合を除き、`PASSKEY_RP_ID` は設定しないでください。
- マルチインスタンスのリアルタイム同期には `KAWAII_WIKI_EVENT_BUS=db` を維持してください。ページ変更イベントは共有データベースに保存されます。

## 残る本番運用の証明

コードパスは実装済みでローカル libSQL 統合テストでカバーされています。特定のホスティングされたデプロイメントを本番対応と呼ぶ前に、実際の Turso と R2 の認証情報を使ってスモークテストを実行してください：

1. `db:migrate` と `db:seed` を実行。
2. ローカル認証、TOTP、パスキーで登録・ログイン。
3. ページの作成、更新、移動、検索、アーカイブ、復元。
4. R2 を通じたアセットのアップロードと削除。
5. Webhook を作成し、署名付き配信を確認。