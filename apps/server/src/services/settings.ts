import {
  type AppError,
  type Principal,
  type Result,
  err,
  normalizeLocale,
  normalizePath,
  ok,
  requirePermission,
  validationError,
} from '@ts-wiki/core'
import type { DB } from '../db/client.ts'
import { siteSettings } from '../db/schema.ts'

export interface NavLink {
  readonly label: string
  readonly url: string
  readonly icon: string
  readonly children: NavLink[]
}

export interface NavLinkInput {
  readonly label: string
  readonly url?: string
  readonly icon?: string
  readonly children?: readonly NavLinkInput[]
}

export type BuiltInNavKey = 'changes' | 'events' | 'graph' | 'redirects' | 'templates' | 'new'

export interface BuiltInNavItem {
  readonly key: BuiltInNavKey
  readonly visible: boolean
}

export interface PublicSettings {
  readonly siteTitle: string
  readonly accentColor: string
  readonly theme: 'system' | 'light' | 'dark'
  readonly homePath: string
  readonly defaultLocale: string
  readonly timezone: string
  readonly dateFormat: 'short' | 'medium' | 'long'
  readonly navLinks: NavLink[]
  readonly navItems: BuiltInNavItem[]
  readonly logoUrl: string
  readonly faviconUrl: string
  readonly footerText: string
  readonly footerLinks: NavLink[]
  readonly customCss: string
  readonly customHeadHtml: string
  readonly enableMath: boolean
  readonly enableEmoji: boolean
  readonly enableMermaid: boolean
}

export interface SettingsPatch {
  readonly siteTitle?: string
  readonly accentColor?: string
  readonly theme?: 'system' | 'light' | 'dark'
  readonly homePath?: string
  readonly defaultLocale?: string
  readonly timezone?: string
  readonly dateFormat?: 'short' | 'medium' | 'long'
  readonly navLinks?: readonly NavLinkInput[]
  readonly navItems?: readonly BuiltInNavItem[]
  readonly logoUrl?: string
  readonly faviconUrl?: string
  readonly footerText?: string
  readonly footerLinks?: readonly NavLinkInput[]
  readonly customCss?: string
  readonly customHeadHtml?: string
  readonly enableMath?: boolean
  readonly enableEmoji?: boolean
  readonly enableMermaid?: boolean
}

export interface SettingsService {
  public(): PublicSettings
  update(principal: Principal | null, patch: SettingsPatch): Result<PublicSettings, AppError>
}

const BUILT_IN_NAV_KEYS: readonly BuiltInNavKey[] = ['changes', 'events', 'graph', 'redirects', 'templates', 'new']

const DEFAULT_NAV_ITEMS: BuiltInNavItem[] = BUILT_IN_NAV_KEYS.map((key) => ({ key, visible: true }))

const DEFAULT_SETTINGS: PublicSettings = {
  siteTitle: 'ts-wiki',
  accentColor: '#7c3aed',
  theme: 'system',
  homePath: 'home',
  defaultLocale: 'und',
  timezone: 'UTC',
  dateFormat: 'medium',
  navLinks: [],
  navItems: DEFAULT_NAV_ITEMS,
  logoUrl: '',
  faviconUrl: '',
  footerText: '',
  footerLinks: [],
  customCss: '',
  customHeadHtml: '',
  enableMath: false,
  enableEmoji: true,
  enableMermaid: false,
}

export interface SettingsServiceOptions {
  readonly defaults?: Partial<Pick<
    PublicSettings,
    'siteTitle' | 'accentColor' | 'theme' | 'defaultLocale' | 'timezone' | 'dateFormat'
  >>
  readonly allowHeadInjection?: boolean
}

const SETTING_KEYS = [
  'siteTitle',
  'accentColor',
  'theme',
  'homePath',
  'defaultLocale',
  'timezone',
  'dateFormat',
  'navLinks',
  'navItems',
  'logoUrl',
  'faviconUrl',
  'footerText',
  'footerLinks',
  'customCss',
  'customHeadHtml',
  'enableMath',
  'enableEmoji',
  'enableMermaid',
] as const
type SettingKey = (typeof SETTING_KEYS)[number]

const isSettingKey = (value: string): value is SettingKey => SETTING_KEYS.includes(value as SettingKey)

const cleanHomePath = (value: string): string => normalizePath(value) || 'home'

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

const cleanDateFormat = (value: string): PublicSettings['dateFormat'] =>
  value === 'short' || value === 'medium' || value === 'long' ? value : 'medium'

const cleanUrl = (value: string): string => {
  const clean = value.trim().slice(0, 500)
  return clean && (/^https?:\/\//i.test(clean) || clean.startsWith('/')) ? clean : ''
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

const parseStoredValue = (key: SettingKey, value: string): unknown => {
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
  if (key === 'defaultLocale') return normalizeLocale(value)
  if (key === 'timezone') return cleanTimezone(value)
  if (key === 'dateFormat') return cleanDateFormat(value)
  if (key === 'enableMath' || key === 'enableEmoji' || key === 'enableMermaid') return value === 'true'
  return value
}

const validatePatch = (
  current: PublicSettings,
  patch: SettingsPatch,
  allowHeadInjection: boolean,
): Result<PublicSettings, AppError> => {
  const siteTitle = patch.siteTitle === undefined ? current.siteTitle : patch.siteTitle.trim().slice(0, 80)
  if (!siteTitle) return err(validationError('Site title is required', 'siteTitle'))

  const accentColor = patch.accentColor ?? current.accentColor
  if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
    return err(validationError('Accent color must be a hex color like #7c3aed', 'accentColor'))
  }

  const theme = patch.theme ?? current.theme
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') {
    return err(validationError('Unknown theme', 'theme'))
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
    homePath: patch.homePath === undefined ? current.homePath : cleanHomePath(patch.homePath),
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
  const defaults = { ...DEFAULT_SETTINGS, ...options.defaults }
  const allowHeadInjection = options.allowHeadInjection ?? false
  const read = (): PublicSettings => {
    const next: Record<SettingKey, unknown> = { ...defaults }
    for (const row of db.select().from(siteSettings).all()) {
      if (isSettingKey(row.key)) next[row.key] = parseStoredValue(row.key, row.value)
    }
    if (!allowHeadInjection) next.customHeadHtml = ''
    return next as unknown as PublicSettings
  }

  const write = (settings: PublicSettings): void => {
    const now = Date.now()
    const rows: Array<{ key: SettingKey; value: string; updatedAt: number }> = [
      { key: 'siteTitle', value: settings.siteTitle, updatedAt: now },
      { key: 'accentColor', value: settings.accentColor, updatedAt: now },
      { key: 'theme', value: settings.theme, updatedAt: now },
      { key: 'homePath', value: settings.homePath, updatedAt: now },
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
