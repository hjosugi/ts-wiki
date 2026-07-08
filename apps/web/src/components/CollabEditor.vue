<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { Api, getToken } from '@/lib/api'
import { WS_BASE_URL } from '@/lib/url'
import { useAuth } from '@/stores/auth'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import AssetPicker from '@/components/AssetPicker.vue'

const props = defineProps<{ room: string; assetFolder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const text = ref('')
const synced = ref(false)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const showAssets = ref(false)
const mode = ref<'write' | 'preview'>('write')
const { markdownFeatures, markdownRenderer } = useMarkdownFeatures()
const preview = computed(() => markdownRenderer.value.renderMarkdown(text.value).html)
const auth = useAuth()

let view: EditorView | null = null
let provider: WebsocketProvider | null = null
let ydoc: Y.Doc | null = null
let disposed = false

/** Deterministic per-user colour so remote cursors are stable & distinct. */
function userColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${h}, 70%, 55%)`
}

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
  const textValue = view.state.sliceDoc(line.from, line.to) || fallback
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: `${prefix}${textValue.replace(/^#+\s*/, '')}` },
    selection: { anchor: line.from + prefix.length + textValue.length },
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

async function onImageInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await uploadImages(imageFiles(input.files))
  input.value = ''
}

function insertAsset(markdown: string): void {
  insertSnippet(markdown)
  showAssets.value = false
}

onMounted(async () => {
  disposed = false
  ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  // WebsocketProvider connects to `${WS_BASE_URL}/api/collab/<room>` and speaks the
  // y-websocket protocol our server implements.
  const token = getToken()
  const ticket = token ? await Api.realtimeTicket().catch(() => null) : null
  if (disposed || (token && !ticket)) return
  provider = new WebsocketProvider(`${WS_BASE_URL}/api/collab`, encodeURIComponent(props.room), ydoc, {
    params: ticket ? { ticket: ticket.ticket } : {},
  })

  const name = auth.user?.name ?? 'Anonymous'
  const color = userColor(name + (auth.user?.id ?? ''))
  provider.awareness.setLocalStateField('user', { name, color, colorLight: color })
  provider.on('sync', (isSynced: boolean) => {
    synced.value = isSynced
  })

  // Mirror the shared text out for the live preview + the parent's Save.
  const pushUp = (): void => {
    const value = ytext.toString()
    text.value = value
    emit('update:modelValue', value)
  }
  ytext.observe(pushUp)

  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: ytext.toString(),
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
        yCollab(ytext, provider.awareness),
      ],
    }),
  })
  pushUp()
})

onBeforeUnmount(() => {
  disposed = true
  view?.destroy()
  provider?.destroy()
  ydoc?.destroy()
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <div class="flex items-center gap-1.5 text-xs" :class="synced ? 'text-green-600 dark:text-green-400' : 'text-gray-400'">
        <span class="w-2 h-2 rounded-full" :class="synced ? 'bg-green-500' : 'bg-gray-400'"></span>
        {{ synced ? 'Live - collaborative editing' : 'connecting...' }}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-ghost" type="button" title="Heading" @click="insertLinePrefix('## ', 'Heading')">H</button>
        <button class="btn-ghost" type="button" title="Bold" @click="surround('**', '**', 'bold')">B</button>
        <button class="btn-ghost" type="button" title="Link" @click="surround('[', '](https://)', 'link')">Link</button>
        <button class="btn-ghost" type="button" title="Code" @click="surround('`', '`', 'code')">Code</button>
        <button class="btn-ghost" type="button" title="Table" @click="insertSnippet('| Column | Value |\\n| --- | --- |\\n|  |  |\\n')">Table</button>
        <button class="btn-ghost" type="button" title="Event" @click="insertSnippet(eventSnippet())">Event</button>
        <button class="btn-ghost" type="button" title="Upload image" :disabled="uploading" @click="uploadInput?.click()">
          {{ uploading ? 'Uploading...' : 'Image' }}
        </button>
        <button class="btn-ghost" type="button" title="Browse assets" @click="showAssets = true">
          Assets
        </button>
        <input ref="uploadInput" class="hidden" type="file" accept="image/*" multiple @change="onImageInput" />
      </div>
    </div>
    <p v-if="uploadError" class="text-sm text-red-600 mb-2">{{ uploadError }}</p>
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
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:h-[60vh]">
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
    <AssetPicker :open="showAssets" :folder="props.assetFolder" @close="showAssets = false" @insert="insertAsset" />
  </div>
</template>

<style>
/* Remote collaborator cursors (y-codemirror.next colours these inline). */
.cm-ySelectionCaret {
  position: relative;
  border-left: 2px solid;
  margin-left: -1px;
}
.cm-ySelectionInfo {
  position: absolute;
  top: -1.4em;
  left: -2px;
  font-size: 0.65rem;
  padding: 0 4px;
  color: #fff;
  border-radius: 3px 3px 3px 0;
  white-space: nowrap;
  opacity: 0.9;
}
</style>
