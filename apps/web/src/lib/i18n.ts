import { computed, ref } from 'vue'
import type { DateFormatStyle } from '@ts-wiki/core'
export type { DateFormatStyle } from '@ts-wiki/core'

export type Locale = 'en' | 'ja'

const localeStorageKey = 'ts-wiki-locale'

export const messages = {
  en: {
    admin: 'Admin',
    archive: 'Archive',
    assets: 'Assets',
    backToPage: 'Back to page',
    changes: 'Changes',
    commandPalette: 'Command palette',
    copied: 'Copied',
    copyPath: 'Copy path',
    copyShareLink: 'Copy share link',
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
	    forgotPassword: 'Forgot password?',
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
	    passwordResetComplete: 'Password updated. You can sign in with the new password.',
	    passwordResetIfExists: 'If that account exists, a reset link has been sent.',
	    passwordResetPrompt: 'Enter your email to receive a reset link.',
	    pathPlaceholder: 'path/to/page',
	    chooseNewPassword: 'Choose a new password.',
    restoreDraft: 'Restore my draft',
    review: 'Review {date}',
    reviewDate: 'Review date',
    redirects: 'Redirects',
    revokeShare: 'Revoke share',
    save: 'Save',
    saveFailed: 'Save failed',
    saved: 'Saved',
    saving: 'Saving...',
    search: 'Search...',
    searchTheWiki: 'Search the wiki...',
    searching: 'Searching...',
    share: 'Share',
    shareLinkCopied: 'Share link copied',
    sharedPage: 'Shared page',
    sharedPageUnavailable: 'Shared page unavailable',
    shareReady: 'Share link ready',
    signIn: 'Sign in',
    signInWith: 'Sign in with {provider}',
	    signInWithPasskey: 'Sign in with passkey',
	    signOut: 'Sign out',
	    signInCreate: 'Sign in to create it',
	    sendResetLink: 'Send reset link',
	    resetPassword: 'Reset password',
	    newPassword: 'New password',
	    emailVerified: 'Email verified. You can sign in now.',
	    emailVerificationFailed: 'Email verification failed.',
	    verificationEmailSent: 'Check your email to verify the account before signing in.',
	    needAccount: 'Need an account? Register',
    haveAccount: 'Have an account? Sign in',
    seededAdmin: 'Seeded admin:',
    space: 'Space {space}',
	    thisPageMissing: 'This page does not exist yet',
	    twoFactorSetup: 'Set up two-factor authentication',
	    twoFactorSetupRequired: 'Two-factor authentication is required before signing in.',
	    enableTwoFactor: 'Enable 2FA',
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
    changes: '変更',
    commandPalette: 'コマンドパレット',
    copied: 'コピー済み',
    copyPath: 'パスをコピー',
    copyShareLink: '共有リンクをコピー',
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
	    forgotPassword: 'パスワードを忘れた場合',
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
	    passwordResetComplete: 'パスワードを更新しました。新しいパスワードでログインできます。',
	    passwordResetIfExists: 'アカウントが存在する場合、リセットリンクを送信しました。',
	    passwordResetPrompt: 'リセットリンクを受け取るメールアドレスを入力してください。',
	    pathPlaceholder: 'path/to/page',
	    chooseNewPassword: '新しいパスワードを入力してください。',
    restoreDraft: '自分の下書きを戻す',
    review: 'レビュー {date}',
    reviewDate: 'レビュー日',
    redirects: 'リダイレクト',
    revokeShare: '共有を停止',
    save: '保存',
    saveFailed: '保存失敗',
    saved: '保存済み',
    saving: '保存中...',
    search: '検索...',
    searchTheWiki: 'Wikiを検索...',
    searching: '検索中...',
    share: '共有',
    shareLinkCopied: '共有リンクをコピーしました',
    sharedPage: '共有ページ',
    sharedPageUnavailable: '共有ページを表示できません',
    shareReady: '共有リンクを作成しました',
    signIn: 'ログイン',
    signInWith: '{provider}でログイン',
	    signInWithPasskey: 'パスキーでログイン',
	    signOut: 'ログアウト',
	    signInCreate: 'ログインして作成',
	    sendResetLink: 'リセットリンクを送信',
	    resetPassword: 'パスワードをリセット',
	    newPassword: '新しいパスワード',
	    emailVerified: 'メールを確認しました。ログインできます。',
	    emailVerificationFailed: 'メール確認に失敗しました。',
	    verificationEmailSent: 'ログインする前に、メールを確認してください。',
	    needAccount: 'アカウントが必要ですか？登録',
    haveAccount: 'アカウントがありますか？ログイン',
    seededAdmin: '初期管理者:',
    space: 'スペース {space}',
	    thisPageMissing: 'このページはまだありません',
	    twoFactorSetup: '2FAを設定',
	    twoFactorSetupRequired: 'ログインする前に2FAの設定が必要です。',
	    enableTwoFactor: '2FAを有効化',
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
const dateSettings = ref<{
  locale: string
  timezone: string
  dateFormat: DateFormatStyle
}>({
  locale: 'und',
  timezone: 'UTC',
  dateFormat: 'medium',
})

export const setLocale = (next: Locale): void => {
  currentLocale.value = next
  localStorageOrNull()?.setItem(localeStorageKey, next)
}

export const t = (key: MessageKey, values: Record<string, string | number> = {}): string =>
  messages[currentLocale.value][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))

export const setDateFormatSettings = (settings: {
  readonly defaultLocale?: string
  readonly timezone?: string
  readonly dateFormat?: DateFormatStyle
}): void => {
  dateSettings.value = {
    locale: settings.defaultLocale || 'und',
    timezone: settings.timezone || 'UTC',
    dateFormat: settings.dateFormat ?? 'medium',
  }
}

const dateLocale = (): string =>
  dateSettings.value.locale && dateSettings.value.locale !== 'und' ? dateSettings.value.locale : currentLocale.value

export const formatDate = (value: number | Date): string =>
  new Intl.DateTimeFormat(dateLocale(), {
    dateStyle: dateSettings.value.dateFormat,
    timeZone: dateSettings.value.timezone,
  }).format(new Date(value))

export const formatDateTime = (value: number | Date): string =>
  new Intl.DateTimeFormat(dateLocale(), {
    dateStyle: dateSettings.value.dateFormat,
    timeStyle: 'short',
    timeZone: dateSettings.value.timezone,
  }).format(new Date(value))

export const useI18n = () => ({
  locale: computed(() => currentLocale.value),
  setLocale,
  setDateFormatSettings,
  t,
  formatDate,
  formatDateTime,
})
