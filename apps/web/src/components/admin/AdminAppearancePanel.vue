<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type PublicSettings } from '@/lib/api'

const settings = ref<PublicSettings | null>(null)
const navLinksText = ref('')
const saving = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

function parseNavLinks(): PublicSettings['navLinks'] {
  return navLinksText.value
    .split(/\r?\n/)
    .map((line) => {
      const [label = '', url = ''] = line.split('|')
      return { label: label.trim(), url: url.trim() }
    })
    .filter((link) => link.label && link.url)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    settings.value = await Api.publicSettings()
    navLinksText.value = settings.value.navLinks.map((link) => `${link.label}|${link.url}`).join('\n')
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
      navLinks: parseNavLinks(),
    })
    navLinksText.value = settings.value.navLinks.map((link) => `${link.label}|${link.url}`).join('\n')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Appearance</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="loading" class="text-gray-400 mb-3">Loading...</p>
    <form v-if="settings" class="card p-4 space-y-3 max-w-xl" @submit.prevent="saveSettings">
      <input v-model="settings.siteTitle" class="input" placeholder="Site title" />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input v-model="settings.accentColor" class="input" placeholder="#7c3aed" />
        <select v-model="settings.theme" class="input"><option value="system">system</option><option value="light">light</option><option value="dark">dark</option></select>
      </div>
      <textarea v-model="navLinksText" class="input min-h-24 font-mono text-sm" placeholder="Docs|/docs&#10;Status|https://status.example.com"></textarea>
      <button class="btn-primary" type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save appearance' }}</button>
    </form>
  </section>
</template>
