<script setup lang="ts">
import { friendlyError } from '@/lib/friendlyErrors'
import { computed, ref } from 'vue'
import { Api, type AutomationRuleView } from '@/lib/api'
import Skeleton from '@/components/Skeleton.vue'
import { useAsyncData } from '@/composables/useAsyncData'

const { data: rules, loading, error, reload: load } = useAsyncData<AutomationRuleView[]>(Api.adminAutomationRules, { initial: [] })
const name = ref('')
const trigger = ref<AutomationRuleView['config']['trigger']>('page.updated')
const pathPrefix = ref('')
const conditionLabel = ref('')
const conditionStatus = ref<'' | 'draft' | 'in-review' | 'verified' | 'outdated'>('')
const authorId = ref('')
const locale = ref('')
const spaceKey = ref('')
const addLabel = ref('')
const setStatus = ref<'' | 'draft' | 'in-review' | 'verified' | 'outdated'>('')
const reviewAtDate = ref('')
const clearReviewAt = ref(false)
const moveToPath = ref('')
const fireWebhookEvent = ref('')
const priority = ref(0)
const stopOnMatch = ref(false)

const hasAction = computed(() => Boolean(
  addLabel.value ||
  setStatus.value ||
  reviewAtDate.value ||
  clearReviewAt.value ||
  moveToPath.value ||
  fireWebhookEvent.value,
))

function reviewAtAction(): number | null | undefined {
  if (clearReviewAt.value) return null
  if (!reviewAtDate.value) return undefined
  const value = new Date(`${reviewAtDate.value}T00:00:00`).getTime()
  return Number.isFinite(value) ? value : undefined
}

function resetForm(): void {
  name.value = ''
  trigger.value = 'page.updated'
  pathPrefix.value = ''
  conditionLabel.value = ''
  conditionStatus.value = ''
  authorId.value = ''
  locale.value = ''
  spaceKey.value = ''
  addLabel.value = ''
  setStatus.value = ''
  reviewAtDate.value = ''
  clearReviewAt.value = false
  moveToPath.value = ''
  fireWebhookEvent.value = ''
  priority.value = 0
  stopOnMatch.value = false
}

