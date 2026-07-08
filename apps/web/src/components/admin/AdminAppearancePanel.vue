<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type PublicSettings } from '@/lib/api'
import { applyBranding } from '@/lib/branding'
import { setMarkdownFeatureSettings } from '@/lib/markdownEnhance'
import { setDateFormatSettings } from '@/lib/i18n'

const settings = ref<PublicSettings | null>(null)
const navLinksText = ref('')
const navItemsText = ref('')
const footerLinksText = ref('')
const saving = ref(false)
const loading = ref(false)
const uploading = ref<'logo' | 'favicon' | null>(null)
const error = ref<string | null>(null)

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
    settings.value = await Api.adminUpdateSettings({
      siteTitle: settings.value.siteTitle,
      accentColor: settings.value.accentColor,
      theme: settings.value.theme,
      homePath: settings.value.homePath,
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

async function uploadBrandAsset(kind: 'logo' | 'favicon', files: FileList | null): Promise<void> {
  if (!settings.value || !files?.[0]) return
  uploading.value = kind
  error.value = null
  try {
    const asset = await Api.uploadAsset(files[0], 'branding')
    if (kind === 'logo') settings.value.logoUrl = asset.url
    else settings.value.faviconUrl = asset.url
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
    <p v-if="loading" class="mb-3 text-[var(--c-text-muted)]">Loading...</p>
    <form v-if="settings" class="card p-4 space-y-4 max-w-3xl" @submit.prevent="saveSettings">
      <input v-model="settings.siteTitle" class="input" placeholder="Site title" />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input v-model="settings.accentColor" class="input" placeholder="#7c3aed" />
        <select v-model="settings.theme" class="input"><option value="system">system</option><option value="light">light</option><option value="dark">dark</option></select>
      </div>
      <label class="block space-y-1 text-sm">
        <span class="font-medium">Home page path</span>
        <input v-model="settings.homePath" class="input font-mono text-sm" placeholder="home" />
      </label>
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
          <input class="text-sm" type="file" accept="image/*" @change="uploadBrandAsset('logo', ($event.target as HTMLInputElement).files)" />
          <span v-if="uploading === 'logo'" class="text-xs text-[var(--c-text-muted)]">Uploading...</span>
        </label>
        <label class="space-y-1 text-sm">
          <span class="font-medium">Favicon URL</span>
          <input v-model="settings.faviconUrl" class="input" placeholder="/assets/favicon.png" />
          <input class="text-sm" type="file" accept="image/*" @change="uploadBrandAsset('favicon', ($event.target as HTMLInputElement).files)" />
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
