import {
  type AppError,
  BUILT_IN_NAV_KEYS,
  DEFAULT_NAV_ITEMS,
  SITE_SETTING_KEYS,
  defaultSiteSettings,
  type BuiltInNavItem,
  type BuiltInNavKey,
  type NavLink,
  type NavLinkInput,
  type Principal,
  type Result,
  type SettingsPatch,
  type SiteBackground,
  type SiteSettingKey,
  type SiteSettings,
  err,
  normalizeLocale,
  normalizePath,
  ok,
  requirePermission,
  validationError,
} from '@kawaii-wiki/core'
import type { DB } from '../db/client.ts'
import { siteSettings } from '../db/schema.ts'

export type { BuiltInNavItem, BuiltInNavKey, NavLink, NavLinkInput, SettingsPatch, SiteSettings }

export interface SettingsService {
  public(): SiteSettings
  update(principal: Principal | null, patch: SettingsPatch): Result<SiteSettings, AppError>
}

export interface SettingsServiceOptions {
  readonly defaults?: Partial<SiteSettings>
  readonly allowHeadInjection?: boolean
}

const isSettingKey = (value: string): value is SiteSettingKey =>
  SITE_SETTING_KEYS.includes(value as SiteSettingKey)

const cleanHomePath = (value: string): string => normalizePath(value) || 'home'
const cleanDailyNotesPath = (value: string): string => normalizePath(value) || 'journal'

const LOCALE_PATTERN = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/

const validLocale = (value: string): boolean => LOCALE_PATTERN.test(value.trim())

const validTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

const cleanTimezone = (value: string): string => {
  const timezone = value.trim() || 'UTC'
  return validTimezone(timezone) ? timezone : 'UTC'
}

const cleanDateFormat = (value: string): SiteSettings['dateFormat'] =>
  value === 'short' || value === 'medium' || value === 'long' ? value : 'medium'

const cleanEditorMode = (value: string): SiteSettings['defaultEditorMode'] =>
  value === 'markdown' || value === 'visual' ? value : 'visual'

const cleanThemePreset = (value: string): SiteSettings['themePreset'] =>
  value === 'kawaii' || value === 'pop' || value === 'minimal' || value === 'gamer' || value === 'custom'
    ? value
    : 'classic'

const cleanFontFamily = (value: string): SiteSettings['fontFamily'] =>
  value === 'rounded' || value === 'maru' || value === 'sans-jp' || value === 'serif' ? value : 'system'

const cleanPositiveInteger = (value: number, fallback: number): number =>
  Number.isSafeInteger(value) && value > 0 ? value : fallback

const cleanUrl = (value: string): string => {
  const clean = value.trim().slice(0, 500)
  return clean && (/^https?:\/\//i.test(clean) || clean.startsWith('/')) ? clean : ''
}

const cleanBackground = (value: SiteBackground | undefined, fallback: SiteBackground): SiteBackground => {
  if (!value || typeof value !== 'object') return fallback
  const type = value.type
  const overlayOpacity = Math.max(0, Math.min(0.85, Number(value.overlayOpacity) || 0))
  const raw = String(value.value ?? '').trim().slice(0, 500)
  if (type === 'none') return { type: 'none', value: '', overlayOpacity: 0 }
  if (type === 'image') return { type: 'image', value: cleanUrl(raw), overlayOpacity }
  if (type === 'color') {
    return /^#[0-9a-f]{6}$/i.test(raw) ? { type: 'color', value: raw, overlayOpacity } : fallback
  }
  if (type === 'pattern') {
    const pattern = ['dots', 'grid', 'stars', 'diagonal'].includes(raw) ? raw : 'dots'
    return { type: 'pattern', value: pattern, overlayOpacity }
  }
  if (type === 'gradient') {
    const safe = /^[-#%,.() a-z0-9]+$/i.test(raw) && !/url|expression|;/i.test(raw) ? raw : ''
    return safe ? { type: 'gradient', value: safe, overlayOpacity } : fallback
  }
  return fallback
}

const cleanNavLinks = (links: readonly NavLinkInput[] = [], depth = 0): NavLink[] =>
  links
    .map((link) => {
      const children = depth === 0 ? cleanNavLinks(link.children ?? [], 1) : []
      return {
        label: link.label.trim().slice(0, 60),
        url: cleanUrl(link.url ?? ''),
        icon: (link.icon ?? '').trim().slice(0, 16),
        children,
      }
    })
    .filter((link) => link.label && (link.url || link.children.length))
    .slice(0, 12)

const cleanNavItems = (items: readonly BuiltInNavItem[] = DEFAULT_NAV_ITEMS): BuiltInNavItem[] => {
  const seen = new Set<BuiltInNavKey>()
  const out: BuiltInNavItem[] = []
  for (const item of items) {
    if (!BUILT_IN_NAV_KEYS.includes(item.key) || seen.has(item.key)) continue
    seen.add(item.key)
    out.push({ key: item.key, visible: item.visible !== false })
  }
  for (const fallback of DEFAULT_NAV_ITEMS) {
    if (!seen.has(fallback.key)) out.push(fallback)
  }
  return out
}

const parseStoredValue = (key: SiteSettingKey, value: string): unknown => {
  if (key === 'navLinks' || key === 'footerLinks') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? cleanNavLinks(parsed as NavLink[]) : []
    } catch {
      return []
    }
  }
  if (key === 'navItems') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? cleanNavItems(parsed as BuiltInNavItem[]) : DEFAULT_NAV_ITEMS
    } catch {
      return DEFAULT_NAV_ITEMS
    }
  }
  if (key === 'homePath') return cleanHomePath(value)
  if (key === 'dailyNotesPath') return cleanDailyNotesPath(value)
  if (key === 'defaultLocale') return normalizeLocale(value)
  if (key === 'timezone') return cleanTimezone(value)
  if (key === 'dateFormat') return cleanDateFormat(value)
  if (key === 'defaultEditorMode') return cleanEditorMode(value)
  if (key === 'themePreset') return cleanThemePreset(value)
  if (key === 'fontFamily') return cleanFontFamily(value)
  if (key === 'background') {
    try {
      return cleanBackground(JSON.parse(value) as SiteBackground, defaultSiteSettings().background)
    } catch {
      return defaultSiteSettings().background
    }
  }
  if (
    key === 'privateWiki'
    || key === 'requireEmailVerification'
    || key === 'requireTwoFactor'
    || key === 'enableMath'
    || key === 'enableEmoji'
    || key === 'enableMermaid'
  ) return value === 'true'
  if (key === 'tokenTtlSeconds') return cleanPositiveInteger(Number(value), 30 * 24 * 60 * 60)
  if (key === 'assetMaxBytes') return cleanPositiveInteger(Number(value), 25 * 1024 * 1024)
  return value
}