async function createRule(): Promise<void> {
  error.value = null
  try {
    const rule = await Api.adminCreateAutomationRule({
      name: name.value || undefined,
      type: 'event-rule',
      enabled: true,
      priority: priority.value,
      stopOnMatch: stopOnMatch.value,
      config: {
        trigger: trigger.value,
        conditions: {
          ...(pathPrefix.value ? { pathPrefix: pathPrefix.value } : {}),
          ...(conditionLabel.value ? { label: conditionLabel.value } : {}),
          ...(conditionStatus.value ? { status: conditionStatus.value } : {}),
          ...(authorId.value ? { authorId: authorId.value } : {}),
          ...(locale.value ? { locale: locale.value } : {}),
          ...(spaceKey.value ? { spaceKey: spaceKey.value } : {}),
        },
        actions: {
          ...(addLabel.value ? { addLabel: addLabel.value } : {}),
          ...(setStatus.value ? { setStatus: setStatus.value } : {}),
          ...(reviewAtAction() !== undefined ? { setReviewAt: reviewAtAction() } : {}),
          ...(moveToPath.value ? { moveToPath: moveToPath.value } : {}),
          ...(fireWebhookEvent.value ? { fireWebhookEvent: fireWebhookEvent.value } : {}),
        },
      },
    })
    rules.value = [...rules.value, rule]
    resetForm()
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function deleteRule(rule: AutomationRuleView): Promise<void> {
  error.value = null
  try {
    await Api.adminDeleteAutomationRule(rule.id)
    rules.value = rules.value.filter((item) => item.id !== rule.id)
  } catch (e) {
    error.value = friendlyError(e)
  }
}

function describeConditions(rule: AutomationRuleView): string {
  const c = rule.config.conditions
  return [
    rule.config.trigger,
    c.pathPrefix ? `/${c.pathPrefix}` : '',
    c.label ? `label:${c.label}` : '',
    c.status ? `status:${c.status}` : '',
    c.authorId ? `author:${c.authorId}` : '',
    c.locale ? `locale:${c.locale}` : '',
    c.spaceKey ? `space:${c.spaceKey}` : '',
  ].filter(Boolean).join(' · ')
}

function describeActions(rule: AutomationRuleView): string {
  const a = rule.config.actions
  return [
    a.addLabel ? `add label:${a.addLabel}` : '',
    a.setStatus ? `set status:${a.setStatus}` : '',
    'setReviewAt' in a ? `review:${a.setReviewAt ? new Date(a.setReviewAt).toLocaleDateString() : 'clear'}` : '',
    a.moveToPath ? `move under /${a.moveToPath}` : '',
    a.fireWebhookEvent ? `webhook:${a.fireWebhookEvent}` : '',
  ].filter(Boolean).join(' · ')
}

</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Automation rules</h2>
    <p v-if="error" class="text-sm text-red-600 mb-3">{{ error }}</p>
    <Skeleton v-if="loading" class="mb-3" label="Loading automation rules" :lines="3" />
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-4">
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left text-[var(--c-text-muted)] border-b border-gray-200 dark:border-gray-800">
            <tr><th class="p-3 font-medium">Rule</th><th class="p-3 font-medium">Effect</th><th class="p-3 font-medium w-24">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-if="!rules.length"><td class="p-3 text-gray-500" colspan="3">No automation rules yet.</td></tr>
            <tr v-for="rule in rules" :key="rule.id" class="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
              <td class="p-3">
                <div class="font-medium">{{ rule.name }}</div>
                <div class="text-xs font-mono text-gray-500">{{ describeConditions(rule) }}</div>
                <div class="text-xs text-gray-500">priority {{ rule.priority }}{{ rule.stopOnMatch ? ' · stop on match' : '' }}</div>
              </td>
              <td class="p-3 text-gray-500">{{ describeActions(rule) }}</td>
              <td class="p-3"><button class="btn-danger" type="button" @click="deleteRule(rule)">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="card p-4 space-y-3" @submit.prevent="createRule">
        <input v-model="name" class="input" placeholder="Rule name" aria-label="Rule name" />
        <select v-model="trigger" class="input" aria-label="Trigger">
          <option value="page.created">page.created</option>
          <option value="page.updated">page.updated</option>
          <option value="page.deleted">page.deleted</option>
          <option value="page.moved">page.moved</option>
          <option value="comment.created">comment.created</option>
        </select>
        <div class="grid grid-cols-2 gap-2">
          <input v-model.number="priority" class="input" type="number" placeholder="Priority" aria-label="Priority" />
          <label class="flex items-center gap-2 text-sm">
            <input v-model="stopOnMatch" type="checkbox" />
            <span>Stop on match</span>
          </label>
        </div>
        <div class="space-y-2">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Conditions</div>
          <input v-model="pathPrefix" class="input" placeholder="Path prefix, e.g. docs/runbooks" aria-label="Condition path prefix" />
          <input v-model="conditionLabel" class="input" placeholder="Existing label" aria-label="Condition label" />
          <select v-model="conditionStatus" class="input" aria-label="Condition status"><option value="">any status</option><option value="draft">draft</option><option value="in-review">in-review</option><option value="verified">verified</option><option value="outdated">outdated</option></select>
          <input v-model="authorId" class="input" placeholder="Author/user id" aria-label="Author or user ID" />
          <div class="grid grid-cols-2 gap-2">
            <input v-model="locale" class="input" placeholder="Locale" aria-label="Condition locale" />
            <input v-model="spaceKey" class="input" placeholder="Space" aria-label="Condition space" />
          </div>
        </div>
        <div class="space-y-2">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</div>
          <input v-model="addLabel" class="input" placeholder="Label to add" aria-label="Label to add" />
          <select v-model="setStatus" class="input" aria-label="Status to set"><option value="">leave status</option><option value="draft">draft</option><option value="in-review">in-review</option><option value="verified">verified</option><option value="outdated">outdated</option></select>
          <input v-model="reviewAtDate" class="input" type="date" :disabled="clearReviewAt" aria-label="Review date to set" />
          <label class="flex items-center gap-2 text-sm">
            <input v-model="clearReviewAt" type="checkbox" />
            <span>Clear review date</span>
          </label>
          <input v-model="moveToPath" class="input" placeholder="Move under path" aria-label="Move under path" />
          <input v-model="fireWebhookEvent" class="input" placeholder="Webhook event to fire" aria-label="Webhook event to fire" />
        </div>
        <button class="btn-primary" type="submit" :disabled="!hasAction">Create rule</button>
      </form>
    </div>
  </section>
</template>
