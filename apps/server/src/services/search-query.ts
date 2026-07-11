import type { SearchScope } from './search.ts'

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u

export const containsCjk = (value: string): boolean => CJK_RE.test(value)

export interface ParsedSearchQuery {
  readonly positive: readonly string[]
  readonly phrases: readonly string[]
  readonly negative: readonly string[]
  readonly terms: readonly string[]
}

const cleanTerm = (raw: string): string =>
  raw.toLowerCase().replace(/["()*:^{}]/g, ' ').trim()

const splitWords = (value: string): string[] =>
  cleanTerm(value).split(/\s+/).map((term) => term.trim()).filter(Boolean)

export const parseSearchQuery = (raw: string): ParsedSearchQuery => {
  const positive: string[] = []
  const phrases: string[] = []
  const negative: string[] = []
  const tokenRe = /(-?)"([^"]+)"|(-?)(\S+)/g
  for (const match of raw.matchAll(tokenRe)) {
    const quoted = match[2]
    const word = match[4]
    const negated = Boolean(match[1] || match[3])
    if (quoted !== undefined) {
      const phrase = splitWords(quoted).join(' ')
      if (!phrase) continue
      if (negated) negative.push(phrase)
      else phrases.push(phrase)
      continue
    }
    for (const term of splitWords(word ?? '')) {
      if (negated) negative.push(term)
      else positive.push(term)
    }
  }
  return { positive, phrases, negative, terms: [...positive, ...phrases, ...negative] }
}

const ftsTerm = (term: string): string => `"${term.replace(/"/g, ' ')}"*`
const ftsPhrase = (phrase: string): string => `"${phrase.replace(/"/g, ' ')}"`

export const buildMatchQuery = (raw: string, scope: SearchScope = 'all'): string | null => {
  const parsed = parseSearchQuery(raw)
  const positives = [...parsed.positive.map(ftsTerm), ...parsed.phrases.map(ftsPhrase)]
  if (positives.length === 0) return null
  let body = positives.join(' ')
  for (const term of parsed.negative) body += ` NOT ${term.includes(' ') ? ftsPhrase(term) : ftsTerm(term)}`
  return scope === 'title' ? `title : (${body})` : body
}
