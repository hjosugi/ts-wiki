<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type WebhookSubscriptionView } from '@/lib/api'

const webhooks = ref<WebhookSubscriptionView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const name = ref('')
const url = ref('')
const secret = ref('')
const eventTypes = ref('page.created,page.updated,page.deleted,comment.created,asset.created,user.created')

const parseEventTypes = (): string[] => eventTypes.value.split(',').map((eventType) => eventType.trim()).filter(Boolean)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    webhooks.value = await Api.adminWebhooks()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function createWebhook(): Promise<void> {
  error.value = null
  try {
    const webhook = await Api.adminCreateWebhook({
      name: name.value || undefined,
      targetUrl: url.value,
      secret: secret.value,
      eventTypes: parseEventTypes(),
      enabled: true,
    })
    webhooks.value = [...webhooks.value, webhook]
    name.value = ''
    url.value = ''
    secret.value = ''
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

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Webhooks</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="loading" class="text-gray-400 mb-3">Loading...</p>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr><th class="p-3 font-medium">Target</th><th class="p-3 font-medium">Events</th><th class="p-3 font-medium w-44">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-if="!webhooks.length"><td class="p-3 text-gray-500" colspan="3">No webhooks yet.</td></tr>
            <tr v-for="webhook in webhooks" :key="webhook.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td class="p-3"><div class="font-medium">{{ webhook.name }}</div><div class="text-xs font-mono text-gray-500 break-all">{{ webhook.targetUrl }}</div><div class="text-xs text-gray-500">{{ webhook.enabled ? 'enabled' : 'disabled' }}</div></td>
              <td class="p-3 text-gray-500">{{ webhook.eventTypes.join(', ') }}</td>
              <td class="p-3"><div class="flex flex-wrap gap-2"><button class="btn-ghost" type="button" @click="toggleWebhook(webhook)">{{ webhook.enabled ? 'Disable' : 'Enable' }}</button><button class="btn-danger" type="button" @click="deleteWebhook(webhook)">Delete</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createWebhook">
        <input v-model="name" class="input" placeholder="Webhook name" />
        <input v-model="url" class="input" placeholder="https://example.com/webhook" />
        <input v-model="secret" class="input" placeholder="Signing secret" />
        <textarea v-model="eventTypes" class="input min-h-20 font-mono text-sm"></textarea>
        <button class="btn-primary" type="submit" :disabled="!url || !secret || !parseEventTypes().length">Create webhook</button>
      </form>
    </div>
  </section>
</template>
