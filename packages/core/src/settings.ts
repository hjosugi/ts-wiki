import type { DateFormatStyle } from './markdown.ts'

export interface NavLink {
  readonly label: string
  readonly url: string
  readonly icon: string
  readonly children: NavLink[]
}

export interface NavLinkInput {
  readonly label: string
  readonly url: string
  readonly icon?: string
  readonly children?: NavLinkInput[]
}

export type BuiltInNavKey = 'changes' | 'events' | 'graph' | 'redirects' | 'templates' | 'new'

export interface BuiltInNavItem {
  readonly key: BuiltInNavKey
  readonly visible: boolean
}

export type SiteTheme = 'system' | 'light' | 'dark'
export type RegistrationMode = 'open' | 'off'

export interface SiteSettings {
  readonly siteTitle: string
  readonly accentColor: string
  readonly theme: SiteTheme
  readonly homePath: string
  readonly defaultLocale: string
  readonly timezone: string
  readonly dateFormat: DateFormatStyle
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

export interface PublicSettings extends SiteSettings {
  readonly privateWiki: boolean
  readonly registration: RegistrationMode
  readonly mailConfigured: boolean
  readonly requireEmailVerification: boolean
  readonly requireTwoFactor: boolean
}

export interface SettingsPatch {
  readonly siteTitle?: string
  readonly accentColor?: string
  readonly theme?: SiteTheme
  readonly homePath?: string
  readonly defaultLocale?: string
  readonly timezone?: string
  readonly dateFormat?: DateFormatStyle
  readonly navLinks?: NavLinkInput[]
  readonly navItems?: BuiltInNavItem[]
  readonly logoUrl?: string
  readonly faviconUrl?: string
  readonly footerText?: string
  readonly footerLinks?: NavLinkInput[]
  readonly customCss?: string
  readonly customHeadHtml?: string
  readonly enableMath?: boolean
  readonly enableEmoji?: boolean
  readonly enableMermaid?: boolean
}

export const BUILT_IN_NAV_KEYS: readonly BuiltInNavKey[] = [
  'changes',
  'events',
  'graph',
  'redirects',
  'templates',
  'new',
]

export const SITE_SETTING_KEYS = [
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
] as const satisfies readonly (keyof SiteSettings)[]

export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]

export const defaultNavItems = (): BuiltInNavItem[] =>
  BUILT_IN_NAV_KEYS.map((key) => ({ key, visible: true }))

export const DEFAULT_NAV_ITEMS: BuiltInNavItem[] = defaultNavItems()

export const defaultSiteSettings = (): SiteSettings => ({
  siteTitle: 'ts-wiki',
  accentColor: '#7c3aed',
  theme: 'system',
  homePath: 'home',
  defaultLocale: 'und',
  timezone: 'UTC',
  dateFormat: 'medium',
  navLinks: [],
  navItems: defaultNavItems(),
  logoUrl: '',
  faviconUrl: '',
  footerText: '',
  footerLinks: [],
  customCss: '',
  customHeadHtml: '',
  enableMath: false,
  enableEmoji: true,
  enableMermaid: false,
})

export const DEFAULT_SITE_SETTINGS: SiteSettings = defaultSiteSettings()

export const defaultPublicSettings = (): PublicSettings => ({
  ...defaultSiteSettings(),
  privateWiki: false,
  registration: 'open',
  mailConfigured: false,
  requireEmailVerification: false,
  requireTwoFactor: false,
})

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = defaultPublicSettings()
