import { loadEnv } from '../env.ts'
import { createDb } from './client.ts'
import { rebuildSearchIndex } from './repositories/search.ts'

const env = loadEnv()
const db = createDb(env.database, { ftsTokenizer: env.search.ftsTokenizer })
rebuildSearchIndex(db, env.search.ftsTokenizer)

db.$client.close()
console.log(`✓ Rebuilt pages_fts with tokenizer=${env.search.ftsTokenizer}`)
