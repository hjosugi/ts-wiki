<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import AdminAssetsPanel from '@/components/admin/AdminAssetsPanel.vue'
import AdminAppearancePanel from '@/components/admin/AdminAppearancePanel.vue'
import AdminAutomationPanel from '@/components/admin/AdminAutomationPanel.vue'
import AdminGroupsPanel from '@/components/admin/AdminGroupsPanel.vue'
import AdminImportPanel from '@/components/admin/AdminImportPanel.vue'
import AdminPageRulesPanel from '@/components/admin/AdminPageRulesPanel.vue'
import AdminSecurityPanel from '@/components/admin/AdminSecurityPanel.vue'
import AdminStatsPanel from '@/components/admin/AdminStatsPanel.vue'
import AdminTrashPanel from '@/components/admin/AdminTrashPanel.vue'
import AdminUsersPanel from '@/components/admin/AdminUsersPanel.vue'
import AdminWebhookDeliveriesPanel from '@/components/admin/AdminWebhookDeliveriesPanel.vue'
import AdminWebhookSubscriptionsPanel from '@/components/admin/AdminWebhookSubscriptionsPanel.vue'
import { useI18n } from '@/lib/i18n'

const auth = useAuth()
const router = useRouter()
const { t } = useI18n()

onMounted(() => {
  if (!auth.isAdmin) router.replace('/')
})
</script>

<template>
  <div class="space-y-10">
    <h1 class="text-2xl font-bold tracking-tight">{{ t('admin') }}</h1>
    <AdminStatsPanel />
    <AdminSecurityPanel />
    <AdminUsersPanel />
    <AdminGroupsPanel />
    <AdminPageRulesPanel />
    <AdminWebhookSubscriptionsPanel />
    <AdminWebhookDeliveriesPanel />
    <AdminAutomationPanel />
    <AdminAppearancePanel />
    <AdminImportPanel />
    <AdminTrashPanel />
    <AdminAssetsPanel />
  </div>
</template>