const validatePatch = (
  current: SiteSettings,
  patch: SettingsPatch,
  allowHeadInjection: boolean,
): Result<SiteSettings, AppError> => {
  const siteTitle = patch.siteTitle === undefined ? current.siteTitle : patch.siteTitle.trim().slice(0, 80)
  if (!siteTitle) return err(validationError('Site title is required', 'siteTitle'))

  const accentColor = patch.accentColor ?? current.accentColor
  if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
    return err(validationError('Accent color must be a hex color like #c2185b', 'accentColor'))
  }

  const theme = patch.theme ?? current.theme
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') {
    return err(validationError('Unknown theme', 'theme'))
  }
  const themePreset = patch.themePreset === undefined ? current.themePreset : cleanThemePreset(patch.themePreset)
  const fontFamily = patch.fontFamily === undefined ? current.fontFamily : cleanFontFamily(patch.fontFamily)
  const background = cleanBackground(patch.background, current.background)
  const registration = patch.registration ?? current.registration
  if (registration !== 'open' && registration !== 'off') {
    return err(validationError('Registration must be open or off', 'registration'))
  }
  const tokenTtlSeconds = patch.tokenTtlSeconds ?? current.tokenTtlSeconds
  if (!Number.isSafeInteger(tokenTtlSeconds) || tokenTtlSeconds < 300 || tokenTtlSeconds > 365 * 24 * 60 * 60) {
    return err(validationError('Session lifetime must be between 5 minutes and 365 days', 'tokenTtlSeconds'))
  }
  const assetMaxBytes = patch.assetMaxBytes ?? current.assetMaxBytes
  if (!Number.isSafeInteger(assetMaxBytes) || assetMaxBytes < 1024 || assetMaxBytes > 100 * 1024 * 1024) {
    return err(validationError('Upload limit must be between 1KB and 100MB', 'assetMaxBytes'))
  }
  const defaultEditorMode = patch.defaultEditorMode ?? current.defaultEditorMode
  if (defaultEditorMode !== 'markdown' && defaultEditorMode !== 'visual') {
    return err(validationError('Default editor must be Markdown or visual', 'defaultEditorMode'))
  }
  const defaultLocale = patch.defaultLocale === undefined ? current.defaultLocale : patch.defaultLocale.trim() || 'und'
  if (!validLocale(defaultLocale)) return err(validationError('Unknown locale', 'defaultLocale'))
  const timezone = patch.timezone === undefined ? current.timezone : patch.timezone.trim() || 'UTC'
  if (!validTimezone(timezone)) return err(validationError('Unknown timezone', 'timezone'))

  const customCss = patch.customCss === undefined ? current.customCss : patch.customCss.slice(0, 20_000)
  const customHeadHtml = !allowHeadInjection
    ? ''
    : patch.customHeadHtml === undefined
      ? current.customHeadHtml
      : patch.customHeadHtml.slice(0, 20_000)

  return ok({
    siteTitle,
    accentColor,
    theme,
    themePreset,
    fontFamily,
    background,
    registration,
    privateWiki: patch.privateWiki ?? current.privateWiki,
    requireEmailVerification: patch.requireEmailVerification ?? current.requireEmailVerification,
    requireTwoFactor: patch.requireTwoFactor ?? current.requireTwoFactor,
    tokenTtlSeconds,
    assetMaxBytes,
    defaultEditorMode,
    homePath: patch.homePath === undefined ? current.homePath : cleanHomePath(patch.homePath),
    dailyNotesPath: patch.dailyNotesPath === undefined ? current.dailyNotesPath : cleanDailyNotesPath(patch.dailyNotesPath),
    defaultLocale: normalizeLocale(defaultLocale),
    timezone,
    dateFormat: patch.dateFormat === undefined ? current.dateFormat : cleanDateFormat(patch.dateFormat),
    navLinks: patch.navLinks === undefined ? current.navLinks : cleanNavLinks(patch.navLinks),
    navItems: patch.navItems === undefined ? current.navItems : cleanNavItems(patch.navItems),
    logoUrl: patch.logoUrl === undefined ? current.logoUrl : cleanUrl(patch.logoUrl),
    faviconUrl: patch.faviconUrl === undefined ? current.faviconUrl : cleanUrl(patch.faviconUrl),
    footerText: patch.footerText === undefined ? current.footerText : patch.footerText.trim().slice(0, 500),
    footerLinks: patch.footerLinks === undefined ? current.footerLinks : cleanNavLinks(patch.footerLinks),
    customCss,
    customHeadHtml,
    enableMath: patch.enableMath ?? current.enableMath,
    enableEmoji: patch.enableEmoji ?? current.enableEmoji,
    enableMermaid: patch.enableMermaid ?? current.enableMermaid,
  })
}

