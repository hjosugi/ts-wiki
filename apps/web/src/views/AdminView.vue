<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { useRouter } from 'vue-router'
import {
  Api,
  type AdminUserView,
  type AdminStats,
  type AssetView,
  type PageSummary,
  type AnalyticsSummary,
  type PublicSettings,
  type AuthzGroupView,
  type PageRuleView,
  type PasskeyView,
  type WebhookSubscriptionView,
  type WebhookDeliveryView,
  type AutomationRuleView,
} from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { usePages } from '@/stores/pages'

const auth = useAuth()
const router = useRouter()
const pagesStore = usePages()

const stats = ref<AdminStats | null>(null)
const analytics = ref<AnalyticsSummary | null>(null)
const settings = ref<PublicSettings | null>(null)
const users = ref<AdminUserView[]>([])
const groups = ref<AuthzGroupView[]>([])
const pageRules = ref<PageRuleView[]>([])
const passkeys = ref<PasskeyView[]>([])
const webhooks = ref<WebhookSubscriptionView[]>([])
const webhookDeliveries = ref<WebhookDeliveryView[]>([])
const automationRules = ref<AutomationRuleView[]>([])
const assets = ref<AssetView[]>([])
const trash = ref<PageSummary[]>([])
const error = ref<string | null>(null)
const loading = ref(true)
const importPath = ref('')
const importContent = ref('')
const importLabels = ref('')
const importStatus = ref<'draft' | 'in-review' | 'verified' | 'outdated'>('draft')
const importing = ref(false)
const settingsSaving = ref(false)
const navLinksText = ref('')
const groupKey = ref('')
const groupName = ref('')
const groupDescription = ref('')
const membershipGroup = ref('viewers')
const ruleSubjectType = ref<PageRuleView['subjectType']>('group')
const ruleSubjectId = ref('viewers')
const ruleAction = ref('page:read')
const ruleEffect = ref<PageRuleView['effect']>('allow')
const ruleMatcher = ref<PageRuleView['matcher']>('prefix')
const rulePattern = ref('')
const totpSecret = ref('')
const totpUrl = ref('')
const totpCode = ref('')
const totpBusy = ref(false)
const passkeyBusy = ref(false)
const webhookName = ref('')
const webhookUrl = ref('')
const webhookSecret = ref('')
const webhookEventTypes = ref('page.created,page.updated,page.deleted,comment.created,asset.created,user.created')
const deliveryStatus = ref<'all' | WebhookDeliveryView['status']>('all')
const automationName = ref('')
const automationPathPrefix = ref('')
const automationLabel = ref('')
const automationStatus = ref<'' | 'draft' | 'in-review' | 'verified' | 'outdated'>('')

