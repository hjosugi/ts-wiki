<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import ModalDialog from '@/components/ModalDialog.vue'

const open = ref(false)

const isMac = computed(
  () =>
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || ''),
)
const mod = computed(() => (isMac.value ? '⌘' : 'Ctrl'))

const shortcuts = computed(() => [
  { keys: [mod.value, 'K'], label: 'Open command palette' },
  { keys: ['?'], label: 'Show this help' },
  { keys: ['Esc'], label: 'Close dialogs' },
])

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function onKey(event: KeyboardEvent): void {
  if (event.key === '?' && !isTyping() && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    open.value = true
  } else if (event.key === 'Escape' && open.value) {
    open.value = false
  }
}

function openHelp(): void {
  open.value = true
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('open-shortcuts-help', openHelp)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('open-shortcuts-help', openHelp)
})
</script>

<template>
  <ModalDialog
    :open="open"
    title="Keyboard shortcuts"
    panel-class="card w-full max-w-sm p-5"
    @close="open = false"
  >
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Keyboard shortcuts</h2>
          <button class="btn-ghost" type="button" aria-label="Close" @click="open = false">✕</button>
        </div>
        <ul class="mt-4 space-y-2">
          <li v-for="s in shortcuts" :key="s.label" class="flex items-center justify-between gap-4 text-sm">
            <span class="text-gray-600 dark:text-gray-300">{{ s.label }}</span>
            <span class="flex gap-1">
              <kbd
                v-for="k in s.keys"
                :key="k"
                class="rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 text-xs font-mono"
                >{{ k }}</kbd
              >
            </span>
          </li>
        </ul>
  </ModalDialog>
</template>
