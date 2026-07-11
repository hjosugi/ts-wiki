import { readFileSync } from 'node:fs'
import type { PageInput, PageStatus } from '@kawaii-wiki/core'

export const OFFICIAL_DOCS_VERSION = '1.0.2'

export interface OfficialDocumentationPage extends PageInput {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly labels: readonly string[]
  readonly status: PageStatus
}

const page = (
  path: string,
  title: string,
  description: string,
  content: string,
  navOrder: number,
): OfficialDocumentationPage => ({
  path,
  title,
  description,
  content,
  labels: ['kawaii-wiki-docs', 'guide', 'ja'],
  status: 'verified',
  locale: 'ja',
  navOrder,
})

interface RepositoryDocumentationSource {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly sourcePath: string
}

const repositoryDocumentationSources: readonly RepositoryDocumentationSource[] = [
  { path: 'docs/reference/readme', title: 'README', description: 'プロジェクト概要と最短のDocker起動手順。', sourcePath: '../../../README.md' },
  { path: 'docs/reference/changelog', title: '変更履歴', description: 'リリースごとの追加・変更・セキュリティ修正。', sourcePath: '../../../CHANGELOG.md' },
  { path: 'docs/reference/configuration', title: '環境変数リファレンス', description: 'サーバー設定とSecretの完全な一覧。', sourcePath: '../../../docs/CONFIGURATION.md' },
  { path: 'docs/reference/upgrading', title: '更新とロールバック', description: 'バックアップを前提とした安全な更新手順。', sourcePath: '../../../docs/UPGRADING.md' },
  { path: 'docs/reference/api', title: 'API互換性ポリシー', description: 'REST/OpenAPIの1.x安定性方針。', sourcePath: '../../../docs/API.md' },
  { path: 'docs/reference/deploy-free', title: '低コストデプロイ', description: '無料・低コスト環境へのデプロイガイド。', sourcePath: '../../../docs/DEPLOY_FREE.md' },
  { path: 'docs/reference/design', title: 'アーキテクチャ', description: '設計、データフロー、検索、型安全性。', sourcePath: '../../../docs/DESIGN.md' },
  { path: 'docs/reference/handoff', title: '実装ハンドオフ', description: '実装状況、判断、拡張方法、注意点。', sourcePath: '../../../docs/HANDOFF.md' },
  { path: 'docs/reference/audit-2026-07-06', title: '品質監査 2026-07-06', description: '1.0前の品質監査記録。', sourcePath: '../../../docs/AUDIT-2026-07-06.md' },
  { path: 'docs/reference/issue-resolution', title: 'Issue判断記録', description: '完了範囲、非目標、スコープ判断。', sourcePath: '../../../docs/ISSUE_RESOLUTION.md' },
  { path: 'docs/reference/product-design-rfc', title: 'プロダクト設計RFC', description: 'kawaii-wiki.tsの方向性と設計原則。', sourcePath: '../../../docs/KAWAII_WIKI_DESIGN_RFC.md' },
  { path: 'docs/reference/inline-comments-rfc', title: 'インラインコメントRFC', description: 'インラインコメント機能の設計案。', sourcePath: '../../../docs/INLINE_COMMENTS_RFC.md' },
  { path: 'docs/reference/live-preview-editor', title: 'ライブプレビューエディター検証', description: '編集体験の技術検証と判断。', sourcePath: '../../../docs/LIVE_PREVIEW_EDITOR_SPIKE.md' },
  { path: 'docs/reference/contributing', title: 'コントリビューション規約', description: 'Issue、PR、開発品質の規約。', sourcePath: '../../../CONTRIBUTING.md' },
  { path: 'docs/reference/security', title: 'セキュリティポリシー', description: '脆弱性の報告方法とサポート範囲。', sourcePath: '../../../SECURITY.md' },
  { path: 'docs/reference/code-of-conduct', title: '行動規範', description: 'コミュニティの行動規範。', sourcePath: '../../../CODE_OF_CONDUCT.md' },
  { path: 'docs/reference/server-package', title: 'Serverパッケージ', description: 'サーバーの構成、実行、拡張方法。', sourcePath: '../README.md' },
  { path: 'docs/reference/web-package', title: 'Webパッケージ', description: 'Web UIの構成、開発、ビルド方法。', sourcePath: '../../web/README.md' },
  { path: 'docs/reference/core-package', title: 'Coreパッケージ', description: '純粋なドメインロジックと型。', sourcePath: '../../../packages/core/README.md' },
]

