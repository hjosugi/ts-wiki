<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const name = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    if (mode.value === 'login') {
      await auth.login(email.value, password.value)
    } else {
      await auth.register(email.value, name.value, password.value)
    }
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
    busy.value = false
  }
}
</script>

<template>
  <div class="max-w-sm mx-auto card p-6 mt-8">
    <h1 class="text-xl font-bold mb-1">{{ mode === 'login' ? 'Sign in' : 'Create account' }}</h1>
    <p class="text-sm text-gray-400 mb-5">
      {{ mode === 'login' ? 'Welcome back.' : 'The first account to register becomes the admin.' }}
    </p>

    <form class="space-y-3" @submit.prevent="submit">
      <input v-model="email" class="input" placeholder="Email" autocomplete="username" />
      <input v-if="mode === 'register'" v-model="name" class="input" placeholder="Display name" />
      <input
        v-model="password"
        type="password"
        class="input"
        placeholder="Password"
        autocomplete="current-password"
      />
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button class="btn-primary w-full justify-center" :disabled="busy || !email || !password">
        {{ busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account' }}
      </button>
    </form>

    <button
      class="text-sm link-quiet mt-4"
      @click="mode = mode === 'login' ? 'register' : 'login'"
    >
      {{ mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in' }}
    </button>

    <p class="text-xs text-gray-400 mt-6">
      Seeded admin: <code class="font-mono">admin@example.com</code>; password comes from
      <code class="font-mono">db:seed</code>.
    </p>
  </div>
</template>
