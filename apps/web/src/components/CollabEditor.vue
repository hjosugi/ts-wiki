<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { renderMarkdown } from '@wiki/core'
import { useAuth } from '@/stores/auth'

const props = defineProps<{ room: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
const text = ref('')
const synced = ref(false)
const preview = computed(() => renderMarkdown(text.value).html)
const auth = useAuth()

let view: EditorView | null = null
let provider: WebsocketProvider | null = null
let ydoc: Y.Doc | null = null

const WS_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/^http/, 'ws')

/** Deterministic per-user colour so remote cursors are stable & distinct. */
function userColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${h}, 70%, 55%)`
}

onMounted(() => {
  ydoc = new Y.Doc()
  const ytext = ydoc.getText('content')
  // WebsocketProvider connects to `${WS_BASE}/api/collab/<room>` and speaks the
  // y-websocket protocol our server implements.
  provider = new WebsocketProvider(`${WS_BASE}/api/collab`, encodeURIComponent(props.room), ydoc)

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
        yCollab(ytext, provider.awareness),
      ],
    }),
  })
  pushUp()
})

onBeforeUnmount(() => {
  view?.destroy()
  provider?.destroy()
  ydoc?.destroy()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-1.5 text-xs mb-2" :class="synced ? 'text-green-600 dark:text-green-400' : 'text-gray-400'">
      <span class="w-2 h-2 rounded-full" :class="synced ? 'bg-green-500' : 'bg-gray-400'"></span>
      {{ synced ? 'Live — collaborative editing' : 'connecting…' }}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[60vh]">
      <div ref="host" class="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800"></div>
      <div
        class="prose dark:prose-invert max-w-none rounded-lg border border-gray-200 dark:border-gray-800 p-5 overflow-auto bg-white dark:bg-gray-900"
        v-html="preview"
      ></div>
    </div>
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
