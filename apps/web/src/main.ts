import { createApp } from 'vue'
import { createPinia } from 'pinia'

import 'uno.css'
import '@unocss/reset/tailwind.css'
import './app.css'

import App from './App.vue'
import { router } from './router'
import { initTheme } from './composables/useTheme'
import { useAuth } from './stores/auth'
import { usePages } from './stores/pages'
import { connectRealtime, onWikiEvent } from './lib/realtime'

// Apply the saved/OS theme before mount so there is no light-mode flash.
initTheme()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Best-effort: resolve the logged-in user in the background.
void useAuth().fetchMe()

// Realtime: keep the page list live as pages are created/renamed/deleted.
connectRealtime()
onWikiEvent(() => {
  void usePages().refresh()
})