const referencePage = (
  source: RepositoryDocumentationSource,
  navOrder: number,
): OfficialDocumentationPage => ({
  path: source.path,
  title: source.title,
  description: source.description,
  content: `> Source: \`${source.sourcePath.replace(/^\.\.\/\.\.\/\.\.\//, '')}\`\n\n${readFileSync(new URL(source.sourcePath, import.meta.url), 'utf8')}`,
  labels: ['kawaii-wiki-docs', 'reference', 'en'],
  status: 'verified',
  locale: 'en',
  navOrder,
})

export const officialDocumentationPages: readonly OfficialDocumentationPage[] = [
  page('docs/home', 'kawaii-wiki.ts ドキュメント', '利用者・管理者・開発者向けの公式ガイド。', `# kawaii-wiki.ts ドキュメント

kawaii-wiki.ts は、知識を自分で所有し、Markdownで育て、ページ同士をつなぐための無料・オープンソースWikiです。主役はソフトウェア名ではなく、あなたのWikiと知識です。

## 読む順番

1. [[docs/installation|インストール]]
2. [[docs/getting-started|はじめる]]
3. [[docs/pages-and-editing|ページの作成と編集]]
4. [[docs/organize-and-search|整理と検索]]
5. [[docs/collaboration|共同作業と権限]]
6. [[docs/administration|管理と安全な運用]]

## 運用・開発

- [[docs/deployment-and-updates|デプロイ、更新、ロールバック]]
- [[docs/git-and-backups|Gitミラーとバックアップ]]
- [[docs/api-and-automation|REST API、Webhook、自動化]]
- [[docs/troubleshooting|トラブルシューティング]]
- [[docs/contributing|開発・コントリビューション]]
- [[docs/reference|完全なリポジトリ資料]]

画面右上の検索、または「検索」ボタンから、ページ名・本文・ラベルを横断検索できます。`, 100),

  page('docs/installation', 'インストール', 'Dockerだけでローカル起動し、初期設定を完了する。', `# インストール

## Dockerでローカル起動

Bunやソースのビルドは不要です。

\`\`\`bash
docker volume create kawaii-wiki-data
docker run -d --name kawaii-wiki --restart unless-stopped \\
  -p 4000:4000 \\
  -v kawaii-wiki-data:/data \\
  -e KAWAII_WIKI_FTS_TOKENIZER=trigram \\
  ghcr.io/hjosugi/kawaii-wiki.ts:1
\`\`\`

ブラウザで [http://localhost:4000/setup](http://localhost:4000/setup) を開きます。初回起動時に安全なJWT secretが \`/data/.jwt-secret\` へ自動生成され、同じVolumeを使う限り保持されます。

## Docker Compose

リポジトリを取得済みなら、次だけで起動できます。

\`\`\`bash
docker compose up -d
\`\`\`

停止は \`docker compose down\`、ログは \`docker compose logs -f wiki\` です。\`down -v\` はデータVolumeも削除するため、Wikiを消す意図がない限り実行しないでください。

## 本番環境

本番ではHTTPS、永続Volume、定期バックアップ、固定バージョンタグを使います。外部Secret管理を利用する場合は \`JWT_SECRET\` を32バイト以上のランダム値として明示できます。`, 101),

  page('docs/getting-started', 'はじめる', '初回セットアップから最初のページ作成まで。', `# はじめる

## 初回セットアップ

初回アクセスでは \`/setup\` が開きます。Wiki名、管理者名、メール、強いパスワード、テーマ、検索方式を設定します。日本語を中心に使う場合は検索方式を **trigram** にします。

Wiki名はヘッダー、ブラウザタイトル、ホームページで主表示されます。後から **管理 → 一般 → 外観** で変更できます。

## 最初に確認すること

- 管理者でログインできる
- ホームページを編集して保存できる
- 検索結果に編集内容が出る
- 添付画像が再起動後も残る
- \`/api/health\` が \`ok: true\` を返す

## 最初のページ

「新規ページ」を押し、タイトルを入力します。パスはタイトルから自動生成されます。テンプレートを選ぶか、空の下書きから始め、保存前に状態・ラベル・公開予定を確認します。

ページ同士は \`[[ページのパス]]\` でリンクできます。存在しないリンクは未作成ページとしてグラフやリンク切れ一覧に表示されます。`, 102),

  page('docs/pages-and-editing', 'ページの作成と編集', '閲覧・編集モード、Markdown、履歴、添付ファイル。', `# ページの作成と編集

## 閲覧と編集

閲覧画面には「閲覧中」、編集画面には「編集中」または「新規ページ作成中」と表示されます。閲覧画面の「編集する」から編集へ移動し、その他の操作は「その他」メニューにまとまっています。

## エディター

- **Visual**: 通常の文章を見た目に近い形で編集
- **Markdown**: Markdownを直接編集
- **Collaborative**: 複数人の同時編集

見出し、箇条書き、リンク、表、コード、引用、画像をツールバーから挿入できます。保存状態には「未保存の変更」「保存中」「保存済み」が表示されます。

## ページ情報

タイトル、パス、状態、ラベル、スペース、言語、レビュー日、公開予定、サイドバー順、アイコン、カバー画像を設定できます。通常の閲覧画面では重要な状態と更新日時だけを表示し、編集用の詳細情報で本文を圧迫しません。

## 履歴と復元

保存ごとにリビジョンが作られます。「その他 → 履歴」で差分を比較し、必要な版を復元できます。削除したページはゴミ箱へ移動し、管理画面から復元または完全削除できます。`, 102),

  page('docs/organize-and-search', '整理と検索', '階層、ラベル、スペース、検索、グラフの使い分け。', `# 整理と検索

## 階層

パスの \`/\` がフォルダになります。例: \`product/design/buttons\`。左のページツリーではフォルダを開閉し、スター、個人順序、共有順序を使えます。

## ラベルとスペース

ラベルは複数の分類軸を横断して付ける用途、スペースは権限や大きな領域を分ける用途に向きます。深すぎる階層を作る前にラベルを検討してください。

## 検索

通常の語句、\`"完全一致の語句"\`、\`-除外語\`、タイトル・状態・ラベル・スペース・作成者フィルターを利用できます。日本語検索には trigram が適しています。

## 双方向リンクとグラフ

ページ下部に被リンクが表示されます。グラフはページ間の接続や未作成ページを見つける補助機能です。閲覧画面の「グラフを表示／隠す」で切り替えられ、選択は端末に保存されます。本文を読む時はOFFでも問題ありません。`, 103),

  page('docs/collaboration', '共同作業と権限', 'ユーザー、グループ、ページルール、コメント、通知。', `# 共同作業と権限

## ロール

- **admin**: 設定、ユーザー、権限、監査を含む全管理
- **editor**: 許可されたページの作成・更新
- **viewer**: 許可されたページの閲覧

## グループとページルール

ユーザーをグループに追加し、パスの完全一致・前方一致・後方一致・正規表現で allow / deny ルールを設定します。denyを優先し、非公開ページ名が一覧・検索・グラフから漏れない設計です。

## コメントと通知

ページへコメントし、\`@name\` でメンションできます。通知ベルから未読を確認し、ページへ移動できます。ウォッチを有効にしたページの変更も通知対象です。

## 認証

ローカルパスワード、TOTP、パスキー、リカバリーコード、OIDCを利用できます。公開運用ではHTTPSを必須にし、必要に応じて登録停止、メール確認、2FA必須を設定します。`, 104),

  page('docs/administration', '管理と安全な運用', '管理設定の探し方、外観、ポリシー、監査。', `# 管理と安全な運用

管理画面はカテゴリ付きサイドナビになっています。上部の「設定を検索」で、外観、ユーザー、Git、Webhookなどを名前と関連語から探せます。

## 最初に設定する項目

1. **一般 → 外観**: Wiki名、ロゴ、テーマ、言語、タイムゾーン
2. **一般 → ポリシー**: 非公開、登録、メール確認、2FA
3. **ユーザーと権限**: ユーザー、グループ、ページルール
4. **システム → 監査**: 管理操作と重要イベント

## 秘密情報

JWT secret、SMTP、OIDC secret、R2鍵、Git鍵はWiki本文や通常設定へ保存せず、デプロイ先のSecret環境変数で管理します。ログやスクリーンショットへ貼らないでください。

## バックアップ

Gitは本文ミラーであり完全バックアップではありません。SQLiteと添付ファイルを含む \`/data\` Volumeを定期バックアップしてください。`, 105),

  page('docs/deployment-and-updates', 'デプロイ、更新、ロールバック', 'DockerとRailwayで安全に更新する手順。', `# デプロイ、更新、ロールバック

## Docker

\`/data\` を永続Volumeへマウントします。DockerイメージはJWT secretを初回に \`/data/.jwt-secret\` へ生成するため、更新時も同じVolumeを使います。Secret管理基盤を使う場合は \`JWT_SECRET\` を明示できます。直接ポート4000を公開せず、HTTPSリバースプロキシを使います。

## Railway

Docker Imageに \`ghcr.io/hjosugi/kawaii-wiki.ts:VERSION\`、Volumeに \`/data\`、PORTに \`4000\` を設定します。公開ドメインと \`KAWAII_WIKI_PUBLIC_ORIGIN\` を一致させます。

## 更新

1. Volumeバックアップを作る
2. CHANGELOGとUPGRADINGを読む
3. イメージタグを新しい固定版へ変更
4. 再デプロイ
5. health、ログイン、検索、添付を確認

1.xのDBマイグレーションは起動時に自動適用されます。\`latest\` の無条件追従より、\`1.0.1\` のような固定タグを推奨します。

## ロールバック

問題があれば旧イメージタグへ戻します。DBマイグレーションを含む更新では、互換性を確認し、必要なら更新前Volumeバックアップから復元します。`, 106),

  page('docs/git-and-backups', 'Gitミラーとバックアップ', 'Git同期の設定とデータ保護。', `# Gitミラーとバックアップ

## Gitミラー

管理 → システム → Gitで接続用環境変数を生成できます。ページ本文は \`content/*.md\` としてコミットされ、Wikiの変更はGitへ、外部コミットは明示的な同期でWikiへ取り込まれます。

アクセストークンをリポジトリURLへ埋め込まないでください。公開リポジトリの読み込み以外は、ホスト側のSSH Deploy Keyを利用します。

## 完全バックアップ

完全な復旧には次が必要です。

- SQLite DB（WAL実行中はオンラインbackup APIまたは停止後コピー）
- \`/data/assets\` の添付ファイル
- JWT、SMTP、OIDC、R2などのSecret
- 現在のコンテナイメージタグ

RailwayではVolumeのDaily/Weekly/Monthlyバックアップを設定できます。復元手順も定期的にテストしてください。`, 107),

  page('docs/api-and-automation', 'REST API、Webhook、自動化', '外部連携の入口と認証。', `# REST API、Webhook、自動化

## REST / OpenAPI

- 対話ドキュメント: \`/api/docs\`
- OpenAPI JSON: \`/api/docs/openapi.json\`

管理 → システム → 開発者APIから入口を開けます。APIキーは管理 → ユーザーと権限 → セキュリティで作成し、\`Authorization: Bearer ...\` で送ります。Web画面と同じロール・ページルールが適用されます。

GraphQLは現在未対応です。存在しない機能を暗黙に提供せず、認可・監査・レート制限をRESTと共有できる形で設計してから追加します。

## Webhook

対象URL、署名Secret、イベント種別を登録します。配信履歴には成功・失敗・再試行が表示されます。受信側ではHMAC署名を検証し、同じイベントの重複受信に耐える処理にします。

## 自動化

ページ作成・更新・削除・移動、コメントをトリガーに、ラベル・状態・パス移動・Webhook発火を構成できます。まず限定パスでテストしてから範囲を広げます。`, 108),

  page('docs/troubleshooting', 'トラブルシューティング', '起動、保存、検索、権限、表示崩れの確認項目。', `# トラブルシューティング

## 起動しない

\`/api/health\`、コンテナログ、\`JWT_SECRET\`、\`/data\` の書き込み権限を確認します。Railway Volumeと非rootイメージで権限エラーになる場合は公式の \`RAILWAY_RUN_UID\` 設定を確認します。

## データが消えた

\`/data\` が永続Volumeへマウントされているか確認します。エフェメラル領域へ保存したデータは再デプロイで消えます。復旧前に現在のVolumeを複製してください。

## 日本語検索が弱い

管理 → 統計でCurrent tokenizerを確認します。既存Wikiでtrigramへ変更する前にバックアップし、検索インデックスを再構築します。

## ページが見えない

非公開ポリシー、ユーザーロール、グループ、ページルール、状態、公開予定を確認します。管理者には見えて匿名利用者には見えない場合、まずdenyルールを確認します。

## 表示が崩れる

ブラウザ倍率を100%へ戻し、カスタムCSSを一時的に無効化します。再現するURL、画面幅、スクリーンショット、ブラウザ情報をIssueへ添えてください。`, 109),

  page('docs/contributing', '開発・コントリビューション', 'ローカル開発、品質確認、IssueとPR。', `# 開発・コントリビューション

このプロジェクトの目的は、高品質な無料パッケージを共同で育て、利用者・開発者・人・AIが知識を増やし、つなげやすくすることです。

## ローカル開発

\`bun install\`、\`bun run dev\` で起動します。変更前後に \`bun run lint\`、\`bun run typecheck\`、\`bun run test\`、\`bun run build\` を実行します。UI変更は狭い画面、キーボード操作、日本語と英語で確認します。

## Issue

期待する動作、実際の動作、再現手順、URL、画面幅、ログを記載します。秘密情報、アクセストークン、個人データは貼らないでください。

## Pull Request

変更理由、範囲、テスト結果、互換性、スクリーンショットを示します。小さくレビュー可能な変更を優先し、データ移行やAPI変更にはアップグレード手順を付けます。

ソース: [GitHub](https://github.com/hjosugi/kawaii-wiki.ts)`, 110),

  page('docs/reference', '完全なリポジトリ資料', '設定、設計、API、RFC、監査、各パッケージの原文資料。', `# 完全なリポジトリ資料

GitHubで管理している公式Markdownを、そのまま検索・リンクできる形で収録しています。通常の利用方法は日本語ガイドを読み、厳密な設定値、設計判断、API互換性、RFCを確認するときにこの資料を参照してください。

${repositoryDocumentationSources.map((source) => `- [[${source.path}|${source.title}]] — ${source.description}`).join('\n')}`, 199),

  ...repositoryDocumentationSources.map((source, index) => referencePage(source, 200 + index)),
]
