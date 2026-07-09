<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const router = useRouter()
const { t } = useI18n()

const panels = [
  { id: 'stats', label: 'Stats', component: defineAsyncComponent(() => import('@/components/admin/AdminStatsPanel.vue')) },
  { id: 'pages', label: 'Pages', component: defineAsyncComponent(() => import('@/components/admin/AdminPagesPanel.vue')) },
  { id: 'templates', label: 'Templates', component: defineAsyncComponent(() => import('@/components/PageTemplatesPanel.vue')) },
  { id: 'history', label: 'History', component: defineAsyncComponent(() => import('@/components/admin/AdminHistoryPanel.vue')) },
  { id: 'policy', label: 'Policy', component: defineAsyncComponent(() => import('@/components/admin/AdminPolicyPanel.vue')) },
  { id: 'security', label: 'Security', component: defineAsyncComponent(() => import('@/components/admin/AdminSecurityPanel.vue')) },
  { id: 'redirects', label: 'Redirects', component: defineAsyncComponent(() => import('@/components/admin/AdminRedirectsPanel.vue')) },
  { id: 'users', label: 'Users', component: defineAsyncComponent(() => import('@/components/admin/AdminUsersPanel.vue')) },
  { id: 'groups', label: 'Groups', component: defineAsyncComponent(() => import('@/components/admin/AdminGroupsPanel.vue')) },
  { id: 'page-rules', label: 'Page rules', component: defineAsyncComponent(() => import('@/components/admin/AdminPageRulesPanel.vue')) },
  { id: 'webhooks', label: 'Webhooks', component: defineAsyncComponent(() => import('@/components/admin/AdminWebhookSubscriptionsPanel.vue')) },
  { id: 'webhook-deliveries', label: 'Deliveries', component: defineAsyncComponent(() => import('@/components/admin/AdminWebhookDeliveriesPanel.vue')) },
  { id: 'automation', label: 'Automation', component: defineAsyncComponent(() => import('@/components/admin/AdminAutomationPanel.vue')) },
  { id: 'appearance', label: 'Appearance', component: defineAsyncComponent(() => import('@/components/admin/AdminAppearancePanel.vue')) },
  { id: 'import', label: 'Import', component: defineAsyncComponent(() => import('@/components/admin/AdminImportPanel.vue')) },
  { id: 'trash', label: 'Trash', component: defineAsyncComponent(() => import('@/components/admin/AdminTrashPanel.vue')) },
  { id: 'assets', label: 'Assets', component: defineAsyncComponent(() => import('@/components/admin/AdminAssetsPanel.vue')) },
] as const

const panelIds = new Set(panels.map((panel) => panel.id))
const activePanelId = ref<(typeof panels)[number]['id']>('stats')
const activePanel = computed(() => panels.find((panel) => panel.id === activePanelId.value) ?? panels[0])

function syncPanelFromHash(): void {
  const hash = window.location.hash.replace(/^#/, '')
  if (panelIds.has(hash as (typeof panels)[number]['id'])) {
    activePanelId.value = hash as (typeof panels)[number]['id']
  }
}

function activatePanel(id: (typeof panels)[number]['id']): void {
  activePanelId.value = id
  if (window.location.hash !== `#${id}`) void router.replace({ hash: `#${id}` })
}

onMounted(() => {
  if (!auth.isAdmin) {
    router.replace('/')
    return
  }
  syncPanelFromHash()
  window.addEventListener('hashchange', syncPanelFromHash)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', syncPanelFromHash))
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight">{{ t('admin') }}</h1>
      <span class="text-sm text-[var(--c-text-muted)]">{{ activePanel.label }}</span>
    </div>
    <div class="overflow-x-auto border-b border-[var(--c-border)]">
      <nav class="flex min-w-max gap-1" aria-label="Admin sections">
        <a
          v-for="panel in panels"
          :key="panel.id"
          :href="`#${panel.id}`"
          class="rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium"
          :class="activePanelId === panel.id ? 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)] hover:text-[var(--c-text)]'"
          :aria-current="activePanelId === panel.id ? 'page' : undefined"
          @click.prevent="activatePanel(panel.id)"
        >
          {{ panel.label }}
        </a>
      </nav>
    </div>
    <KeepAlive>
      <component :is="activePanel.component" :key="activePanel.id" />
    </KeepAlive>
  </div>
</template>
