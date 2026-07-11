import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assetsDir = join(import.meta.dir, '../apps/web/dist/assets')
const editorChunk = readdirSync(assetsDir).find((name) => /^vendor-editor-.*\.js$/.test(name))
if (!editorChunk) throw new Error('vendor-editor chunk was not produced')

const bytes = statSync(join(assetsDir, editorChunk)).size
const limit = 750 * 1024
if (bytes > limit) {
  throw new Error(`vendor-editor is ${(bytes / 1024).toFixed(1)} KiB; budget is ${limit / 1024} KiB`)
}

console.log(`vendor-editor ${(bytes / 1024).toFixed(1)} KiB / ${limit / 1024} KiB budget`)
