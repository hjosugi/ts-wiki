<script setup lang="ts">
import { ref, watch } from 'vue'
import { Api, type PageComment } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useMarkdownFeatures } from '@/composables/useMarkdownFeatures'
import { vMarkdownEnhance } from '@/lib/markdownEnhance'
import { useI18n } from '@/lib/i18n'
import Skeleton from '@/components/Skeleton.vue'

const props = defineProps<{ path: string }>()

const auth = useAuth()
const comments = ref<PageComment[]>([])
const draft = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const { markdownFeatures, markdownRenderer } = useMarkdownFeatures()
const { formatDateTime, t } = useI18n()

// Comments render through the same safe (raw-HTML-disabled) Markdown pipeline as
// pages, so links/code/emphasis work without any XSS surface.
const renderBody = (body: string): string => markdownRenderer.value.renderMarkdown(body).html

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
  if (!confirm(t('deleteCommentConfirm'))) return
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
  <section id="comments" class="mt-10 border-t border-gray-200 pt-5 dark:border-gray-800">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">{{ t('comments') }}</h2>
      <span v-if="comments.length" class="text-xs text-[var(--c-text-muted)]">{{ comments.length }}</span>
    </div>

    <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
    <Skeleton v-if="loading" class="mt-3" :label="t('loadingComments')" :lines="2" />

    <div v-else class="mt-3 space-y-3">
      <article
        v-for="comment in comments"
        :key="comment.id"
        class="rounded-md border border-gray-200 p-3 dark:border-gray-800"
        :class="comment.resolvedAt ? 'opacity-65' : ''"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div
              v-markdown-enhance="markdownFeatures"
              class="prose dark:prose-invert max-w-none text-sm"
              v-html="renderBody(comment.body)"
            ></div>
            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span v-if="comment.authorName" class="font-medium text-gray-700 dark:text-gray-300">{{ comment.authorName }}</span>
              <span>{{ formatDateTime(comment.createdAt) }}</span>
              <span v-if="comment.mentions.length">
                {{ t('mentions', { names: comment.mentions.map((m) => '@' + m).join(', ') }) }}
              </span>
              <span v-if="comment.resolvedAt">
                {{ t('resolved', { date: formatDateTime(comment.resolvedAt) }) }}
              </span>
            </div>
          </div>
          <div v-if="canChange(comment)" class="flex gap-2">
            <button v-if="!comment.resolvedAt" class="btn-ghost" type="button" @click="resolve(comment)">
              {{ t('resolve') }}
            </button>
            <button class="btn-danger" type="button" @click="remove(comment)">{{ t('delete') }}</button>
          </div>
        </div>
      </article>
      <p v-if="!comments.length" class="text-sm text-gray-500">{{ t('noCommentsYet') }}</p>
    </div>

    <form v-if="auth.isAuthed" class="mt-4 space-y-2" @submit.prevent="submit">
      <textarea
        v-model="draft"
        class="input min-h-24"
        :placeholder="t('addCommentPlaceholder')"
        :aria-label="t('commentBody')"
      ></textarea>
      <button class="btn-primary" type="submit" :disabled="saving || !draft.trim()">
        {{ saving ? t('posting') : t('postComment') }}
      </button>
    </form>
    <RouterLink v-else to="/_login" class="btn-ghost mt-4">{{ t('signInToComment') }}</RouterLink>
  </section>
</template>
