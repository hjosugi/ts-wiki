<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import {
  parseIcsEvents,
  calendarEventToFence,
  type CalendarEvent,
} from '@ts-wiki/core'
import { Api } from '@/lib/api'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import AssetPicker from '@/components/AssetPicker.vue'
import ModalDialog from '@/components/ModalDialog.vue'

const props = defineProps<{ modelValue: string; assetFolder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const icsInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const showIcs = ref(false)
const showAssets = ref(false)
const icsText = ref('')
const mode = ref<'write' | 'preview'>('write')
let view: EditorView | null = null
const { markdownFeatures, markdownRenderer } = useMarkdownFeatures()

// Live preview shares the EXACT renderer the server uses on save.
const preview = computed(() => markdownRenderer.value.renderMarkdown(props.modelValue).html)
const icsEvents = computed(() => parseIcsEvents(icsText.value))

const pad = (value: number): string => String(value).padStart(2, '0')

const eventSnippet = (): string => {
  const start = new Date(Date.now() + 60 * 60 * 1000)
  start.setMinutes(0, 0, 0)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const format = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `\`\`\`event
title: Event title
start: ${format(start)}
end: ${format(end)}
timezone: ${zone}
location:
url:
description:
\`\`\`
`
}

const infoboxSnippet = (): string => `\`\`\`infobox
title: Name
image:
caption:
Field: value

Details go here.
\`\`\`
`

const linksSnippet = (): string => `\`\`\`links
[YouTube](https://youtube.com/@handle)
[X](https://x.com/handle)
[Shop](https://booth.pm/)
\`\`\`
`

function replaceSelection(insert: string): void {
  if (!view) return
  const selection = view.state.selection.main
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
    scrollIntoView: true,
  })
  view.focus()
}

function insertSnippet(snippet: string): void {
  if (!view) return
  const selection = view.state.selection.main
  const prefix = selection.from > 0 && !view.state.sliceDoc(selection.from - 1, selection.from).match(/\n/) ? '\n\n' : ''
  replaceSelection(prefix + snippet)
}

function surround(prefix: string, suffix: string, fallback: string): void {
  if (!view) return
  const selection = view.state.selection.main
  const selected = view.state.sliceDoc(selection.from, selection.to) || fallback
  replaceSelection(`${prefix}${selected}${suffix}`)
}

function insertLinePrefix(prefix: string, fallback: string): void {
  if (!view) return
  const selection = view.state.selection.main
  const line = view.state.doc.lineAt(selection.from)
  const text = view.state.sliceDoc(line.from, line.to) || fallback
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${prefix}${text.replace(/^#+\s*/, '')}` },
    selection: { anchor: line.from + prefix.length + text.length },
    scrollIntoView: true,
  })
  view.focus()
}

const imageFiles = (files: FileList | readonly File[] | null | undefined): File[] =>
  Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))

const clipboardImageFiles = (data: DataTransfer | null): File[] =>
  Array.from(data?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file && file.type.startsWith('image/')))

async function uploadImages(files: File[]): Promise<void> {
  if (!files.length) return
  uploadError.value = null
  uploading.value = true
  try {
    for (const file of files) {
      const asset = await Api.uploadAsset(file, props.assetFolder)
      const alt = asset.filename.replace(/\.[^.]+$/, '') || 'image'
      insertSnippet(`![${alt}](${asset.url})\n`)
    }
  } catch (e) {
    uploadError.value = (e as Error).message
  } finally {
    uploading.value = false
  }
}

function chooseImage(): void {
  uploadInput.value?.click()
}

function chooseIcs(): void {
  icsInput.value?.click()
}

async function onImageInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await uploadImages(imageFiles(input.files))
  input.value = ''
}

async function onIcsInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    icsText.value = await file.text()
    showIcs.value = true
  }
  input.value = ''
}

function insertIcsEvent(event: CalendarEvent): void {
  insertSnippet(calendarEventToFence(event))
  showIcs.value = false
}

function insertAsset(markdown: string): void {
  insertSnippet(markdown)
  showAssets.value = false
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          drop(event) {
            const files = imageFiles(event.dataTransfer?.files)
            if (!files.length) return false
            event.preventDefault()
            void uploadImages(files)
            return true
          },
          paste(event) {
            const files = clipboardImageFiles(event.clipboardData)
            if (!files.length) return false
            event.preventDefault()
            void uploadImages(files)
            return true
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
})

