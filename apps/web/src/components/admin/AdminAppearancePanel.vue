<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type PublicSettings } from '@/lib/api'
import { applyBranding } from '@/lib/branding'
import { setMarkdownFeatureSettings } from '@/lib/markdownEnhance'
import { setDateFormatSettings } from '@/lib/i18n'
import Skeleton from '@/components/Skeleton.vue'

type EditablePublicSettings = { -readonly [K in keyof PublicSettings]: PublicSettings[K] }
type ThemePreset = PublicSettings['themePreset']
type FontFamily = PublicSettings['fontFamily']
type BackgroundType = PublicSettings['background']['type']

const themePresets: Array<{ value: ThemePreset; label: string; note: string }> = [
  { value: 'classic', label: 'Classic', note: 'Default wiki palette' },
  { value: 'kawaii', label: 'Kawaii', note: 'Soft pink surfaces' },
  { value: 'pop', label: 'Pop', note: 'Bright cyan accents' },
  { value: 'minimal', label: 'Minimal', note: 'Quiet neutral UI' },
  { value: 'gamer', label: 'Gamer', note: 'High contrast neon' },
  { value: 'custom', label: 'Custom', note: 'Use custom CSS' },
]

const fontOptions: Array<{ value: FontFamily; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'maru', label: 'Maru Gothic' },
  { value: 'sans-jp', label: 'Japanese sans' },
  { value: 'serif', label: 'Serif' },
]

const backgroundDefaults: Record<BackgroundType, string> = {
  none: '',
  color: '#f9fafb',
  gradient: 'linear-gradient(135deg, #f8fafc 0%, #ecfeff 48%, #fdf2f8 100%)',
  pattern: 'dots',
  image: '',
}

const settings = ref<EditablePublicSettings | null>(null)
const navLinksText = ref('')
const navItemsText = ref('')
const footerLinksText = ref('')
const saving = ref(false)
const loading = ref(false)
const uploading = ref<'logo' | 'favicon' | 'background' | null>(null)
const error = ref<string | null>(null)

function setBackgroundType(type: BackgroundType): void {
  if (!settings.value) return
  settings.value.background = {
    type,
    value: backgroundDefaults[type],
    overlayOpacity: type === 'none' ? 0 : settings.value.background.overlayOpacity,
  }
}

function onBackgroundTypeChange(event: Event): void {
  setBackgroundType((event.target as HTMLSelectElement).value as BackgroundType)
}

function parseLinks(value: string): PublicSettings['navLinks'] {
  const links: PublicSettings['navLinks'] = []
  let currentGroup: PublicSettings['navLinks'][number] | null = null
  for (const rawLine of value.split(/\r?\n/)) {
    const isChild = /^\s+/.test(rawLine)
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split('|').map((part) => part.trim())
    const hasIcon = parts.length >= 3
    const icon = hasIcon ? parts[0] ?? '' : ''
    const label = hasIcon ? parts[1] ?? '' : parts[0] ?? ''
    const url = hasIcon ? parts[2] ?? '' : parts[1] ?? ''
    if (!label) continue
    const link = { label, url, icon, children: [] }
    if (isChild && currentGroup) currentGroup.children.push(link)
    else {
      links.push(link)
      currentGroup = link
    }
  }
  return links
}

function formatLinks(links: PublicSettings['navLinks']): string {
  return links
    .flatMap((link) => {
      const line = `${link.icon ? `${link.icon}|` : ''}${link.label}|${link.url}`
      const children = link.children.map((child) => `  ${child.icon ? `${child.icon}|` : ''}${child.label}|${child.url}`)
      return [line, ...children]
    })
    .join('\n')
}

function parseNavItems(value: string): PublicSettings['navItems'] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key = '', visible = 'true'] = line.split('|').map((part) => part.trim())
      return { key: key as PublicSettings['navItems'][number]['key'], visible: visible !== 'false' && visible !== '0' }
    })
}

