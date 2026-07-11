const ASSET_URL = /\/assets\/([^\s)'"?#]+)/g

const decodeStorageName = (value: string): string => {
  try {
    return value.split('/').map(decodeURIComponent).join('/')
  } catch {
    return value
  }
}

export const assetStorageNamesFromContent = (content: string): string[] =>
  [...new Set([...content.matchAll(ASSET_URL)].map((match) => decodeStorageName(match[1] ?? '')).filter(Boolean))]
