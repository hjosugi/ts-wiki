import type { Page, PageTemplate, PageTemplateMetadata } from './api'

export interface PageTemplateOption {
  key: string
  label: string
  description: string
  icon: string
  content: string
  metadata: PageTemplateMetadata
  builtIn: boolean
}

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const builtInPageTemplates = (timeZone = browserTimeZone()): PageTemplateOption[] => [
  {
    key: 'builtin:blank',
    label: 'Blank',
    description: '',
    icon: '',
    content: '# New page\n\nStart writing in **Markdown**...\n',
    metadata: { title: '', path: '' },
    builtIn: true,
  },
  {
    key: 'builtin:decision',
    label: 'Decision',
    description: '',
    icon: '',
    content: '# Decision\n\n## Context\n\n## Options\n\n## Decision\n\n## Consequences\n',
    metadata: { title: 'Decision', path: 'decisions/new-decision' },
    builtIn: true,
  },
  {
    key: 'builtin:how-to',
    label: 'How-to',
    description: '',
    icon: '',
    content: '# How-to\n\n## Goal\n\n## Steps\n\n1. \n\n## Checks\n',
    metadata: { title: 'How-to', path: 'guides/new-guide' },
    builtIn: true,
  },
  {
    key: 'builtin:talent-profile',
    label: 'Talent profile',
    description: 'JA-first VTuber profile with infobox and official links.',
    icon: 'ID',
    content: `# タレント名

\`\`\`infobox
title: タレント名
image:
caption: 公式ビジュアル
所属: 事務所・グループ名
デビュー: YYYY-MM-DD
誕生日: MM-DD
身長: cm
ファンネーム:
タグ: #配信タグ / #FAタグ

日本語のプロフィール概要をここに書きます。
\`\`\`

\`\`\`links
[YouTube](https://youtube.com/@handle)
[X](https://x.com/handle)
[Twitch](https://twitch.tv/handle)
[BOOTH](https://handle.booth.pm/)
\`\`\`

## 概要

## 活動内容

## 代表的な配信

\`\`\`youtube-latest
channel: https://youtube.com/@handle
limit: 3
\`\`\`

## 関連ページ

- [[Songs/タレント名]]
- [[Streams/タレント名]]
`,
    metadata: { title: 'タレント名', path: 'talents/new-talent', labels: ['vtuber', 'talent'], locale: 'ja' },
    builtIn: true,
  },
  {
    key: 'builtin:stream-log',
    label: 'Stream log',
    description: 'Archive a stream with event timing, embed, notes, and links.',
    icon: 'Play',
    content: `# YYYY-MM-DD 配信タイトル

\`\`\`event
title: 配信タイトル
start: 2026-07-04 20:00
timezone: ${timeZone}
url: https://www.youtube.com/watch?v=VIDEO_ID
description: 配信予定・アーカイブ
\`\`\`

\`\`\`youtube
url: https://www.youtube.com/watch?v=VIDEO_ID
\`\`\`

\`\`\`embed
url: https://www.youtube.com/watch?v=VIDEO_ID
title: 配信タイトル
description: 公式アーカイブ
\`\`\`

## 出演

- [[Talents/タレント名]]

## 概要

## タイムスタンプ

- 00:00:00 開始

## メモ
`,
    metadata: {
      title: 'YYYY-MM-DD 配信タイトル',
      path: 'streams/YYYY-MM-DD-stream-title',
      labels: ['vtuber', 'stream'],
      locale: 'ja',
    },
    builtIn: true,
  },
  {
    key: 'builtin:song-list',
    label: 'Song list',
    description: 'Track originals, covers, karaoke cuts, credits, and source links.',
    icon: 'Music',
    content: `# タレント名 Song List

## オリジナル曲

| 曲名 | 公開日 | 作詞 | 作曲 | リンク |
| --- | --- | --- | --- | --- |
| 曲名 | YYYY-MM-DD |  |  | [YouTube](https://www.youtube.com/watch?v=VIDEO_ID) |

## カバー

| 曲名 | 原曲 | 公開日 | リンク |
| --- | --- | --- | --- |
| 曲名 | アーティスト | YYYY-MM-DD | [YouTube](https://www.youtube.com/watch?v=VIDEO_ID) |

## 歌枠・ライブ

\`\`\`youtube
url: https://www.youtube.com/watch?v=VIDEO_ID
\`\`\`

## 関連リンク

\`\`\`links
[YouTube Music](https://music.youtube.com/)
[Spotify](https://open.spotify.com/)
[Apple Music](https://music.apple.com/)
\`\`\`
`,
    metadata: { title: 'タレント名 Song List', path: 'songs/new-song-list', labels: ['vtuber', 'music'], locale: 'ja' },
    builtIn: true,
  },
  {
    key: 'builtin:glossary',
    label: 'Glossary',
    description: 'Define VTuber terms, memes, tags, and community phrases.',
    icon: 'Book',
    content: `# 用語名

\`\`\`infobox
title: 用語名
読み:
種別: 用語 / タグ / ミーム
初出:
関連: [[Talents/タレント名]]

短い定義を日本語で書きます。
\`\`\`

## 意味

## 使われ方

## 初出・出典

\`\`\`embed
url: https://example.com/source
title: 出典
description:
\`\`\`

## 関連用語

- [[Glossary/関連用語]]
`,
    metadata: { title: '用語名', path: 'glossary/new-term', labels: ['vtuber', 'glossary'], locale: 'ja' },
    builtIn: true,
  },
  {
    key: 'builtin:event-announcement',
    label: 'Event announcement',
    description: 'Publish live, merch, collab, or campaign details with calendar support.',
    icon: 'Cal',
    content: `# イベント名

\`\`\`event
title: イベント名
start: 2026-07-04 20:00
end: 2026-07-04 21:00
timezone: ${timeZone}
location: YouTube
url: https://example.com/event
description: 告知文の要約
\`\`\`

## 告知

## 出演者

- [[Talents/タレント名]]

## 視聴・参加リンク

\`\`\`links
[YouTube](https://youtube.com/@handle)
[X announcement](https://x.com/handle/status/POST_ID)
[Official page](https://example.com/event)
\`\`\`

## 関連資料

\`\`\`embed
url: https://example.com/event
title: 公式告知
description:
\`\`\`
`,
    metadata: { title: 'イベント名', path: 'events/new-event', labels: ['vtuber', 'event'], locale: 'ja' },
    builtIn: true,
  },
  {
    key: 'builtin:meeting',
    label: 'Meeting notes',
    description: '',
    icon: '',
    content: `# Meeting notes

\`\`\`event
title: Meeting
start: 2026-07-04 10:00
timezone: ${timeZone}
description:
\`\`\`

## Attendees

## Notes

## Actions
`,
    metadata: { title: 'Meeting notes', path: 'meetings/new-meeting' },
    builtIn: true,
  },
  {
    key: 'builtin:journal',
    label: 'Daily note',
    description: 'Journal entry with notes, decisions, and follow-ups.',
    icon: 'Cal',
    content: `# Daily note

## Notes

## Decisions

## Follow-ups

## Links
`,
    metadata: { title: 'Daily note', labels: ['journal'] },
    builtIn: true,
  },
  {
    key: 'builtin:spec',
    label: 'Spec',
    description: '',
    icon: '',
    content: '# Spec\n\n## Problem\n\n## Goals\n\n## Non-goals\n\n## Design\n\n## Rollout\n',
    metadata: { title: 'Spec', path: 'specs/new-spec' },
    builtIn: true,
  },
]

export const pageTemplateToOption = (template: PageTemplate): PageTemplateOption => ({
  key: `custom:${template.id}`,
  label: template.name,
  description: template.description,
  icon: template.icon,
  content: template.content,
  metadata: template.metadata,
  builtIn: false,
})

export const templateMetadataFromPageDraft = (draft: {
  title: string
  path: string
  labels: string[]
  status: Page['status']
  locale: string
  reviewAt: number | null
}): PageTemplateMetadata => ({
  title: draft.title,
  path: draft.path,
  labels: draft.labels,
  status: draft.status,
  locale: draft.locale,
  reviewAt: draft.reviewAt,
})
