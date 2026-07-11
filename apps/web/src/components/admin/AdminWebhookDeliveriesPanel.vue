<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { ref } from 'vue'
import { Api, type WebhookDeliveryView } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'

const deliveries = ref<WebhookDeliveryView[]>([])
const status = ref<'all' | WebhookDeliveryView['status']>('all')

const { loading, error, reload: load } = useAsyncData(async () => {
  deliveries.value = await Api.adminWebhookDeliveries(status.value === 'all' ? undefined : status.value)
})

async function retryDelivery(delivery: WebhookDeliveryView): Promise<void> {
  error.value = null
  try {
    const updated = await Api.adminRetryWebhookDelivery(delivery.id)
    deliveries.value = deliveries.value.map((item) => (item.id === updated.id ? updated : item))
  } catch (e) {
    error.value = friendlyError(e)
  }
}

</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Webhook deliveries</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <div class="card overflow-hidden">
      <div class="flex flex-wrap gap-2 p-3 border-b border-gray-100 dark:border-gray-800">
        <select v-model="status" class="input max-w-44" aria-label="Delivery status" @change="load">
          <option value="all">all</option><option value="pending">pending</option><option value="succeeded">succeeded</option><option value="failed">failed</option>
        </select>
        <button class="btn-ghost" type="button" :disabled="loading" @click="load">Refresh</button>
      </div>
      <table class="w-full text-sm">
        <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
          <tr><th class="p-3 font-medium">Event</th><th class="p-3 font-medium">Status</th><th class="p-3 font-medium">Response</th><th class="p-3 font-medium w-28">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-if="loading && !deliveries.length">
            <td class="p-3" colspan="4"><Skeleton label="Loading webhook deliveries" :lines="3" /></td>
          </tr>
          <tr v-else-if="!deliveries.length"><td class="p-3 text-gray-500" colspan="4">No deliveries yet.</td></tr>
          <tr v-for="delivery in deliveries" :key="delivery.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
            <td class="p-3"><div class="font-medium">{{ delivery.eventType }}</div><div class="text-xs text-gray-500">{{ delivery.subscriptionName || delivery.subscriptionId }}</div></td>
            <td class="p-3 text-gray-500">{{ delivery.status }} · {{ delivery.attempts }} attempt{{ delivery.attempts === 1 ? '' : 's' }}</td>
            <td class="p-3 text-gray-500">{{ delivery.responseStatus || delivery.error || '-' }}</td>
            <td class="p-3"><button class="btn-ghost" type="button" :disabled="delivery.status === 'succeeded'" @click="retryDelivery(delivery)">Retry</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
