<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { EditorState } from '@codemirror/state'
import { type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import {
  parseIcsEvents,
  calendarEventToFence,
  type CalendarEvent,
} from '@kawaii-wiki/core'
import { clipboardHttpUrl } from '@/lib/linkPreview'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { embedSnippet, eventSnippet, infoboxSnippet, linksSnippet, streamSnippet, twitchSnippet, youtubeSnippet } from '@/lib/editorSnippets'
import EditorToolbar from '@/components/EditorToolbar.vue'
import AssetPicker from '@/components/AssetPicker.vue'
import ImageUploadDialog from '@/components/ImageUploadDialog.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { useImageUpload } from '@/composables/useImageUpload'
import { markdownEditorExtensions, useCodeMirrorCommands } from '@/composables/useCodeMirrorEditor'

const props = defineProps<{ modelValue: string; assetFolder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const icsInput = ref<HTMLInputElement | null>(null)
const showIcs = ref(false)
const showAssets = ref(false)
const icsText = ref('')
const mode = ref<'write' | 'preview'>('write')
let view: EditorView | null = null
const { replaceSelection, insertSnippet, insertPendingLinkPreview, surround, insertLinePrefix } =
  useCodeMirrorCommands(() => view)
const { markdownFeatures, markdownRenderer } = useMarkdownFeatures()
const { t } = useI18n()
const {
  uploading,
  uploadError,
  pendingImageFiles,
  cancelImageUpload,
  uploadPreparedImages,
  onImageInput,
  handleImagePaste,
  handleImageDrop,
} = useImageUpload({
  folder: () => props.assetFolder,
  insert: (asset, alt) => insertSnippet(`![${alt}](${asset.url})\n`),
})

// Live preview shares the EXACT renderer the server uses on save.
const preview = computed(() => markdownRenderer.value.renderMarkdown(props.modelValue).html)
const icsEvents = computed(() => parseIcsEvents(icsText.value))

interface EditorAction {
  id: string
  group: 'text' | 'insert' | 'media'
  label: MessageKey
  icon: string
  detail: MessageKey
  keywords: string[]
  run: () => void
}

const editorActions = computed<EditorAction[]>(() => [
  {
    id: 'heading',
    group: 'text',
    label: 'toolbarHeading',
    icon: 'H2',
    detail: 'toolbarHeadingDetail',
    keywords: ['heading', 'title', '見出し'],
    run: () => insertLinePrefix('## ', 'Heading'),
  },
  {
    id: 'bold',
    group: 'text',
    label: 'toolbarBold',
    icon: 'B',
    detail: 'toolbarBoldDetail',
    keywords: ['bold', '太字'],
    run: () => surround('**', '**', 'bold'),
  },
  {
    id: 'link',
    group: 'text',
    label: 'toolbarLink',
    icon: '[]',
    detail: 'toolbarLinkDetail',
    keywords: ['link', 'url', 'リンク'],
    run: () => surround('[', '](https://)', 'link'),
  },
  {
    id: 'code',
    group: 'text',
    label: 'toolbarCode',
    icon: '</>',
    detail: 'toolbarCodeDetail',
    keywords: ['code', 'コード'],
    run: () => surround('`', '`', 'code'),
  },
  {
    id: 'table',
    group: 'insert',
    label: 'toolbarTable',
    icon: '| |',
    detail: 'toolbarTableDetail',
    keywords: ['table', '表'],
    run: () => insertSnippet('| Column | Value |\\n| --- | --- |\\n|  |  |\\n'),
  },
  {
    id: 'event',
    group: 'insert',
    label: 'toolbarEvent',
    icon: 'Cal',
    detail: 'toolbarEventDetail',
    keywords: ['event', 'calendar', '予定', 'イベント'],
    run: () => insertSnippet(eventSnippet()),
  },
  {
    id: 'stream',
    group: 'insert',
    label: 'toolbarStream',
    icon: 'Live',
    detail: 'toolbarStreamDetail',
    keywords: ['stream', 'live', '配信'],
    run: () => insertSnippet(streamSnippet()),
  },
  {
    id: 'youtube',
    group: 'insert',
    label: 'toolbarYouTube',
    icon: 'YT',
    detail: 'toolbarYouTubeDetail',
    keywords: ['youtube', 'video', '動画'],
    run: () => insertSnippet(youtubeSnippet()),
  },
  {
    id: 'twitch',
    group: 'insert',
    label: 'toolbarTwitch',
    icon: 'Tw',
    detail: 'toolbarTwitchDetail',
    keywords: ['twitch', 'stream', 'clip'],
    run: () => insertSnippet(twitchSnippet()),
  },
  {
    id: 'callout',
    group: 'insert',
    label: 'toolbarCallout',
    icon: '!',
    detail: 'toolbarCalloutDetail',
    keywords: ['callout', 'note', '注意', 'メモ'],
    run: () => insertSnippet('```callout\\ntype: info\\ntitle: Note\\n\\nCallout text\\n```\\n'),
  },
  {
    id: 'infobox',
    group: 'insert',
    label: 'toolbarInfobox',
    icon: 'ID',
    detail: 'toolbarInfoboxDetail',
    keywords: ['infobox', 'profile', 'プロフィール'],
    run: () => insertSnippet(infoboxSnippet()),
  },
  {
    id: 'embed',
    group: 'insert',
    label: 'toolbarEmbed',
    icon: '<>',
    detail: 'toolbarEmbedDetail',
    keywords: ['embed', 'bookmark', 'card', '埋め込み'],
    run: () => insertSnippet(embedSnippet()),
  },
  {
    id: 'links',
    group: 'insert',
    label: 'toolbarLinks',
    icon: '@',
    detail: 'toolbarLinksDetail',
    keywords: ['links', 'social', 'sns', 'リンク集'],
    run: () => insertSnippet(linksSnippet()),
  },
  {
    id: 'image',
    group: 'media',
    label: 'toolbarImage',
    icon: 'Img',
    detail: 'toolbarImageDetail',
    keywords: ['image', 'upload', '画像'],
    run: chooseImage,
  },
  {
    id: 'assets',
    group: 'media',
    label: 'toolbarAssets',
    icon: 'Lib',
    detail: 'toolbarAssetsDetail',
    keywords: ['asset', 'file', '添付'],
    run: () => {
      showAssets.value = true
    },
  },
  {
    id: 'ics',
    group: 'media',
    label: 'toolbarIcs',
    icon: '.ics',
    detail: 'toolbarIcsDetail',
    keywords: ['ics', 'calendar', '予定'],
    run: chooseIcs,
  },
])

const slashCompletions = (context: CompletionContext) => {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(line.from, context.pos)
  const match = before.match(/^\s*\/([\p{L}\p{N}_-]*)$/u)
  if (!match) return null
  const query = (match[1] ?? '').toLowerCase()
  const from = line.from + before.lastIndexOf('/')
  const options: Completion[] = editorActions.value
    .filter((action) => {
      const label = t(action.label).toLowerCase()
      return !query || label.includes(query) || action.id.includes(query) || action.keywords.some((keyword) => keyword.toLowerCase().includes(query))
    })
    .map((action) => ({
      label: t(action.label),
      detail: t(action.detail),
      type: action.group === 'media' ? 'file' : 'keyword',
      apply(completionView) {
        completionView.dispatch({
          changes: { from, to: context.pos, insert: '' },
          selection: { anchor: from },
          scrollIntoView: true,
        })
        action.run()
      },
    }))
  return { from, options, validFor: /^\/[\p{L}\p{N}_-]*$/u }
}

function chooseImage(): void {
  uploadInput.value?.click()
}

function chooseIcs(): void {
  icsInput.value?.click()
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
      extensions: markdownEditorExtensions({
        completion: slashCompletions,
        drop: handleImageDrop,
        paste(event) {
            if (handleImagePaste(event)) return true
            const url = clipboardHttpUrl(event.clipboardData)
            if (!url) return false
            event.preventDefault()
            insertPendingLinkPreview(url)
            return true
        },
        extra: [EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        })],
      }),
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
    <EditorToolbar :actions="editorActions.map((action) => ({ ...action, detail: t(action.detail) }))" :busy-id="uploading ? 'image' : undefined" :disabled-ids="pendingImageFiles.length ? ['image'] : []">
      <input ref="uploadInput" class="hidden" type="file" accept="image/*" multiple :aria-label="t('uploadImageFiles')" @change="onImageInput" />
      <input ref="icsInput" class="hidden" type="file" accept=".ics,text/calendar" :aria-label="t('importIcs')" @change="onIcsInput" />
    </EditorToolbar>
    <p class="text-xs text-[var(--c-text-muted)]">{{ t('insertMenuHint') }}</p>
    <p v-if="uploadError" class="text-sm text-red-600">{{ uploadError }}</p>
    <div class="inline-flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-1 text-sm lg:hidden">
      <button
        class="rounded px-3 py-1.5"
        :class="mode === 'write' ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)]'"
        type="button"
        :aria-pressed="mode === 'write'"
        @click="mode = 'write'"
      >
        {{ t('write') }}
      </button>
      <button
        class="rounded px-3 py-1.5"
        :class="mode === 'preview' ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)]'"
        type="button"
        :aria-pressed="mode === 'preview'"
        @click="mode = 'preview'"
      >
        {{ t('preview') }}
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
      :title="t('importIcs')"
      panel-class="card w-full max-w-2xl p-4 space-y-4"
      @close="showIcs = false"
    >
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">{{ t('importIcs') }}</h2>
          <button class="btn-ghost" type="button" @click="showIcs = false">{{ t('close') }}</button>
        </div>
        <textarea v-model="icsText" class="input min-h-38 font-mono text-sm" spellcheck="false" :aria-label="t('importIcsContent')"></textarea>
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
            <button class="btn-primary shrink-0" type="button" @click="insertIcsEvent(event)">{{ t('insert') }}</button>
          </div>
        </div>
        <p v-else class="text-sm text-gray-500">{{ t('noEventsFound') }}</p>
    </ModalDialog>
    <AssetPicker :open="showAssets" :folder="props.assetFolder" @close="showAssets = false" @insert="insertAsset" />
    <ImageUploadDialog
      :open="pendingImageFiles.length > 0"
      :files="pendingImageFiles"
      @cancel="cancelImageUpload"
      @complete="uploadPreparedImages"
    />
  </div>
</template>
