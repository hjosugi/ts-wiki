<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PageTemplatesPanel from '@/components/PageTemplatesPanel.vue'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()

onMounted(() => {
  if (!auth.canEdit) router.replace('/')
})
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-bold tracking-tight">Page templates</h1>
    <PageTemplatesPanel />
  </div>
</template>
