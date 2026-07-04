<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type AutomationRuleView } from '@/lib/api'

const rules = ref<AutomationRuleView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const name = ref('')
const pathPrefix = ref('')
const label = ref('')
const status = ref<'' | 'draft' | 'in-review' | 'verified' | 'outdated'>('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    rules.value = await Api.adminAutomationRules()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function createRule(): Promise<void> {
  error.value = null
  try {
    const rule = await Api.adminCreateAutomationRule({
      name: name.value || undefined,
      type: 'page-updated-metadata',
      enabled: true,
      config: {
        pathPrefix: pathPrefix.value,
        ...(label.value ? { label: label.value } : {}),
        ...(status.value ? { status: status.value } : {}),
      },
    })
    rules.value = [...rules.value, rule]
    name.value = ''
    pathPrefix.value = ''
    label.value = ''
    status.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteRule(rule: AutomationRuleView): Promise<void> {
  error.value = null
  try {
    await Api.adminDeleteAutomationRule(rule.id)
    rules.value = rules.value.filter((item) => item.id !== rule.id)
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Automation rules</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="loading" class="text-gray-400 mb-3">Loading...</p>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr><th class="p-3 font-medium">Rule</th><th class="p-3 font-medium">Effect</th><th class="p-3 font-medium w-24">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-if="!rules.length"><td class="p-3 text-gray-500" colspan="3">No automation rules yet.</td></tr>
            <tr v-for="rule in rules" :key="rule.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td class="p-3"><div class="font-medium">{{ rule.name }}</div><div class="text-xs font-mono text-gray-500">/{{ rule.config.pathPrefix }}</div></td>
              <td class="p-3 text-gray-500">{{ rule.config.label ? `label:${rule.config.label}` : '' }} {{ rule.config.status ? `status:${rule.config.status}` : '' }}</td>
              <td class="p-3"><button class="btn-danger" type="button" @click="deleteRule(rule)">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createRule">
        <input v-model="name" class="input" placeholder="Rule name" />
        <input v-model="pathPrefix" class="input" placeholder="docs/runbooks" />
        <input v-model="label" class="input" placeholder="Label to add" />
        <select v-model="status" class="input"><option value="">leave status</option><option value="draft">draft</option><option value="in-review">in-review</option><option value="verified">verified</option><option value="outdated">outdated</option></select>
        <button class="btn-primary" type="submit" :disabled="!pathPrefix || (!label && !status)">Create rule</button>
      </form>
    </div>
  </section>
</template>
