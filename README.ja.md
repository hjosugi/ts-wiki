<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# kawaii-wiki.ts

Markdownで知識をつなげるための無料のセルフホスト型Wiki。高速な日本語検索、権限管理、改訂履歴、自動化、型付きREST APIを備えています。

あなたのWikiが主役です。kawaii-wiki.tsは、ユーザー、開発者、AIが共に改善できる、小さく信頼できる基盤として裏方に徹します。

[公式ドキュメント](https://kawaii-wiki-ts-docs.up.railway.app/docs/home) ·
[リリース](https://github.com/hjosugi/kawaii-wiki.ts/releases) ·
[課題](https://github.com/hjosugi/kawaii-wiki.ts/issues)

## Dockerでローカル実行

Bunやローカルビルドは不要です。

```bash
docker volume create kawaii-wiki-data
docker run -d --name kawaii-wiki --restart unless-stopped \
  -p 4000:4000 \
  -v kawaii-wiki-data:/data \
  -e KAWAII_WIKI_FTS_TOKENIZER=trigram \
  ghcr.io/hjosugi/kawaii-wiki.ts:1
```

<http://localhost:4000/setup> を開いてください。コンテナは初回起動時に永続ボリューム内に安全なJWTシークレットを作成します。

このリポジトリをクローンしている場合は、セットアップは以下のコマンド一つで完了します：

```bash
docker compose up -d
```

## アップデート

`/data` ボリュームをバックアップした後、イメージをプルしてコンテナを再作成します：

```bash
docker compose pull
docker compose up -d
```

`:1` イメージは互換性のある1.xリリースに追従します。アップデート前に承認が必要な本番環境では、Compose実行前に `KAWAII_WIKI_VERSION=1.0.3`（または他の特定のリリース）を設定してください。

詳細なインストール、設定、バックアップ、復元、Railway、Gitミラー、API、管理、開発ガイドは
[公式ドキュメント](https://kawaii-wiki-ts-docs.up.railway.app/docs/home) にあります。

## 開発

```bash
bun install
bun run dev
```

プルリクエストを送る前に [Contributing](https://kawaii-wiki-ts-docs.up.railway.app/docs/contributing) をご覧ください。セキュリティ報告は [SECURITY.md](SECURITY.md) に従います。

## ライセンス

[0BSD](LICENSE) — 自由に使用、コピー、改変、配布できます。