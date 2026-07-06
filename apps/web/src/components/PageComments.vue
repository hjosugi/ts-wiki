<script setup lang="ts">
import { ref, watch } from 'vue'
import { renderMarkdown } from '@ts-wiki/core'
import { Api, type PageComment } from '@/lib/api'
import { useAuth } from '@/stores/auth'

const props = defineProps<{ path: string }>()

const auth = useAuth()
const comments = ref<PageComment[]>([])
const draft = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const formatDate = (value: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

// Comments render through the same safe (raw-HTML-disabled) Markdown pipeline as
// pages, so links/code/emphasis work without any XSS surface.
const renderBody = (body: string): string => renderMarkdown(body).html

const canChange = (comment: PageComment): boolean =>
  auth.isAdmin || Boolean(auth.user?.id && auth.user.id === comment.authorId)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    comments.value = await Api.comments(props.path)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function submit(): Promise<void> {
  if (!draft.value.trim()) return
  saving.value = true
  error.value = null
  try {
    const comment = await Api.createComment(props.path, draft.value)
    comments.value = [...comments.value, comment]
    draft.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function resolve(comment: PageComment): Promise<void> {
  error.value = null
  try {
    const updated = await Api.resolveComment(comment.id)
    comments.value = comments.value.map((item) => (item.id === updated.id ? updated : item))
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function remove(comment: PageComment): Promise<void> {
  if (!confirm('Delete this comment?')) return
  error.value = null
  try {
    await Api.deleteComment(comment.id)
    comments.value = comments.value.filter((item) => item.id !== comment.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

watch(() => props.path, load, { immediate: true })
</script>

<template>
  <section class="mt-10 border-t border-gray-200 pt-5 dark:border-gray-800">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Comments</h2>
      <span v-if="comments.length" class="text-xs text-gray-400">{{ comments.length }}</span>
    </div>

    <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="mt-3 text-sm text-gray-400">Loading...</p>

    <div v-else class="mt-3 space-y-3">
      <article
        v-for="comment in comments"
        :key="comment.id"
        class="rounded-md border border-gray-200 p-3 dark:border-gray-800"
        :class="comment.resolvedAt ? 'opacity-65' : ''"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="prose dark:prose-invert max-w-none text-sm" v-html="renderBody(comment.body)"></div>
            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span v-if="comment.authorName" class="font-medium text-gray-700 dark:text-gray-300">{{ comment.authorName }}</span>
              <span>{{ formatDate(comment.createdAt) }}</span>
              <span v-if="comment.mentions.length">Mentions {{ comment.mentions.map((m) => '@' + m).join(', ') }}</span>
              <span v-if="comment.resolvedAt">Resolved {{ formatDate(comment.resolvedAt) }}</span>
            </div>
          </div>
          <div v-if="canChange(comment)" class="flex gap-2">
            <button v-if="!comment.resolvedAt" class="btn-ghost" type="button" @click="resolve(comment)">
              Resolve
            </button>
            <button class="btn-danger" type="button" @click="remove(comment)">Delete</button>
          </div>
        </div>
      </article>
      <p v-if="!comments.length" class="text-sm text-gray-500">No comments yet.</p>
    </div>

    <form v-if="auth.isAuthed" class="mt-4 space-y-2" @submit.prevent="submit">
      <textarea
        v-model="draft"
        class="input min-h-24"
        placeholder="Add a comment. Use @name to mention someone."
      ></textarea>
      <button class="btn-primary" type="submit" :disabled="saving || !draft.trim()">
        {{ saving ? 'Posting...' : 'Post comment' }}
      </button>
    </form>
    <RouterLink v-else to="/_login" class="btn-ghost mt-4">Sign in to comment</RouterLink>
  </section>
</template>