const ROLES = ['admin', 'editor', 'viewer'] as const
type RoleName = (typeof ROLES)[number]

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [s, an, set, u, g, r, pk, wh, wd, ar, a, t] = await Promise.all([
      Api.adminStats(),
      Api.adminAnalytics(),
      Api.publicSettings(),
      Api.adminUsers(),
      Api.adminGroups(),
      Api.adminPageRules(),
      Api.passkeys(),
      Api.adminWebhooks(),
      Api.adminWebhookDeliveries(),
      Api.adminAutomationRules(),
      Api.listAssets(),
      Api.trashPages(),
    ])
    stats.value = s
    analytics.value = an
    settings.value = set
    navLinksText.value = set.navLinks.map((link) => `${link.label}|${link.url}`).join('\n')
    users.value = u
    groups.value = g
    pageRules.value = r
    passkeys.value = pk
    webhooks.value = wh
    webhookDeliveries.value = wd
    automationRules.value = ar
    membershipGroup.value = g[0]?.key ?? 'viewers'
    assets.value = a
    trash.value = t
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function restorePage(path: string): Promise<void> {
  error.value = null
  try {
    await Api.restorePage(path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function purgePage(path: string): Promise<void> {
  if (!confirm(`Purge "/${path}" permanently?`)) return
  error.value = null
  try {
    await Api.purgePage(path)
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteAsset(asset: AssetView): Promise<void> {
  if (!confirm(`Delete asset "${asset.filename}"?`)) return
  error.value = null
  try {
    await Api.deleteAsset(asset.id)
    assets.value = assets.value.filter((item) => item.id !== asset.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function renameAsset(asset: AssetView): Promise<void> {
  const filename = prompt('Asset filename', asset.filename)?.trim()
  if (!filename || filename === asset.filename) return
  error.value = null
  try {
    const renamed = await Api.renameAsset(asset.id, filename)
    assets.value = assets.value.map((item) => (item.id === renamed.id ? renamed : item))
  } catch (e) {
    error.value = (e as Error).message
  }
}

const formatBytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`

async function exportSite(): Promise<void> {
  error.value = null
  try {
    const backup = await Api.exportSite()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ts-wiki-backup-${backup.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function importMarkdown(): Promise<void> {
  importing.value = true
  error.value = null
  try {
    await Api.importMarkdown({
      path: importPath.value,
      content: importContent.value,
      labels: importLabels.value.split(',').map((label) => label.trim()).filter(Boolean),
      status: importStatus.value,
    })
    importPath.value = ''
    importContent.value = ''
    importLabels.value = ''
    importStatus.value = 'draft'
    await Promise.all([load(), pagesStore.refresh()])
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    importing.value = false
  }
}

function parseNavLinks(): PublicSettings['navLinks'] {
  return navLinksText.value
    .split(/\r?\n/)
    .map((line) => {
      const [label = '', url = ''] = line.split('|')
      return { label: label.trim(), url: url.trim() }
    })
    .filter((link) => link.label && link.url)
}

async function saveSettings(): Promise<void> {
  if (!settings.value) return
  settingsSaving.value = true
  error.value = null
  try {
    settings.value = await Api.adminUpdateSettings({
      siteTitle: settings.value.siteTitle,
      accentColor: settings.value.accentColor,
      theme: settings.value.theme,
      navLinks: parseNavLinks(),
    })
    navLinksText.value = settings.value.navLinks.map((link) => `${link.label}|${link.url}`).join('\n')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    settingsSaving.value = false
  }
}

async function changeRole(user: AdminUserView, role: RoleName): Promise<void> {
  if (role === user.role) return
  const previous = user.role
  user.role = role // optimistic
  try {
    const updated = await Api.adminSetRole(user.id, role)
    user.role = updated.role
    if (stats.value) stats.value = await Api.adminStats()
  } catch (e) {
    user.role = previous // revert on failure
    error.value = (e as Error).message
  }
}

async function createGroup(): Promise<void> {
  error.value = null
  try {
    const group = await Api.adminCreateGroup({
      key: groupKey.value,
      name: groupName.value,
      description: groupDescription.value,
    })
    groups.value = [...groups.value, group].sort((a, b) => a.key.localeCompare(b.key))
    groupKey.value = ''
    groupName.value = ''
    groupDescription.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function addUserToGroup(user: AdminUserView): Promise<void> {
  if (!membershipGroup.value) return
  error.value = null
  try {
    await Api.adminAddUserToGroup({ userId: user.id, groupKey: membershipGroup.value })
    users.value = await Api.adminUsers()
    groups.value = await Api.adminGroups()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function removeUserFromGroup(user: AdminUserView, groupKey: string): Promise<void> {
  error.value = null
  try {
    await Api.adminRemoveUserFromGroup(user.id, groupKey)
    users.value = await Api.adminUsers()
    groups.value = await Api.adminGroups()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function createPageRule(): Promise<void> {
  error.value = null
  try {
    const rule = await Api.adminCreatePageRule({
      subjectType: ruleSubjectType.value,
      subjectId: ruleSubjectType.value === 'anonymous' ? null : ruleSubjectId.value,
      action: ruleAction.value,
      effect: ruleEffect.value,
      matcher: ruleMatcher.value,
      pattern: rulePattern.value,
    })
    pageRules.value = [...pageRules.value, rule]
    rulePattern.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deletePageRule(rule: PageRuleView): Promise<void> {
  error.value = null
  try {
    await Api.adminDeletePageRule(rule.id)
    pageRules.value = pageRules.value.filter((item) => item.id !== rule.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function setupTotp(): Promise<void> {
  totpBusy.value = true
  error.value = null
  try {
    const setup = await Api.totpSetup()
    totpSecret.value = setup.secret
    totpUrl.value = setup.otpauthUrl
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    totpBusy.value = false
  }
}

async function enableTotp(): Promise<void> {
  if (!totpCode.value) return
  totpBusy.value = true
  error.value = null
  try {
    auth.user = await Api.totpEnable(totpCode.value)
    totpCode.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    totpBusy.value = false
  }
}

async function disableTotp(): Promise<void> {
  totpBusy.value = true
  error.value = null
  try {
    auth.user = await Api.totpDisable(totpCode.value || undefined)
    totpSecret.value = ''
    totpUrl.value = ''
    totpCode.value = ''
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    totpBusy.value = false
  }
}

async function registerPasskey(): Promise<void> {
  passkeyBusy.value = true
  error.value = null
  try {
    const name = prompt('Passkey name', 'This device')?.trim() || undefined
    const options = await Api.passkeyRegistrationOptions()
    const response = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON })
    const passkey = await Api.passkeyVerifyRegistration(response, name)
    passkeys.value = [...passkeys.value, passkey]
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    passkeyBusy.value = false
  }
}

async function deletePasskey(passkey: PasskeyView): Promise<void> {
  if (!confirm(`Delete passkey "${passkey.name}"?`)) return
  passkeyBusy.value = true
  error.value = null
  try {
    await Api.passkeyDelete(passkey.id)
    passkeys.value = passkeys.value.filter((item) => item.id !== passkey.id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    passkeyBusy.value = false
  }
}

const parseEventTypes = (): string[] =>
  webhookEventTypes.value.split(',').map((eventType) => eventType.trim()).filter(Boolean)

async function createWebhook(): Promise<void> {
  error.value = null
  try {
    const webhook = await Api.adminCreateWebhook({
      name: webhookName.value || undefined,
      targetUrl: webhookUrl.value,
      secret: webhookSecret.value,
      eventTypes: parseEventTypes(),
      enabled: true,
    })
    webhooks.value = [...webhooks.value, webhook]
    webhookName.value = ''
    webhookUrl.value = ''
    webhookSecret.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function toggleWebhook(webhook: WebhookSubscriptionView): Promise<void> {
  error.value = null
  try {
    const updated = await Api.adminUpdateWebhook(webhook.id, { enabled: !webhook.enabled })
    webhooks.value = webhooks.value.map((item) => (item.id === updated.id ? updated : item))
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteWebhook(webhook: WebhookSubscriptionView): Promise<void> {
  if (!confirm(`Delete webhook "${webhook.name}"?`)) return
  error.value = null
  try {
    await Api.adminDeleteWebhook(webhook.id)
    webhooks.value = webhooks.value.filter((item) => item.id !== webhook.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function refreshWebhookDeliveries(): Promise<void> {
  error.value = null
  try {
    webhookDeliveries.value = await Api.adminWebhookDeliveries(deliveryStatus.value === 'all' ? undefined : deliveryStatus.value)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function retryDelivery(delivery: WebhookDeliveryView): Promise<void> {
  error.value = null
  try {
    const updated = await Api.adminRetryWebhookDelivery(delivery.id)
    webhookDeliveries.value = webhookDeliveries.value.map((item) => (item.id === updated.id ? updated : item))
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function createAutomationRule(): Promise<void> {
  error.value = null
  try {
    const rule = await Api.adminCreateAutomationRule({
      name: automationName.value || undefined,
      type: 'page-updated-metadata',
      enabled: true,
      config: {
        pathPrefix: automationPathPrefix.value,
        ...(automationLabel.value ? { label: automationLabel.value } : {}),
        ...(automationStatus.value ? { status: automationStatus.value } : {}),
      },
    })
    automationRules.value = [...automationRules.value, rule]
    automationName.value = ''
    automationPathPrefix.value = ''
    automationLabel.value = ''
    automationStatus.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteAutomationRule(rule: AutomationRuleView): Promise<void> {
  error.value = null
  try {
    await Api.adminDeleteAutomationRule(rule.id)
    automationRules.value = automationRules.value.filter((item) => item.id !== rule.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(() => {
  if (!auth.isAdmin) {
    router.replace('/')
    return
  }
  void load()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold tracking-tight mb-6">Admin</h1>
    <p v-if="error" class="text-sm text-red-600 mb-4">{{ error }}</p>
    <p v-if="loading" class="text-gray-400">Loading…</p>

    <!-- Stats -->
    <div v-if="stats" class="grid grid-cols-3 gap-4 mb-10 max-w-xl">
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ stats.users }}</div>
        <div class="text-sm text-gray-400 mt-1">Users</div>
      </div>
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ stats.pages }}</div>
        <div class="text-sm text-gray-400 mt-1">Pages</div>
      </div>
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ stats.revisions }}</div>
        <div class="text-sm text-gray-400 mt-1">Revisions</div>
      </div>
    </div>

    <div v-if="analytics" class="mb-10 max-w-xl">
      <h2 class="text-lg font-semibold mb-3">Insights</h2>
      <div class="card p-4">
        <div class="text-3xl font-bold">{{ analytics.totalViews }}</div>
        <div class="text-sm text-gray-400 mt-1">Total page views</div>
        <div v-if="analytics.topPages.length" class="mt-4 space-y-2">
          <RouterLink
            v-for="page in analytics.topPages"
            :key="page.path"
            :to="'/' + page.path"
            class="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <span class="truncate font-mono text-sm">/{{ page.path }}</span>
            <span class="text-sm text-gray-500">{{ page.views }}</span>
          </RouterLink>
        </div>
      </div>
    </div>

    <h2 class="text-lg font-semibold mb-3">Account security</h2>
    <div class="card p-4 mb-10 max-w-xl space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="font-medium">Two-factor authentication</div>
          <div class="text-sm text-gray-500">{{ auth.user?.totpEnabled ? 'Enabled' : 'Disabled' }}</div>
        </div>
        <button v-if="!auth.user?.totpEnabled" class="btn-ghost" type="button" :disabled="totpBusy" @click="setupTotp">
          Set up
        </button>
      </div>
      <div v-if="totpSecret" class="space-y-2">
        <input class="input font-mono text-sm" :value="totpSecret" readonly />
        <input class="input font-mono text-xs" :value="totpUrl" readonly />
      </div>
      <div class="flex flex-wrap gap-2">
        <input
          v-model="totpCode"
          class="input max-w-40"
          inputmode="numeric"
          placeholder="2FA code"
          autocomplete="one-time-code"
        />
        <button
          v-if="!auth.user?.totpEnabled"
          class="btn-primary"
          type="button"
          :disabled="totpBusy || !totpSecret || !totpCode"
          @click="enableTotp"
        >
          Enable
        </button>
        <button
          v-else
          class="btn-danger"
          type="button"
          :disabled="totpBusy || !totpCode"
          @click="disableTotp"
        >
          Disable
        </button>
      </div>
      <div class="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="font-medium">Passkeys</div>
            <div class="text-sm text-gray-500">{{ passkeys.length }} registered</div>
          </div>
          <button class="btn-ghost" type="button" :disabled="passkeyBusy" @click="registerPasskey">
            Add passkey
          </button>
        </div>
        <div v-if="passkeys.length" class="space-y-2">
          <div
            v-for="passkey in passkeys"
            :key="passkey.id"
            class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-800 p-3"
          >
            <div>
              <div class="font-medium">{{ passkey.name }}</div>
              <div class="text-xs text-gray-500">
                {{ passkey.deviceType }} · {{ passkey.backedUp ? 'synced' : 'single device' }}
              </div>
            </div>
            <button class="btn-danger" type="button" :disabled="passkeyBusy" @click="deletePasskey(passkey)">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Users -->
    <h2 class="text-lg font-semibold mb-3">Users</h2>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">Name</th>
            <th class="p-3 font-medium">Email</th>
            <th class="p-3 font-medium">Groups</th>
            <th class="p-3 font-medium w-44">Role</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in users"
            :key="u.id"
            class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
          >
            <td class="p-3 font-medium">{{ u.name }}</td>
            <td class="p-3 text-gray-500">{{ u.email }}</td>
            <td class="p-3">
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="group in u.groups"
                  :key="group"
                  class="rounded border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs text-gray-500"
                  type="button"
                  title="Remove from group"
                  @click="removeUserFromGroup(u, group)"
                >
                  {{ group }} ×
                </button>
              </div>
            </td>
            <td class="p-3">
              <select
                class="input py-1"
                :value="u.role"
                @change="changeRole(u, ($event.target as HTMLSelectElement).value as RoleName)"
              >
                <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
              </select>
              <span v-if="u.id === auth.user?.id" class="text-xs text-gray-400 ml-2">(you)</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Groups</h2>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th class="p-3 font-medium">Group</th>
              <th class="p-3 font-medium">Description</th>
              <th class="p-3 font-medium">Members</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in groups"
              :key="group.id"
              class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
            >
              <td class="p-3">
                <div class="font-medium">{{ group.name }}</div>
                <div class="text-xs font-mono text-gray-500">{{ group.key }}</div>
              </td>
              <td class="p-3 text-gray-500">{{ group.description }}</td>
              <td class="p-3 text-gray-500">{{ group.members }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="space-y-3">
        <form class="card p-4 space-y-2" @submit.prevent="createGroup">
          <input v-model="groupKey" class="input" placeholder="group-key" />
          <input v-model="groupName" class="input" placeholder="Group name" />
          <input v-model="groupDescription" class="input" placeholder="Description" />
          <button class="btn-primary" type="submit" :disabled="!groupKey || !groupName">Create group</button>
        </form>
        <div class="card p-4 space-y-2">
          <select v-model="membershipGroup" class="input">
            <option v-for="group in groups" :key="group.key" :value="group.key">{{ group.key }}</option>
          </select>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="u in users"
              :key="u.id"
              class="btn-ghost"
              type="button"
              @click="addUserToGroup(u)"
            >
              Add {{ u.name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Page rules</h2>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th class="p-3 font-medium">Subject</th>
              <th class="p-3 font-medium">Rule</th>
              <th class="p-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!pageRules.length">
              <td class="p-3 text-gray-500" colspan="3">No page rules yet.</td>
            </tr>
            <tr
              v-for="rule in pageRules"
              :key="rule.id"
              class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
            >
              <td class="p-3">
                <div class="font-medium">{{ rule.subjectType }}</div>
                <div class="text-xs font-mono text-gray-500">{{ rule.subjectId || 'anonymous' }}</div>
              </td>
              <td class="p-3 text-gray-500">
                {{ rule.effect }} {{ rule.action }} where path {{ rule.matcher }} {{ rule.pattern }}
              </td>
              <td class="p-3">
                <button class="btn-danger" type="button" @click="deletePageRule(rule)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createPageRule">
        <select v-model="ruleSubjectType" class="input">
          <option value="group">group</option>
          <option value="user">user</option>
          <option value="anonymous">anonymous</option>
        </select>
        <input v-if="ruleSubjectType !== 'anonymous'" v-model="ruleSubjectId" class="input" placeholder="group key or user id" />
        <select v-model="ruleAction" class="input">
          <option value="page:read">page:read</option>
          <option value="page:create">page:create</option>
          <option value="page:update">page:update</option>
          <option value="page:delete">page:delete</option>
          <option value="page:move">page:move</option>
        </select>
        <select v-model="ruleEffect" class="input">
          <option value="allow">allow</option>
          <option value="deny">deny</option>
        </select>
        <select v-model="ruleMatcher" class="input">
          <option value="prefix">prefix</option>
          <option value="exact">exact</option>
          <option value="suffix">suffix</option>
          <option value="regex">regex</option>
        </select>
        <input v-model="rulePattern" class="input" placeholder="docs/private" />
        <button class="btn-primary" type="submit" :disabled="!rulePattern">Create rule</button>
      </form>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Webhooks</h2>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th class="p-3 font-medium">Target</th>
              <th class="p-3 font-medium">Events</th>
              <th class="p-3 font-medium w-44">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!webhooks.length">
              <td class="p-3 text-gray-500" colspan="3">No webhooks yet.</td>
            </tr>
            <tr
              v-for="webhook in webhooks"
              :key="webhook.id"
              class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
            >
              <td class="p-3">
                <div class="font-medium">{{ webhook.name }}</div>
                <div class="text-xs font-mono text-gray-500 break-all">{{ webhook.targetUrl }}</div>
                <div class="text-xs text-gray-500">{{ webhook.enabled ? 'enabled' : 'disabled' }}</div>
              </td>
              <td class="p-3 text-gray-500">{{ webhook.eventTypes.join(', ') }}</td>
              <td class="p-3">
                <div class="flex flex-wrap gap-2">
                  <button class="btn-ghost" type="button" @click="toggleWebhook(webhook)">
                    {{ webhook.enabled ? 'Disable' : 'Enable' }}
                  </button>
                  <button class="btn-danger" type="button" @click="deleteWebhook(webhook)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createWebhook">
        <input v-model="webhookName" class="input" placeholder="Webhook name" />
        <input v-model="webhookUrl" class="input" placeholder="https://example.com/webhook" />
        <input v-model="webhookSecret" class="input" placeholder="Signing secret" />
        <textarea v-model="webhookEventTypes" class="input min-h-20 font-mono text-sm"></textarea>
        <button class="btn-primary" type="submit" :disabled="!webhookUrl || !webhookSecret || !parseEventTypes().length">
          Create webhook
        </button>
      </form>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Webhook deliveries</h2>
    <div class="card overflow-hidden">
      <div class="flex flex-wrap gap-2 p-3 border-b border-gray-100 dark:border-gray-800">
        <select v-model="deliveryStatus" class="input max-w-44" @change="refreshWebhookDeliveries">
          <option value="all">all</option>
          <option value="pending">pending</option>
          <option value="succeeded">succeeded</option>
          <option value="failed">failed</option>
        </select>
        <button class="btn-ghost" type="button" @click="refreshWebhookDeliveries">Refresh</button>
      </div>
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">Event</th>
            <th class="p-3 font-medium">Status</th>
            <th class="p-3 font-medium">Response</th>
            <th class="p-3 font-medium w-28">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!webhookDeliveries.length">
            <td class="p-3 text-gray-500" colspan="4">No deliveries yet.</td>
          </tr>
          <tr
            v-for="delivery in webhookDeliveries"
            :key="delivery.id"
            class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
          >
            <td class="p-3">
              <div class="font-medium">{{ delivery.eventType }}</div>
              <div class="text-xs text-gray-500">{{ delivery.subscriptionName || delivery.subscriptionId }}</div>
            </td>
            <td class="p-3 text-gray-500">
              {{ delivery.status }} · {{ delivery.attempts }} attempt{{ delivery.attempts === 1 ? '' : 's' }}
            </td>
            <td class="p-3 text-gray-500">
              {{ delivery.responseStatus || delivery.error || '-' }}
            </td>
            <td class="p-3">
              <button class="btn-ghost" type="button" :disabled="delivery.status === 'succeeded'" @click="retryDelivery(delivery)">
                Retry
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Automation rules</h2>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th class="p-3 font-medium">Rule</th>
              <th class="p-3 font-medium">Effect</th>
              <th class="p-3 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!automationRules.length">
              <td class="p-3 text-gray-500" colspan="3">No automation rules yet.</td>
            </tr>
            <tr
              v-for="rule in automationRules"
              :key="rule.id"
              class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
            >
              <td class="p-3">
                <div class="font-medium">{{ rule.name }}</div>
                <div class="text-xs font-mono text-gray-500">/{{ rule.config.pathPrefix }}</div>
              </td>
              <td class="p-3 text-gray-500">
                {{ rule.config.label ? `label:${rule.config.label}` : '' }}
                {{ rule.config.status ? `status:${rule.config.status}` : '' }}
              </td>
              <td class="p-3">
                <button class="btn-danger" type="button" @click="deleteAutomationRule(rule)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createAutomationRule">
        <input v-model="automationName" class="input" placeholder="Rule name" />
        <input v-model="automationPathPrefix" class="input" placeholder="docs/runbooks" />
        <input v-model="automationLabel" class="input" placeholder="Label to add" />
        <select v-model="automationStatus" class="input">
          <option value="">leave status</option>
          <option value="draft">draft</option>
          <option value="in-review">in-review</option>
          <option value="verified">verified</option>
          <option value="outdated">outdated</option>
        </select>
        <button
          class="btn-primary"
          type="submit"
          :disabled="!automationPathPrefix || (!automationLabel && !automationStatus)"
        >
          Create rule
        </button>
      </form>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Appearance</h2>
    <form v-if="settings" class="card p-4 space-y-3 max-w-xl" @submit.prevent="saveSettings">
      <input v-model="settings.siteTitle" class="input" placeholder="Site title" />
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input v-model="settings.accentColor" class="input" placeholder="#7c3aed" />
        <select v-model="settings.theme" class="input">
          <option value="system">system</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </div>
      <textarea
        v-model="navLinksText"
        class="input min-h-24 font-mono text-sm"
        placeholder="Docs|/docs&#10;Status|https://status.example.com"
      ></textarea>
      <button class="btn-primary" type="submit" :disabled="settingsSaving">
        {{ settingsSaving ? 'Saving...' : 'Save appearance' }}
      </button>
    </form>

    <h2 class="text-lg font-semibold mt-10 mb-3">Backup and Import</h2>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section class="card p-4">
        <h3 class="font-semibold mb-3">Site export</h3>
        <button class="btn-primary" type="button" @click="exportSite">Download JSON</button>
      </section>
      <form class="card p-4 space-y-3" @submit.prevent="importMarkdown">
        <h3 class="font-semibold">Markdown import</h3>
        <input v-model="importPath" class="input" placeholder="path/to/page" />
        <textarea v-model="importContent" class="input min-h-40 font-mono text-sm" placeholder="Markdown with optional frontmatter"></textarea>
        <input v-model="importLabels" class="input" placeholder="labels, comma separated" />
        <select v-model="importStatus" class="input">
          <option value="draft">draft</option>
          <option value="in-review">in-review</option>
          <option value="verified">verified</option>
          <option value="outdated">outdated</option>
        </select>
        <button class="btn-primary" type="submit" :disabled="importing || !importPath || !importContent">
          {{ importing ? 'Importing...' : 'Import Markdown' }}
        </button>
      </form>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Trash and Archive</h2>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">Page</th>
            <th class="p-3 font-medium">State</th>
            <th class="p-3 font-medium w-52">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!trash.length">
            <td class="p-3 text-gray-500" colspan="3">No archived or trashed pages.</td>
          </tr>
          <tr
            v-for="page in trash"
            :key="page.path"
            class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
          >
            <td class="p-3">
              <div class="font-medium">{{ page.title }}</div>
              <div class="text-xs font-mono text-gray-500">/{{ page.path }}</div>
            </td>
            <td class="p-3 text-gray-500">{{ page.lifecycle }}</td>
            <td class="p-3">
              <div class="flex flex-wrap gap-2">
                <button class="btn-ghost" type="button" @click="restorePage(page.path)">Restore</button>
                <button class="btn-danger" type="button" @click="purgePage(page.path)">Purge</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="text-lg font-semibold mt-10 mb-3">Assets</h2>
    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
          <tr>
            <th class="p-3 font-medium">File</th>
            <th class="p-3 font-medium">Type</th>
            <th class="p-3 font-medium">Size</th>
            <th class="p-3 font-medium w-48">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!assets.length">
            <td class="p-3 text-gray-500" colspan="4">No uploaded assets yet.</td>
          </tr>
          <tr
            v-for="asset in assets"
            :key="asset.id"
            class="border-b border-gray-100 dark:border-gray-800/60 last:border-0"
          >
            <td class="p-3">
              <a :href="asset.url" class="link-quiet font-medium" target="_blank" rel="noopener noreferrer">
                {{ asset.filename }}
              </a>
              <div class="text-xs font-mono text-gray-500">{{ asset.url }}</div>
            </td>
            <td class="p-3 text-gray-500">{{ asset.mime }}</td>
            <td class="p-3 text-gray-500">{{ formatBytes(asset.size) }}</td>
            <td class="p-3">
              <div class="flex flex-wrap gap-2">
                <button class="btn-ghost" type="button" @click="renameAsset(asset)">Rename</button>
                <button class="btn-danger" type="button" @click="deleteAsset(asset)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
