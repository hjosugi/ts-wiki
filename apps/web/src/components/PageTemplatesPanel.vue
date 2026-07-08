<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type Page, type PageTemplate } from '@/lib/api'

const emit = defineEmits<{ changed: [] }>()

const templates = ref<PageTemplate[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const editingId = ref<string | null>(null)
const name = ref('')
const description = ref('')
const icon = ref('')
const title = ref('')
const path = ref('')
const labelsText = ref('')
const status = ref<Page['status']>('draft')
const locale = ref('und')
const reviewAtDate = ref('')
const content = ref('')

const labels = (): string[] =>
  labelsText.value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

const reviewAt = (): number | null =>
  reviewAtDate.value ? new Date(`${reviewAtDate.value}T00:00:00`).getTime() : null

const dateInputValue = (value: number | null | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : ''

function resetForm(): void {
  editingId.value = null
  name.value = ''
  description.value = ''
  icon.value = ''
  title.value = ''
  path.value = ''
  labelsText.value = ''
  status.value = 'draft'
  locale.value = 'und'
  reviewAtDate.value = ''
  content.value = '# Template\n\n'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    templates.value = await Api.templates()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function edit(template: PageTemplate): void {
  editingId.value = template.id
  name.value = template.name
  description.value = template.description
  icon.value = template.icon
  title.value = template.metadata.title ?? ''
  path.value = template.metadata.path ?? ''
  labelsText.value = template.metadata.labels?.join(', ') ?? ''
  status.value = template.metadata.status ?? 'draft'
  locale.value = template.metadata.locale ?? 'und'
  reviewAtDate.value = dateInputValue(template.metadata.reviewAt)
  content.value = template.content
}

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    const body = {
      name: name.value,
      description: description.value,
      icon: icon.value,
      content: content.value,
      metadata: {
        title: title.value,
        path: path.value,
        labels: labels(),
        status: status.value,
        locale: locale.value,
        reviewAt: reviewAt(),
      },
    }
    if (editingId.value) await Api.updateTemplate(editingId.value, body)
    else await Api.createTemplate(body)
    resetForm()
    await load()
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

async function remove(template: PageTemplate): Promise<void> {
  if (!confirm(`Delete template "${template.name}"?`)) return
  saving.value = true
  error.value = null
  try {
    await Api.deleteTemplate(template.id)
    if (editingId.value === template.id) resetForm()
    await load()
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  resetForm()
  void load()
})
</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">Page templates</h2>
      <button class="btn-ghost" type="button" :disabled="loading" @click="load">
        Refresh
      </button>
    </div>
    <p v-if="error" class="mb-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="mb-3 text-[var(--c-text-muted)]">Loading...</p>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <form class="card space-y-3 p-4" @submit.prevent="save">
        <div class="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)]">
          <input v-model="icon" class="input" maxlength="24" placeholder="Icon" />
          <input v-model="name" class="input" required placeholder="Template name" />
        </div>
        <input v-model="description" class="input" placeholder="Description" />
        <div class="grid gap-2 sm:grid-cols-2">
          <input v-model="title" class="input" placeholder="Default page title" />
          <input v-model="path" class="input font-mono text-sm" placeholder="default/path" />
        </div>
        <div class="grid gap-2 sm:grid-cols-3">
          <select v-model="status" class="input">
            <option value="draft">draft</option>
            <option value="in-review">in-review</option>
            <option value="verified">verified</option>
            <option value="outdated">outdated</option>
          </select>
          <input v-model="locale" class="input" placeholder="locale" />
          <input v-model="reviewAtDate" class="input" type="date" />
        </div>
        <input v-model="labelsText" class="input" placeholder="labels, comma separated" />
        <textarea v-model="content" class="input min-h-72 font-mono text-sm" spellcheck="false"></textarea>
        <div class="flex flex-wrap gap-2">
          <button class="btn-primary" type="submit" :disabled="saving || !name">
            {{ saving ? 'Saving...' : editingId ? 'Update template' : 'Create template' }}
          </button>
          <button class="btn-ghost" type="button" @click="resetForm">New template</button>
        </div>
      </form>

      <div class="space-y-2">
        <div
          v-for="template in templates"
          :key="template.id"
          class="rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate font-semibold">
                <span v-if="template.icon">{{ template.icon }} </span>{{ template.name }}
              </div>
              <p v-if="template.description" class="mt-1 text-sm text-[var(--c-text-muted)]">
                {{ template.description }}
              </p>
              <p class="mt-1 truncate font-mono text-xs text-[var(--c-text-muted)]">
                {{ template.metadata.path || 'No default path' }}
              </p>
            </div>
            <div class="flex shrink-0 gap-1">
              <button class="btn-ghost" type="button" @click="edit(template)">Edit</button>
              <button class="btn-danger" type="button" :disabled="saving" @click="remove(template)">Delete</button>
            </div>
          </div>
        </div>
        <p v-if="!templates.length && !loading" class="text-sm text-[var(--c-text-muted)]">
          No custom templates yet.
        </p>
      </div>
    </div>
  </section>
</template>
