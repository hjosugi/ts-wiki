<script setup lang="ts">
import { computed, ref } from 'vue'
import { calendarEventToIcs, type ExtractedCalendarEvent } from '@kawaii-wiki/core'
import { Api } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'
import { useI18n } from '@/lib/i18n'
import EmptyState from '@/components/EmptyState.vue'

const { data: events, loading, error, reload: load } = useAsyncData<ExtractedCalendarEvent[]>(Api.events, { initial: [] })
const { t } = useI18n()
const filter = ref<'all' | 'streams'>('all')
const now = computed(() => new Date().toISOString().slice(0, 10))
const filteredEvents = computed(() =>
  filter.value === 'streams'
    ? events.value.filter((event) => event.platform || event.channelUrl)
    : events.value,
)
const upcoming = computed(() => filteredEvents.value.filter((event) => event.start >= now.value))
const past = computed(() => filteredEvents.value.filter((event) => event.start < now.value).reverse())

const icsUrl = (event: ExtractedCalendarEvent): string =>
  `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarEventToIcs(event))}`

</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ t('events') }}</h1>
        <p class="mt-1 text-sm text-[var(--c-text-muted)]">{{ t('eventIndexDescription') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
          <button
            class="px-3 py-1.5 text-sm font-medium"
            :class="filter === 'all' ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)]'"
            type="button"
            :aria-pressed="filter === 'all'"
            @click="filter = 'all'"
          >
            {{ t('all') }}
          </button>
          <button
            class="px-3 py-1.5 text-sm font-medium"
            :class="filter === 'streams' ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)]'"
            type="button"
            :aria-pressed="filter === 'streams'"
            @click="filter = 'streams'"
          >
            {{ t('streams') }}
          </button>
        </div>
        <button class="btn-ghost" type="button" :disabled="loading" @click="load">{{ t('refresh') }}</button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <Skeleton v-if="loading" label="Loading events" :lines="4" />

    <section v-if="upcoming.length" class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">{{ t('upcoming') }}</h2>
      <div
        v-for="event in upcoming"
        :key="event.id"
        class="card p-4 flex flex-wrap items-start justify-between gap-3"
      >
        <div class="min-w-0">
          <h3 class="font-semibold truncate">{{ event.title }}</h3>
          <p class="mt-1 text-sm text-gray-500">
            {{ event.start }}<template v-if="event.end"> - {{ event.end }}</template>
            <template v-if="event.timezone"> {{ event.timezone }}</template>
          </p>
          <p v-if="event.location" class="text-sm text-gray-500 truncate">{{ event.location }}</p>
          <p v-if="event.platform" class="mt-2 inline-flex rounded-full bg-[color-mix(in_srgb,var(--c-accent)_12%,var(--c-surface-muted))] px-2 py-0.5 text-xs font-semibold text-[var(--c-accent)]">
            {{ event.platform }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a v-if="event.channelUrl" class="btn-ghost" :href="event.channelUrl" target="_blank" rel="noopener noreferrer">{{ t('watch') }}</a>
          <RouterLink class="btn-ghost" :to="'/' + event.sourcePath">{{ t('page') }}</RouterLink>
          <a class="btn-ghost" :href="icsUrl(event)" :download="`${event.title}.ics`">.ics</a>
        </div>
      </div>
    </section>

    <section v-if="past.length" class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">{{ t('past') }}</h2>
      <div
        v-for="event in past"
        :key="event.id"
        class="rounded-md border border-gray-200 dark:border-gray-800 p-3 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <h3 class="font-medium truncate">{{ event.title }}</h3>
          <p class="text-sm text-gray-500">
            {{ event.start }}<template v-if="event.platform"> · {{ event.platform }}</template>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a v-if="event.channelUrl" class="btn-ghost" :href="event.channelUrl" target="_blank" rel="noopener noreferrer">{{ t('watch') }}</a>
          <RouterLink class="btn-ghost" :to="'/' + event.sourcePath">{{ t('page') }}</RouterLink>
        </div>
      </div>
    </section>

    <EmptyState
      v-if="!loading && !filteredEvents.length"
      :title="filter === 'streams' ? t('noStreamsYet') : t('noEventsYet')"
      :message="t('eventIndexDescription')"
    >
      <template #actions>
        <RouterLink to="/_new" class="btn-primary">{{ t('newPage') }}</RouterLink>
      </template>
    </EmptyState>
  </div>
</template>
