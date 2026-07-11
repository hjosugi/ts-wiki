<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { prefersReducedMotion } from '@/composables/useReducedMotion'
import { useI18n } from '@/lib/i18n'
interface TocEntry {
  id: string
  text: string
  level: number
}
const props = withDefaults(defineProps<{
  entries: TocEntry[]
  sticky?: boolean
  showTitle?: boolean
}>(), {
  sticky: true,
  showTitle: true,
})

const activeId = ref('')
const { t } = useI18n()
let observer: IntersectionObserver | null = null

const observeHeadings = async (): Promise<void> => {
  observer?.disconnect()
  observer = null
  await nextTick()
  const headings = props.entries
    .map((entry) => document.getElementById(entry.id))
    .filter((heading): heading is HTMLElement => Boolean(heading))
  activeId.value = headings[0]?.id ?? ''
  if (!headings.length || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((changes) => {
    const visible = changes
      .filter((change) => change.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (visible[0]?.target.id) activeId.value = visible[0].target.id
  }, { rootMargin: '-15% 0px -70% 0px' })
  headings.forEach((heading) => observer?.observe(heading))
}

const goTo = (event: MouseEvent, id: string): void => {
  const heading = document.getElementById(id)
  if (!heading) return
  event.preventDefault()
  activeId.value = id
  heading.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  history.replaceState(null, '', `#${encodeURIComponent(id)}`)
}

onMounted(observeHeadings)
watch(() => props.entries, observeHeadings, { deep: true })
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <nav class="text-sm" :class="sticky ? 'sticky top-20 self-start' : ''">
    <div v-if="showTitle" class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{{ t('onThisPage') }}</div>
    <ul class="border-l border-gray-200 dark:border-gray-800">
      <li
        v-for="e in entries"
        :key="e.id"
        :style="{ paddingLeft: (e.level - 1) * 0.75 + 0.75 + 'rem' }"
      >
        <a
          :href="'#' + e.id"
          class="block py-0.5 -ml-px border-l transition-colors"
          :class="activeId === e.id
            ? 'border-[var(--c-accent)] font-medium text-[var(--c-accent)]'
            : 'border-transparent text-[var(--c-text-muted)] hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]'"
          :aria-current="activeId === e.id ? 'location' : undefined"
          @click="goTo($event, e.id)"
        >
          {{ e.text }}
        </a>
      </li>
    </ul>
  </nav>
</template>
