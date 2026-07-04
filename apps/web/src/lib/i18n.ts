import { computed, ref } from 'vue'

export type Locale = 'en' | 'ja'

const localeStorageKey = 'ts-wiki-locale'

export const messages = {
  en: {
    admin: 'Admin',
    archive: 'Archive',
    assets: 'Assets',
    backToPage: 'Back to page',
    commandPalette: 'Command palette',
    copied: 'Copied',
    copyPath: 'Copy path',
    createAccount: 'Create account',
    createThisPage: 'Create this page',
    delete: 'Delete',
    discardUnsavedChanges: 'Discard unsaved changes?',
    edit: 'Edit',
    events: 'Events',
    email: 'Email',
    graph: 'Graph',
    displayName: 'Display name',
    firstAccountAdmin: 'The first account to register becomes the admin.',
    history: 'History',
    html: 'HTML',
    keepLatest: 'Keep latest',
    loading: 'Loading...',
    loadingEditor: 'Loading editor...',
    locale: 'Locale',
    markdown: 'Markdown',
    newChild: 'New child',
    newPage: '+ New page',
    noResults: 'No results for "{query}".',
    pageTitle: 'Page title',
    password: 'Password',
    pathPlaceholder: 'path/to/page',
    restoreDraft: 'Restore my draft',
    review: 'Review {date}',
    reviewDate: 'Review date',
    save: 'Save',
    saveFailed: 'Save failed',
    saved: 'Saved',
    saving: 'Saving...',
    search: 'Search...',
    searchTheWiki: 'Search the wiki...',
    searching: 'Searching...',
    signIn: 'Sign in',
    signInWith: 'Sign in with {provider}',
    signInWithPasskey: 'Sign in with passkey',
    signOut: 'Sign out',
    signInCreate: 'Sign in to create it',
    needAccount: 'Need an account? Register',
    haveAccount: 'Have an account? Sign in',
    seededAdmin: 'Seeded admin:',
    space: 'Space {space}',
    thisPageMissing: 'This page does not exist yet',
    unsavedChanges: 'Unsaved changes',
    unsavedDraftKept: 'Unsaved draft kept for merge',
    updated: 'Updated {date}',
    visual: 'Visual',
    welcomeBack: 'Welcome back.',
    twoFactorCodeIfEnabled: '2FA code if enabled',
  },
  ja: {
    admin: '管理',
    archive: 'アーカイブ',
    assets: 'アセット',
    backToPage: 'ページへ戻る',
    commandPalette: 'コマンドパレット',
    copied: 'コピー済み',
    copyPath: 'パスをコピー',
    createAccount: 'アカウント作成',
    createThisPage: 'このページを作成',
    delete: '削除',
    discardUnsavedChanges: '未保存の変更を破棄しますか？',
    edit: '編集',
    events: 'イベント',
    email: 'メール',
    graph: 'グラフ',
    displayName: '表示名',
    firstAccountAdmin: '最初に登録したアカウントが管理者になります。',
    history: '履歴',
    html: 'HTML',
    keepLatest: '最新版を使う',
    loading: '読み込み中...',
    loadingEditor: 'エディタを読み込み中...',
    locale: 'ロケール',
    markdown: 'Markdown',
    newChild: '子ページを作成',
    newPage: '+ 新規ページ',
    noResults: '「{query}」の結果はありません。',
    pageTitle: 'ページタイトル',
    password: 'パスワード',
    pathPlaceholder: 'path/to/page',
    restoreDraft: '自分の下書きを戻す',
    review: 'レビュー {date}',
    reviewDate: 'レビュー日',
    save: '保存',
    saveFailed: '保存失敗',
    saved: '保存済み',
    saving: '保存中...',
    search: '検索...',
    searchTheWiki: 'Wikiを検索...',
    searching: '検索中...',
    signIn: 'ログイン',
    signInWith: '{provider}でログイン',
    signInWithPasskey: 'パスキーでログイン',
    signOut: 'ログアウト',
    signInCreate: 'ログインして作成',
    needAccount: 'アカウントが必要ですか？登録',
    haveAccount: 'アカウントがありますか？ログイン',
    seededAdmin: '初期管理者:',
    space: 'スペース {space}',
    thisPageMissing: 'このページはまだありません',
    unsavedChanges: '未保存の変更',
    unsavedDraftKept: '未保存の下書きを保持しています',
    updated: '更新 {date}',
    visual: 'ビジュアル',
    welcomeBack: 'おかえりなさい。',
    twoFactorCodeIfEnabled: '有効な場合は2FAコード',
  },
} as const satisfies Record<Locale, Record<string, string>>

export type MessageKey = keyof typeof messages.en

const supportedLocales = Object.keys(messages) as Locale[]

const localStorageOrNull = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null
  } catch {
    return null
  }
}

const normalizeLocale = (value: string | null | undefined): Locale | null => {
  const lang = value?.trim().toLowerCase().split('-')[0]
  return supportedLocales.includes(lang as Locale) ? lang as Locale : null
}

const readBrowserLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en'
  const stored = normalizeLocale(localStorageOrNull()?.getItem(localeStorageKey))
  if (stored) return stored
  return normalizeLocale(window.navigator.language) ?? 'en'
}

const currentLocale = ref<Locale>(readBrowserLocale())

export const setLocale = (next: Locale): void => {
  currentLocale.value = next
  localStorageOrNull()?.setItem(localeStorageKey, next)
}

export const t = (key: MessageKey, values: Record<string, string | number> = {}): string =>
  messages[currentLocale.value][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))

export const formatDate = (value: number | Date): string =>
  new Intl.DateTimeFormat(currentLocale.value, { dateStyle: 'medium' }).format(new Date(value))

export const formatDateTime = (value: number | Date): string =>
  new Intl.DateTimeFormat(currentLocale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

export const useI18n = () => ({
  locale: computed(() => currentLocale.value),
  setLocale,
  t,
  formatDate,
  formatDateTime,
})
