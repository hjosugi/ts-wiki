<script setup lang="ts">
import AdminPasskeysPanel from './AdminPasskeysPanel.vue'
import AdminTotpPanel from './AdminTotpPanel.vue'
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold mb-3">Account security</h2>
    <div class="card p-4 max-w-xl space-y-4">
      <AdminTotpPanel />
      <AdminPasskeysPanel />
    </div>
  </section>
</template>
