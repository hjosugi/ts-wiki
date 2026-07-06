// Ambient declarations for markdown-it plugins that ship no TypeScript types.
// A markdown-it plugin is `(md, ...params) => void`, which structurally matches
// markdown-it's `.use()` signature — no `any` or `@ts-ignore` needed.

declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt) => void
  export default plugin
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  interface TaskListsOptions {
    readonly enabled?: boolean
    readonly label?: boolean
    readonly labelAfter?: boolean
  }
  const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void
  export default plugin
}
