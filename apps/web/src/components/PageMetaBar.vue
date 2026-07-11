<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  isEdit: boolean
  saving: boolean
  savingTemplate: boolean
  coverUploading: boolean
  canSave: boolean
}>()

const emit = defineEmits<{
  save: []
  archive: []
  remove: []
  saveTemplate: []
  uploadCover: [files: FileList | null]
}>()

const title = defineModel<string>('title', { required: true })
const status = defineModel<'draft' | 'in-review' | 'verified' | 'outdated'>('status', { required: true })
const reviewAtDate = defineModel<string>('reviewAtDate', { required: true })
const publishAtDateTime = defineModel<string>('publishAtDateTime', { required: true })
const locale = defineModel<string>('locale', { required: true })
const pinned = defineModel<boolean>('pinned', { required: true })
const navOrderText = defineModel<string>('navOrderText', { required: true })
const icon = defineModel<string>('icon', { required: true })
const coverUrl = defineModel<string>('coverUrl', { required: true })
const coverPosition = defineModel<string>('coverPosition', { required: true })

const { t } = useI18n()
const iconOptions = ['⭐', '📘', '📝', '📣', '🎤', '🎨', '🗓️', '📌', '✅', '🔥', '🌸', '🧭', '💡', '⚙️', '🔒']
const coverPositions = ['center', 'top', 'bottom', 'left', 'right']
const coverPreviewStyle = computed(() => coverUrl.value
  ? {
      backgroundImage: `url(${JSON.stringify(coverUrl.value)})`,
      backgroundSize: 'cover',
      backgroundPosition: coverPosition.value,
    }
  : {})
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 mb-4">
    <input v-model="title" class="input flex-1 min-w-50 text-lg font-semibold" :placeholder="t('pageTitle')" :aria-label="t('pageTitle')" />
    <RouterLink class="btn-ghost" to="/_templates">{{ t('templates') }}</RouterLink>
    <button class="btn-ghost" type="button" :disabled="props.savingTemplate" @click="emit('saveTemplate')">{{ t('saveAsTemplate') }}</button>
    <select v-model="status" class="input max-w-40" :aria-label="t('pageStatus')">
      <option value="draft">{{ t('draft') }}</option>
      <option value="in-review">{{ t('inReview') }}</option>
      <option value="verified">{{ t('verified') }}</option>
      <option value="outdated">{{ t('outdated') }}</option>
    </select>
    <input v-model="reviewAtDate" class="input max-w-42" type="date" :title="t('reviewDate')" :aria-label="t('reviewDate')" />
    <input v-model="publishAtDateTime" class="input max-w-56" type="datetime-local" :title="t('publishAt')" :aria-label="t('publishAt')" />
    <input v-model="locale" class="input max-w-28" :placeholder="t('locale')" :title="t('locale')" :aria-label="t('locale')" />
    <label class="inline-flex items-center gap-2 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2 text-sm">
      <input v-model="pinned" type="checkbox" />
      <span>{{ t('pinned') }}</span>
    </label>
    <input v-model="navOrderText" class="input max-w-30" inputmode="numeric" :placeholder="t('navOrder')" :title="t('navOrder')" :aria-label="t('navOrder')" />
    <button class="btn-primary" :disabled="props.saving || !props.canSave" @click="emit('save')">
      {{ props.saving ? t('saving') : t('save') }}
    </button>
    <button v-if="props.isEdit" class="btn-ghost" @click="emit('archive')">{{ t('archive') }}</button>
    <button v-if="props.isEdit" class="btn-danger" @click="emit('remove')">{{ t('delete') }}</button>
  </div>

  <section class="mb-4 grid gap-3 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-3 lg:grid-cols-[minmax(12rem,18rem)_minmax(0,1fr)]">
    <div class="space-y-2">
      <label class="block text-sm font-medium" for="page-icon">{{ t('pageIcon') }}</label>
      <div class="flex gap-2">
        <input id="page-icon" v-model="icon" class="input max-w-24 text-center text-xl" maxlength="16" placeholder="⭐" :aria-label="t('pageIcon')" />
        <button class="btn-ghost" type="button" @click="icon = ''">{{ t('clear') }}</button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="option in iconOptions"
          :key="option"
          class="h-8 w-8 rounded-md border border-[var(--c-border)] bg-[var(--c-bg)] text-base hover:border-[var(--c-accent)]"
          type="button"
          :aria-label="t('useIcon', { icon: option })"
          @click="icon = option"
        >{{ option }}</button>
      </div>
    </div>
    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
      <div class="space-y-2">
        <label class="block text-sm font-medium" for="cover-url">{{ t('coverImage') }}</label>
        <input id="cover-url" v-model="coverUrl" class="input" placeholder="/assets/cover.jpg" :aria-label="t('coverImageUrl')" />
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <select v-model="coverPosition" class="input max-w-36" :aria-label="t('coverPosition')">
            <option v-for="position in coverPositions" :key="position" :value="position">{{ position }}</option>
          </select>
          <input class="text-sm" type="file" accept="image/*" :aria-label="t('uploadCover')" @change="emit('uploadCover', ($event.target as HTMLInputElement).files)" />
          <span v-if="props.coverUploading" class="text-xs text-[var(--c-text-muted)]">{{ t('uploading') }}</span>
          <button v-if="coverUrl" class="btn-ghost py-1 text-xs" type="button" @click="coverUrl = ''">{{ t('removeCover') }}</button>
        </div>
      </div>
      <div class="min-h-28 overflow-hidden rounded-md border border-[var(--c-border)] bg-[var(--c-surface-muted)]" :style="coverPreviewStyle" aria-hidden="true">
        <div v-if="!coverUrl" class="grid h-full min-h-28 place-items-center text-xs text-[var(--c-text-muted)]">{{ t('noCover') }}</div>
      </div>
    </div>
  </section>
</template>
