<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { calendarEventToIcs, type ExtractedCalendarEvent } from '@ts-wiki/core'
import { Api } from '@/lib/api'

const events = ref<ExtractedCalendarEvent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const now = computed(() => new Date().toISOString().slice(0, 10))
const upcoming = computed(() => events.value.filter((event) => event.start >= now.value))
const past = computed(() => events.value.filter((event) => event.start < now.value).reverse())

const icsUrl = (event: ExtractedCalendarEvent): string =>
  `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarEventToIcs(event))}`

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    events.value = await Api.events()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

watch(now, load, { immediate: true })
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Events</h1>
        <p class="mt-1 text-sm text-gray-500">Event fences across pages</p>
      </div>
      <button class="btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <div v-if="loading" class="text-gray-400">Loading...</div>

    <section v-if="upcoming.length" class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Upcoming</h2>
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
        </div>
        <div class="flex flex-wrap gap-2">
          <RouterLink class="btn-ghost" :to="'/' + event.sourcePath">Page</RouterLink>
          <a class="btn-ghost" :href="icsUrl(event)" :download="`${event.title}.ics`">.ics</a>
        </div>
      </div>
    </section>

    <section v-if="past.length" class="space-y-3">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Past</h2>
      <div
        v-for="event in past"
        :key="event.id"
        class="rounded-md border border-gray-200 dark:border-gray-800 p-3 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <h3 class="font-medium truncate">{{ event.title }}</h3>
          <p class="text-sm text-gray-500">{{ event.start }}</p>
        </div>
        <RouterLink class="btn-ghost" :to="'/' + event.sourcePath">Page</RouterLink>
      </div>
    </section>

    <p v-if="!loading && !events.length" class="text-gray-500">No events yet.</p>
  </div>
</template>