export const createSettingsService = (db: DB, options: SettingsServiceOptions = {}): SettingsService => {
  const defaults = { ...defaultSiteSettings(), ...options.defaults }
  const allowHeadInjection = options.allowHeadInjection ?? false
  const read = (): SiteSettings => {
    const next: SiteSettings = { ...defaults }
    for (const row of db.select().from(siteSettings).all()) {
      if (isSettingKey(row.key)) Object.assign(next, { [row.key]: parseStoredValue(row.key, row.value) })
    }
    if (!allowHeadInjection) Object.assign(next, { customHeadHtml: '' })
    return next
  }

  const write = (settings: SiteSettings): void => {
    const now = Date.now()
    const rows: Array<{ key: SiteSettingKey; value: string; updatedAt: number }> = [
      { key: 'siteTitle', value: settings.siteTitle, updatedAt: now },
      { key: 'accentColor', value: settings.accentColor, updatedAt: now },
      { key: 'theme', value: settings.theme, updatedAt: now },
      { key: 'themePreset', value: settings.themePreset, updatedAt: now },
      { key: 'fontFamily', value: settings.fontFamily, updatedAt: now },
      { key: 'background', value: JSON.stringify(settings.background), updatedAt: now },
      { key: 'registration', value: settings.registration, updatedAt: now },
      { key: 'privateWiki', value: String(settings.privateWiki), updatedAt: now },
      { key: 'requireEmailVerification', value: String(settings.requireEmailVerification), updatedAt: now },
      { key: 'requireTwoFactor', value: String(settings.requireTwoFactor), updatedAt: now },
      { key: 'tokenTtlSeconds', value: String(settings.tokenTtlSeconds), updatedAt: now },
      { key: 'assetMaxBytes', value: String(settings.assetMaxBytes), updatedAt: now },
      { key: 'defaultEditorMode', value: settings.defaultEditorMode, updatedAt: now },
      { key: 'homePath', value: settings.homePath, updatedAt: now },
      { key: 'dailyNotesPath', value: settings.dailyNotesPath, updatedAt: now },
      { key: 'defaultLocale', value: settings.defaultLocale, updatedAt: now },
      { key: 'timezone', value: settings.timezone, updatedAt: now },
      { key: 'dateFormat', value: settings.dateFormat, updatedAt: now },
      { key: 'navLinks', value: JSON.stringify(settings.navLinks), updatedAt: now },
      { key: 'navItems', value: JSON.stringify(settings.navItems), updatedAt: now },
      { key: 'logoUrl', value: settings.logoUrl, updatedAt: now },
      { key: 'faviconUrl', value: settings.faviconUrl, updatedAt: now },
      { key: 'footerText', value: settings.footerText, updatedAt: now },
      { key: 'footerLinks', value: JSON.stringify(settings.footerLinks), updatedAt: now },
      { key: 'customCss', value: settings.customCss, updatedAt: now },
      { key: 'customHeadHtml', value: settings.customHeadHtml, updatedAt: now },
      { key: 'enableMath', value: String(settings.enableMath), updatedAt: now },
      { key: 'enableEmoji', value: String(settings.enableEmoji), updatedAt: now },
      { key: 'enableMermaid', value: String(settings.enableMermaid), updatedAt: now },
    ]
    const stmt = db.$client.prepare(`
      INSERT INTO site_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    for (const row of rows) stmt.run(row.key, row.value, row.updatedAt)
  }

  return {
    public: read,
    update(principal, patch) {
      const allowed = requirePermission(principal, 'admin:access')
      if (!allowed.ok) return allowed
      const next = validatePatch(read(), patch, allowHeadInjection)
      if (!next.ok) return next
      write(next.value)
      return next
    },
  }
}