// Keep the editor in sync if the value is replaced from the outside.
watch(
  () => props.modelValue,
  (value) => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  },
)

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-ghost" type="button" title="Heading" @click="insertLinePrefix('## ', 'Heading')">
        H
      </button>
      <button class="btn-ghost" type="button" title="Bold" @click="surround('**', '**', 'bold')">
        B
      </button>
      <button class="btn-ghost" type="button" title="Link" @click="surround('[', '](https://)', 'link')">
        Link
      </button>
      <button class="btn-ghost" type="button" title="Code" @click="surround('`', '`', 'code')">
        Code
      </button>
      <button class="btn-ghost" type="button" title="Table" @click="insertSnippet('| Column | Value |\\n| --- | --- |\\n|  |  |\\n')">
        Table
      </button>
      <button class="btn-ghost" type="button" title="Event" @click="insertSnippet(eventSnippet())">
        Event
      </button>
      <button class="btn-ghost" type="button" title="Infobox / profile card" @click="insertSnippet(infoboxSnippet())">
        Infobox
      </button>
      <button class="btn-ghost" type="button" title="Link / social buttons" @click="insertSnippet(linksSnippet())">
        Links
      </button>
      <button class="btn-ghost" type="button" title="Upload image" :disabled="uploading" @click="chooseImage">
        {{ uploading ? 'Uploading...' : 'Image' }}
      </button>
      <button class="btn-ghost" type="button" title="Browse assets" @click="showAssets = true">
        Assets
      </button>
      <button class="btn-ghost" type="button" title="Import .ics" @click="chooseIcs">
        .ics
      </button>
      <input ref="uploadInput" class="hidden" type="file" accept="image/*" multiple @change="onImageInput" />
      <input ref="icsInput" class="hidden" type="file" accept=".ics,text/calendar" @change="onIcsInput" />
    </div>
    <p v-if="uploadError" class="text-sm text-red-600">{{ uploadError }}</p>
    <div class="inline-flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-1 text-sm lg:hidden">
      <button
        class="rounded px-3 py-1.5"
        :class="mode === 'write' ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)]'"
        type="button"
        :aria-pressed="mode === 'write'"
        @click="mode = 'write'"
      >
        Write
      </button>
      <button
        class="rounded px-3 py-1.5"
        :class="mode === 'preview' ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)]'"
        type="button"
        :aria-pressed="mode === 'preview'"
        @click="mode = 'preview'"
      >
        Preview
      </button>
    </div>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:h-[65vh]">
      <div
        ref="host"
        class="h-[calc(100dvh-18rem)] min-h-[24rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 lg:block lg:h-auto"
        :class="mode === 'write' ? 'block' : 'hidden'"
      ></div>
      <div
        class="prose dark:prose-invert h-[calc(100dvh-18rem)] min-h-[24rem] max-w-none overflow-auto rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 lg:block lg:h-auto"
        :class="mode === 'preview' ? 'block' : 'hidden'"
        v-markdown-enhance="markdownFeatures"
        v-html="preview"
      ></div>
    </div>

    <ModalDialog
      :open="showIcs"
      title="Import .ics"
      panel-class="card w-full max-w-2xl p-4 space-y-4"
      @close="showIcs = false"
    >
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">Import .ics</h2>
          <button class="btn-ghost" type="button" @click="showIcs = false">Close</button>
        </div>
        <textarea v-model="icsText" class="input min-h-38 font-mono text-sm" spellcheck="false"></textarea>
        <div v-if="icsEvents.length" class="space-y-2 max-h-64 overflow-auto">
          <div
            v-for="(event, index) in icsEvents"
            :key="index"
            class="rounded-md border border-gray-200 dark:border-gray-800 p-3 flex items-start justify-between gap-3"
          >
            <div class="min-w-0">
              <div class="font-semibold truncate">{{ event.title }}</div>
              <div class="text-sm text-gray-500">{{ event.start }}<template v-if="event.end"> - {{ event.end }}</template></div>
              <div v-if="event.location" class="text-sm text-gray-500 truncate">{{ event.location }}</div>
            </div>
            <button class="btn-primary shrink-0" type="button" @click="insertIcsEvent(event)">Insert</button>
          </div>
        </div>
        <p v-else class="text-sm text-gray-500">No events found.</p>
    </ModalDialog>
    <AssetPicker :open="showAssets" :folder="props.assetFolder" @close="showAssets = false" @insert="insertAsset" />
  </div>
</template>
