<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const router = useRouter()
const { t } = useI18n()

const panels = [
  { id: 'stats', label: 'adminStats', category: 'general', keywords: 'dashboard insights search index', component: defineAsyncComponent(() => import('@/components/admin/AdminStatsPanel.vue')) },
  { id: 'appearance', label: 'adminAppearance', category: 'general', keywords: 'theme branding logo color font navigation footer', component: defineAsyncComponent(() => import('@/components/admin/AdminAppearancePanel.vue')) },
  { id: 'policy', label: 'adminPolicy', category: 'general', keywords: 'private registration email two factor session', component: defineAsyncComponent(() => import('@/components/admin/AdminPolicyPanel.vue')) },
  { id: 'pages', label: 'pages', category: 'content', keywords: 'content status author label space', component: defineAsyncComponent(() => import('@/components/admin/AdminPagesPanel.vue')) },
  { id: 'templates', label: 'templates', category: 'content', keywords: 'starter page template', component: defineAsyncComponent(() => import('@/components/PageTemplatesPanel.vue')) },
  { id: 'history', label: 'history', category: 'content', keywords: 'revision retention purge', component: defineAsyncComponent(() => import('@/components/admin/AdminHistoryPanel.vue')) },
  { id: 'redirects', label: 'redirects', category: 'content', keywords: 'move path redirect', component: defineAsyncComponent(() => import('@/components/admin/AdminRedirectsPanel.vue')) },
  { id: 'page-rules', label: 'adminPageRules', category: 'content', keywords: 'permission acl path access', component: defineAsyncComponent(() => import('@/components/admin/AdminPageRulesPanel.vue')) },
  { id: 'assets', label: 'assets', category: 'content', keywords: 'files upload image storage', component: defineAsyncComponent(() => import('@/components/admin/AdminAssetsPanel.vue')) },
  { id: 'import', label: 'adminImport', category: 'content', keywords: 'markdown archive restore', component: defineAsyncComponent(() => import('@/components/admin/AdminImportPanel.vue')) },
  { id: 'trash', label: 'adminTrash', category: 'content', keywords: 'deleted restore purge', component: defineAsyncComponent(() => import('@/components/admin/AdminTrashPanel.vue')) },
  { id: 'users', label: 'adminUsers', category: 'access', keywords: 'account role password member', component: defineAsyncComponent(() => import('@/components/admin/AdminUsersPanel.vue')) },
  { id: 'groups', label: 'adminGroups', category: 'access', keywords: 'team membership role', component: defineAsyncComponent(() => import('@/components/admin/AdminGroupsPanel.vue')) },
  { id: 'security', label: 'adminSecurity', category: 'access', keywords: 'passkey totp api key oidc authentication', component: defineAsyncComponent(() => import('@/components/admin/AdminSecurityPanel.vue')) },
  { id: 'webhooks', label: 'adminWebhooks', category: 'automation', keywords: 'subscription event url secret', component: defineAsyncComponent(() => import('@/components/admin/AdminWebhookSubscriptionsPanel.vue')) },
  { id: 'webhook-deliveries', label: 'adminDeliveries', category: 'automation', keywords: 'delivery retry response failure', component: defineAsyncComponent(() => import('@/components/admin/AdminWebhookDeliveriesPanel.vue')) },
  { id: 'automation', label: 'adminAutomation', category: 'automation', keywords: 'rule trigger action workflow', component: defineAsyncComponent(() => import('@/components/admin/AdminAutomationPanel.vue')) },
  { id: 'git', label: 'adminGit', category: 'system', keywords: 'repository sync mirror backup', component: defineAsyncComponent(() => import('@/components/admin/AdminGitPanel.vue')) },
  { id: 'api', label: 'adminApi', category: 'system', keywords: 'developer rest openapi graphql token integration', component: defineAsyncComponent(() => import('@/components/admin/AdminApiPanel.vue')) },
  { id: 'audit', label: 'adminAudit', category: 'system', keywords: 'log activity event security', component: defineAsyncComponent(() => import('@/components/admin/AdminAuditPanel.vue')) },
] as const

const categories = [
  { id: 'general', label: 'adminCategoryGeneral' },
  { id: 'content', label: 'adminCategoryContent' },
  { id: 'access', label: 'adminCategoryAccess' },
  { id: 'automation', label: 'adminCategoryAutomation' },
  { id: 'system', label: 'adminCategorySystem' },
] as const

const panelIds = new Set(panels.map((panel) => panel.id))
const activePanelId = ref<(typeof panels)[number]['id']>('stats')
const activePanel = computed(() => panels.find((panel) => panel.id === activePanelId.value) ?? panels[0])
const settingsQuery = ref('')
const filteredPanels = computed(() => {
  const query = settingsQuery.value.trim().toLocaleLowerCase()
  if (!query) return panels
  return panels.filter((panel) => `${t(panel.label)} ${panel.id} ${panel.keywords}`.toLocaleLowerCase().includes(query))
})
const panelsByCategory = computed(() => categories.map((category) => ({
  ...category,
  panels: filteredPanels.value.filter((panel) => panel.category === category.id),
})).filter((category) => category.panels.length))

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
  <div class="min-w-0 max-w-full space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight">{{ t('admin') }}</h1>
      <span class="text-sm text-[var(--c-text-muted)]">{{ t(activePanel.label) }}</span>
    </div>
    <div class="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside class="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <label class="block">
          <span class="sr-only">{{ t('searchSettings') }}</span>
          <input v-model="settingsQuery" class="input text-sm" type="search" :placeholder="t('searchSettings')" />
        </label>
        <label class="mt-3 block lg:hidden">
          <span class="sr-only">{{ t('adminSections') }}</span>
          <select v-model="activePanelId" class="input" @change="activatePanel(activePanelId)">
            <optgroup v-for="category in panelsByCategory" :key="`select:${category.id}`" :label="t(category.label)">
              <option v-for="panel in category.panels" :key="`select:${panel.id}`" :value="panel.id">{{ t(panel.label) }}</option>
            </optgroup>
          </select>
        </label>
        <nav class="mt-4 hidden space-y-4 lg:block" :aria-label="t('adminSections')">
          <section v-for="category in panelsByCategory" :key="category.id">
            <h2 class="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--c-text-muted)]">{{ t(category.label) }}</h2>
            <div class="mt-1 space-y-0.5">
              <a
                v-for="panel in category.panels"
                :key="panel.id"
                :href="`#${panel.id}`"
                class="block rounded-md px-2.5 py-2 text-sm font-medium"
                :class="activePanelId === panel.id ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-muted)] hover:bg-[var(--c-surface-muted)] hover:text-[var(--c-text)]'"
                :aria-current="activePanelId === panel.id ? 'page' : undefined"
                @click.prevent="activatePanel(panel.id)"
              >
                {{ t(panel.label) }}
              </a>
            </div>
          </section>
          <p v-if="!panelsByCategory.length" class="px-2 text-sm text-[var(--c-text-muted)]">{{ t('noSettingsFound') }}</p>
        </nav>
      </aside>
      <div class="admin-content min-w-0 max-w-full">
      <KeepAlive>
        <component :is="activePanel.component" :key="activePanel.id" />
      </KeepAlive>
      </div>
    </div>
  </div>
</template>
