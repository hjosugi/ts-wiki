<script setup lang="ts">
import { useI18n } from '@/lib/i18n'

defineProps<{ error: string | null; loading?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div v-if="error" class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
    <span>{{ error }}</span>
    <button class="btn-ghost py-1 text-xs" type="button" :disabled="loading" @click="emit('retry')">
      {{ t('retry') }}
    </button>
  </div>
  <slot />
</template>
