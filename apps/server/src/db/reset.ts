/**
 * Delete the local database files. For Turso/libSQL, this resets only the
 * embedded-replica file, never the remote database.
 */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../env.ts'

const localPath = (path: string): string => {
  if (!path.startsWith('file:')) return path
  try {
    return fileURLToPath(path)
  } catch {
    return path.slice('file:'.length)
  }
}

const removeDatabaseFiles = (path: string): void => {
  if (path === ':memory:' || path === 'file::memory:') return
  const filePath = localPath(path)
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(filePath + suffix, { force: true })
  }
}

const env = loadEnv()
const path = env.database.driver === 'sqlite'
  ? env.database.path
  : env.database.driver === 'libsql'
    ? env.database.replicaPath ?? env.database.url
    : env.database.url
removeDatabaseFiles(path)
console.log(`✓ removed ${path}`)
