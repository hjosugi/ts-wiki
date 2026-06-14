/**
 * Markdown-file (de)serialization for the Git storage backend — pure & testable.
 *
 * A page becomes a `<path>.md` file with minimal YAML frontmatter:
 *
 *   ---
 *   title: Getting Started
 *   description: A short summary
 *   ---
 *
 *   # Getting Started
 *   ...body...
 *
 * We hand-roll a tiny frontmatter reader/writer (title + description only) so
 * the core stays dependency-free; it's lenient enough for hand-edited files.
 */
export interface PageFileData {
  readonly title: string
  readonly description: string
  readonly content: string
}

const needsQuote = (s: string): boolean => s === '' || /[:#"'\n]|^\s|\s$/.test(s)

const escapeYaml = (s: string): string =>
  needsQuote(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"` : s

const unquoteYaml = (v: string): string => {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return t
}

/** Serialize a page into frontmatter + body. */
export const serializePageFile = (data: PageFileData): string => {
  const frontmatter = `---\ntitle: ${escapeYaml(data.title)}\ndescription: ${escapeYaml(data.description)}\n---\n`
  const body = data.content.endsWith('\n') ? data.content : `${data.content}\n`
  return `${frontmatter}\n${body}`
}

/** Parse a markdown file (with optional frontmatter) back into page fields. */
export const parsePageFile = (raw: string): PageFileData => {
  const text = (raw ?? '').replace(/^﻿/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  let title = ''
  let description = ''
  let content = text

  if (match) {
    content = text.slice(match[0].length).replace(/^\r?\n/, '')
    for (const line of (match[1] ?? '').split(/\r?\n/)) {
      const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
      if (!kv) continue
      if (kv[1] === 'title') title = unquoteYaml(kv[2] ?? '')
      else if (kv[1] === 'description') description = unquoteYaml(kv[2] ?? '')
    }
  }

  return { title, description, content }
}

/** Page path → repo-relative file path (under the content/ root). */
export const pageFilePath = (path: string): string => `${path}.md`

/** Repo file path → page path, or null if it isn't a content markdown file. */
export const filePathToPagePath = (file: string): string | null => {
  const m = /^(?:content\/)?(.+)\.md$/.exec(file.trim())
  return m ? (m[1] ?? null) : null
}
