<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Api, type NotificationList } from '@/lib/api'
import { onWikiEvent } from '@/lib/realtime'
import { useI18n } from '@/lib/i18n'
import AppIcon from '@/components/AppIcon.vue'

const state = ref<NotificationList>({ notifications: [], unread: 0 })
const { formatDateTime, t } = useI18n()

const load = async (): Promise<void> => {
  state.value = await Api.notifications().catch(() => state.value)
}

const markAllRead = async (): Promise<void> => {
  await Api.markNotificationsRead()
  state.value = { ...state.value, unread: 0, notifications: state.value.notifications.map((item) => ({ ...item, readAt: item.readAt ?? Date.now() })) }
}

const markRead = async (id: string): Promise<void> => {
  await Api.markNotificationsRead(id)
  await load()
}

let poll: ReturnType<typeof setInterval> | null = null
const stopRealtime = onWikiEvent(() => void load())
onMounted(() => {
  void load()
  poll = setInterval(() => void load(), 30_000)
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  stopRealtime()
})
</script>

<template>
  <details class="relative">
    <summary
      class="btn-ghost icon-control relative flex h-9 w-9 cursor-pointer list-none items-center justify-center px-0"
      :aria-label="t('notifications')"
      :title="t('notifications')"
      :data-tooltip="t('notifications')"
    >
      <AppIcon name="bell" />
      <span v-if="state.unread" class="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold text-white">{{ Math.min(state.unread, 99) }}</span>
    </summary>
    <div class="absolute right-0 mt-2 w-[min(22rem,calc(100vw-1rem))] rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] p-2 shadow-xl">
      <div class="flex items-center justify-between gap-2 px-2 py-1">
        <strong class="text-sm">{{ t('notifications') }}</strong>
        <button v-if="state.unread" class="link-quiet text-xs" type="button" @click="markAllRead">{{ t('markAllRead') }}</button>
      </div>
      <p v-if="!state.notifications.length" class="px-2 py-4 text-sm text-[var(--c-text-muted)]">{{ t('noNotifications') }}</p>
      <RouterLink
        v-for="item in state.notifications"
        :key="item.id"
        :to="item.path ? `/${item.path}` : '/_profile'"
        class="mt-1 block rounded px-2 py-2 text-sm hover:bg-[var(--c-surface-muted)]"
        :class="item.readAt ? 'text-[var(--c-text-muted)]' : 'font-medium'"
        @click="markRead(item.id)"
      >
        <span class="block">{{ item.message }}</span>
        <span class="mt-0.5 block text-xs text-[var(--c-text-muted)]">{{ formatDateTime(item.createdAt) }}</span>
      </RouterLink>
    </div>
  </details>
</template>
