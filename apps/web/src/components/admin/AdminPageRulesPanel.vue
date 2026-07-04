<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Api, type PageRuleView } from '@/lib/api'

const pageRules = ref<PageRuleView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const subjectType = ref<PageRuleView['subjectType']>('group')
const subjectId = ref('viewers')
const action = ref<PageRuleView['action']>('page:read')
const effect = ref<PageRuleView['effect']>('allow')
const matcher = ref<PageRuleView['matcher']>('prefix')
const pattern = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    pageRules.value = await Api.adminPageRules()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function createPageRule(): Promise<void> {
  error.value = null
  try {
    const rule = await Api.adminCreatePageRule({
      subjectType: subjectType.value,
      subjectId: subjectType.value === 'anonymous' ? null : subjectId.value,
      action: action.value,
      effect: effect.value,
      matcher: matcher.value,
      pattern: pattern.value,
    })
    pageRules.value = [...pageRules.value, rule]
    pattern.value = ''
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

onMounted(load)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Page rules</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <p v-if="loading" class="text-gray-400 mb-3">Loading...</p>
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-400 border-b border-gray-200 dark:border-gray-800">
            <tr><th class="p-3 font-medium">Subject</th><th class="p-3 font-medium">Rule</th><th class="p-3 font-medium w-24">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-if="!pageRules.length"><td class="p-3 text-gray-500" colspan="3">No page rules yet.</td></tr>
            <tr v-for="rule in pageRules" :key="rule.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td class="p-3"><div class="font-medium">{{ rule.subjectType }}</div><div class="text-xs font-mono text-gray-500">{{ rule.subjectId || 'anonymous' }}</div></td>
              <td class="p-3 text-gray-500">{{ rule.effect }} {{ rule.action }} where path {{ rule.matcher }} {{ rule.pattern }}</td>
              <td class="p-3"><button class="btn-danger" type="button" @click="deletePageRule(rule)">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-2" @submit.prevent="createPageRule">
        <select v-model="subjectType" class="input"><option value="group">group</option><option value="user">user</option><option value="anonymous">anonymous</option></select>
        <input v-if="subjectType !== 'anonymous'" v-model="subjectId" class="input" placeholder="group key or user id" />
        <select v-model="action" class="input"><option value="page:read">page:read</option><option value="page:create">page:create</option><option value="page:update">page:update</option><option value="page:delete">page:delete</option><option value="page:move">page:move</option></select>
        <select v-model="effect" class="input"><option value="allow">allow</option><option value="deny">deny</option></select>
        <select v-model="matcher" class="input"><option value="prefix">prefix</option><option value="exact">exact</option><option value="suffix">suffix</option><option value="regex">regex</option></select>
        <input v-model="pattern" class="input" placeholder="docs/private" />
        <button class="btn-primary" type="submit" :disabled="!pattern">Create rule</button>
      </form>
    </div>
  </section>
</template>