function formatNavItems(items: PublicSettings['navItems']): string {
  return items.map((item) => `${item.key}|${item.visible ? 'true' : 'false'}`).join('\n')
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    settings.value = await Api.publicSettings()
    navLinksText.value = formatLinks(settings.value.navLinks)
    navItemsText.value = formatNavItems(settings.value.navItems)
    footerLinksText.value = formatLinks(settings.value.footerLinks)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function saveSettings(): Promise<void> {
  if (!settings.value) return
  saving.value = true
  error.value = null
  try {
    const saved = await Api.adminUpdateSettings({
      siteTitle: settings.value.siteTitle,
      accentColor: settings.value.accentColor,
      theme: settings.value.theme,
      themePreset: settings.value.themePreset,
      fontFamily: settings.value.fontFamily,
      background: settings.value.background,
      homePath: settings.value.homePath,
      dailyNotesPath: settings.value.dailyNotesPath,
      defaultLocale: settings.value.defaultLocale,
      timezone: settings.value.timezone,
      dateFormat: settings.value.dateFormat,
      navLinks: parseLinks(navLinksText.value),
      navItems: parseNavItems(navItemsText.value),
      logoUrl: settings.value.logoUrl,
      faviconUrl: settings.value.faviconUrl,
      footerText: settings.value.footerText,
      footerLinks: parseLinks(footerLinksText.value),
      customCss: settings.value.customCss,
      customHeadHtml: settings.value.customHeadHtml,
      enableMath: settings.value.enableMath,
      enableEmoji: settings.value.enableEmoji,
      enableMermaid: settings.value.enableMermaid,
    })
    settings.value = { ...settings.value, ...saved }
    applyBranding(settings.value)
    setMarkdownFeatureSettings(settings.value)
    setDateFormatSettings(settings.value)
    navLinksText.value = formatLinks(settings.value.navLinks)
    navItemsText.value = formatNavItems(settings.value.navItems)
    footerLinksText.value = formatLinks(settings.value.footerLinks)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function uploadBrandAsset(kind: 'logo' | 'favicon' | 'background', files: FileList | null): Promise<void> {
  if (!settings.value || !files?.[0]) return
  uploading.value = kind
  error.value = null
  try {
    const asset = await Api.uploadAsset(files[0], 'branding')
    if (kind === 'logo') settings.value.logoUrl = asset.url
    else if (kind === 'favicon') settings.value.faviconUrl = asset.url
    else {
      settings.value.background = {
        type: 'image',
        value: asset.url,
        overlayOpacity: settings.value.background.overlayOpacity || 0.2,
      }
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    uploading.value = null
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Appearance</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <Skeleton v-if="loading" class="mb-3" label="Loading appearance settings" :lines="4" />
    <form v-if="settings" class="card p-4 space-y-4 max-w-3xl" @submit.prevent="saveSettings">
      <input v-model="settings.siteTitle" class="input" placeholder="Site title" aria-label="Site title" />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input v-model="settings.accentColor" class="input" placeholder="#7c3aed" aria-label="Accent color" />
        <select v-model="settings.theme" class="input" aria-label="Theme"><option value="system">system</option><option value="light">light</option><option value="dark">dark</option></select>
      </div>
      <fieldset class="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        <legend class="px-1 font-medium">Theme preset</legend>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            v-for="preset in themePresets"
            :key="preset.value"
            type="button"
            class="rounded-[var(--radius)] border px-3 py-2 text-left transition"
            :class="settings.themePreset === preset.value ? 'border-[var(--c-accent)] bg-[var(--c-surface-muted)] text-[var(--c-text)]' : 'border-[var(--c-border)] text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)]'"
            :aria-pressed="settings.themePreset === preset.value"
            @click="settings.themePreset = preset.value"
          >
            <span class="block font-semibold">{{ preset.label }}</span>
            <span class="block text-xs">{{ preset.note }}</span>
          </button>
        </div>
      </fieldset>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">Font</span>
          <select v-model="settings.fontFamily" class="input">
            <option v-for="font in fontOptions" :key="font.value" :value="font.value">{{ font.label }}</option>
          </select>
        </label>
        <label class="space-y-1 text-sm">
          <span class="font-medium">Background type</span>
          <select
            class="input"
            :value="settings.background.type"
            @change="onBackgroundTypeChange"
          >
            <option value="none">none</option>
            <option value="color">color</option>
            <option value="gradient">gradient</option>
            <option value="pattern">pattern</option>
            <option value="image">image</option>
          </select>
        </label>
      </div>
      <div v-if="settings.background.type !== 'none'" class="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label v-if="settings.background.type === 'color'" class="space-y-1">
            <span class="font-medium">Background color</span>
            <input v-model="settings.background.value" class="input" placeholder="#f9fafb" />
          </label>
          <label v-else-if="settings.background.type === 'gradient'" class="space-y-1">
            <span class="font-medium">Gradient</span>
            <input v-model="settings.background.value" class="input font-mono text-xs" placeholder="linear-gradient(...)" />
          </label>
          <label v-else-if="settings.background.type === 'pattern'" class="space-y-1">
            <span class="font-medium">Pattern</span>
            <select v-model="settings.background.value" class="input">
              <option value="dots">dots</option>
              <option value="grid">grid</option>
              <option value="stars">stars</option>
              <option value="diagonal">diagonal</option>
            </select>
          </label>
          <label v-else class="space-y-1">
            <span class="font-medium">Background image</span>
            <input v-model="settings.background.value" class="input" placeholder="/assets/background.jpg" />
            <input class="text-sm" type="file" accept="image/*" aria-label="Upload background" @change="uploadBrandAsset('background', ($event.target as HTMLInputElement).files)" />
            <span v-if="uploading === 'background'" class="text-xs text-[var(--c-text-muted)]">Uploading...</span>
          </label>
          <label class="space-y-1">
            <span class="font-medium">Overlay</span>
            <input v-model.number="settings.background.overlayOpacity" class="w-full" type="range" min="0" max="0.85" step="0.05" />
            <span class="text-xs text-[var(--c-text-muted)]">{{ Math.round(settings.background.overlayOpacity * 100) }}%</span>
          </label>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">Home page path</span>
          <input v-model="settings.homePath" class="input font-mono text-sm" placeholder="home" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="font-medium">Daily notes path</span>
          <input v-model="settings.dailyNotesPath" class="input font-mono text-sm" placeholder="journal" />
        </label>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">Default locale</span>
          <input v-model="settings.defaultLocale" class="input" placeholder="en" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="font-medium">Timezone</span>
          <input v-model="settings.timezone" class="input" placeholder="UTC" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="font-medium">Date format</span>
          <select v-model="settings.dateFormat" class="input">
            <option value="short">short</option>
            <option value="medium">medium</option>
            <option value="long">long</option>
          </select>
        </label>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="font-medium">Logo URL</span>
          <input v-model="settings.logoUrl" class="input" placeholder="/assets/logo.png" />
          <input class="text-sm" type="file" accept="image/*" aria-label="Upload logo" @change="uploadBrandAsset('logo', ($event.target as HTMLInputElement).files)" />
          <span v-if="uploading === 'logo'" class="text-xs text-[var(--c-text-muted)]">Uploading...</span>
        </label>
        <label class="space-y-1 text-sm">
          <span class="font-medium">Favicon URL</span>
          <input v-model="settings.faviconUrl" class="input" placeholder="/assets/favicon.png" />
          <input class="text-sm" type="file" accept="image/*" aria-label="Upload favicon" @change="uploadBrandAsset('favicon', ($event.target as HTMLInputElement).files)" />
          <span v-if="uploading === 'favicon'" class="text-xs text-[var(--c-text-muted)]">Uploading...</span>
        </label>
      </div>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Header links</span>
        <textarea v-model="navLinksText" class="input min-h-24 font-mono text-sm" placeholder="📚|Docs|/docs&#10;Links|&#10;  ▶|YouTube|https://youtube.com/@handle"></textarea>
      </label>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Built-in navigation</span>
        <textarea v-model="navItemsText" class="input min-h-28 font-mono text-sm" placeholder="changes|true&#10;events|true&#10;graph|true&#10;redirects|true&#10;templates|true&#10;new|true"></textarea>
      </label>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Footer text</span>
        <input v-model="settings.footerText" class="input" placeholder="© Your team" />
      </label>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Footer links</span>
        <textarea v-model="footerLinksText" class="input min-h-20 font-mono text-sm" placeholder="Terms|/terms&#10;Contact|https://example.com/contact"></textarea>
      </label>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Custom CSS</span>
        <textarea v-model="settings.customCss" class="input min-h-36 font-mono text-sm" placeholder=":root { --radius: 0.75rem; }"></textarea>
      </label>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Custom head HTML</span>
        <textarea v-model="settings.customHeadHtml" class="input min-h-28 font-mono text-sm" placeholder="<script defer data-domain=&quot;wiki.example.com&quot; src=&quot;https://plausible.io/js/script.js&quot;></script>"></textarea>
        <span class="text-xs text-[var(--c-text-muted)]">Applied only when TS_WIKI_ALLOW_HEAD_INJECTION is enabled on the server.</span>
      </label>
      <fieldset class="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        <legend class="px-1 font-medium">Markdown features</legend>
        <label class="flex items-center gap-2">
          <input v-model="settings.enableEmoji" type="checkbox" />
          <span>Emoji shortcodes</span>
        </label>
        <label class="flex items-center gap-2">
          <input v-model="settings.enableMath" type="checkbox" />
          <span>KaTeX math</span>
        </label>
        <label class="flex items-center gap-2">
          <input v-model="settings.enableMermaid" type="checkbox" />
          <span>Mermaid diagrams</span>
        </label>
      </fieldset>
      <button class="btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save appearance' }}</button>
    </form>
  </section>
</template>
