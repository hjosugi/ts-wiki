import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Api, type PageSummary } from '@/lib/api'

/** Holds the page list shown in the sidebar; refreshed after edits/deletes. */
export const usePages = defineStore('pages', () => {
  const list = ref<PageSummary[]>([])
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  async function refresh(): Promise<void> {
    try {
      list.value = await Api.listPages()
    } catch {
      list.value = []
    }
  }

  function scheduleRefresh(delayMs = 400): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, delayMs)
  }

  return { list, refresh, scheduleRefresh }
})
