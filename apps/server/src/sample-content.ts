import type { PageInput, PageStatus } from '@kawaii-wiki/core'

export interface SamplePageInput extends PageInput {
  readonly path: string
  readonly title: string
  readonly content: string
  readonly labels: readonly string[]
  readonly status: PageStatus
}

export const createHomeContent = (
  siteTitle: string,
  options: { readonly includeGuideLinks?: boolean } = {},
): string => {
  const guideLinks = options.includeGuideLinks
    ? `
- Start with [Basic editing (English)](/help/en/basic-editing) or [基本の編集 (日本語)](/help/ja/basic-editing).
`
    : ''

  return `# ${siteTitle}

This is your wiki. Replace this introduction with the knowledge you want to grow and connect.

## First steps

- Edit this page and save one small change.
- Create a page for a real topic, such as \`team/contacts\`.
- Link pages with [[team/contacts]].
${guideLinks}`
}

export const sampleGuidePages = [
  {
    path: 'help/en/basic-editing',
    title: 'Basic editing guide',
    description: 'A friendly guide to editing pages, links, assets, blocks, and templates.',
    content: `# Basic editing guide

Use this page when you are new to the wiki. You do not need to know code; write plain text and add Markdown only where it helps.

## Make a small edit

1. Open a page and choose **Edit**.
2. Change one short section.
3. Save with a clear title and labels.

## Links

- Wiki page: [[home]]
- Another guide: [[help/ja/basic-editing|日本語ガイド]]
- Web page: [Example](https://example.com)

## Images and assets

Upload an image or PDF in Assets, then paste the asset URL.

![Alt text for readers](/assets/example-screenshot.png)

Keep the alt text short: say what the image shows.

## Blocks

Blocks make notes easy to scan.

> Use a quote for an important note.

\`\`\`callout
type: tip
title: Tip
Put one clear action here.
\`\`\`

\`\`\`text
Use a code block for copied text, commands, or exact wording.
\`\`\`

## Templates

When many pages should look alike, start from [Templates](/_templates). Good templates have headings only:

- Purpose
- Owner
- Steps
- Related links

Then replace the prompts with real information.
`,
    labels: ['guide', 'help', 'en'],
    status: 'verified',
    locale: 'en',
    navOrder: 10,
  },
  {
    path: 'help/ja/basic-editing',
    title: '基本の編集ガイド',
    description: 'リンク、画像、ブロック、テンプレートを使うための短い日本語ガイド。',
    content: `# 基本の編集ガイド

このページは、技術者でない人が最初に読むための短いガイドです。本文は普通の文章で書き、必要な所だけ Markdown を使います。

## 小さく編集する

1. ページを開いて **Edit** を選びます。
2. 1つの見出しだけ直します。
3. 内容が分かるタイトルとラベルを付けて保存します。

## リンク

- Wiki内: [[home]]
- 英語版: [[help/en/basic-editing|English guide]]
- 外部サイト: [Example](https://example.com)

## 画像とファイル

Assets に画像やPDFをアップロードし、URLを貼ります。

![設定画面のスクリーンショット](/assets/example-screenshot.png)

代替テキストには、画像に何が写っているかを短く書きます。

## ブロック

大事な注意やコピーする手順はブロックにします。

> 注意: 先に確認してから保存します。

\`\`\`callout
type: tip
title: ヒント
次にすることを1つだけ書きます。
\`\`\`

\`\`\`text
そのままコピーしてほしい文章やコマンドはここに入れます。
\`\`\`

## テンプレート

同じ形のページは [Templates](/_templates) から始めます。よく使う見出しだけを用意します。

- 目的
- 担当
- 手順
- 関連リンク

見出しの下に、実際の内容を書き足してください。
`,
    labels: ['guide', 'help', 'ja'],
    status: 'verified',
    locale: 'ja',
    navOrder: 11,
  },
] as const satisfies readonly SamplePageInput[]

export const sampleSeedPages = (siteTitle = 'kawaii-wiki.ts'): readonly SamplePageInput[] => [
  {
    path: 'home',
    title: siteTitle,
    content: createHomeContent(siteTitle, { includeGuideLinks: true }),
    labels: ['getting-started'],
    status: 'verified',
    navOrder: 0,
    pinned: true,
  },
  ...sampleGuidePages,
]
