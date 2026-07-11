const version = Bun.argv[2]?.replace(/^v/, '')

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: bun run version:bump <major.minor.patch>')
}

const manifests = [
  'package.json',
  'packages/core/package.json',
  'apps/server/package.json',
  'apps/web/package.json',
]

for (const path of manifests) {
  const manifest = await Bun.file(path).json() as Record<string, unknown>
  manifest.version = version
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(`Updated ${manifests.length} manifests to ${version}`)
