import { ref, watch, onUnmounted, type Ref } from 'vue'
import { connectPresence, type PresenceViewer, type ViewerMode } from '@/lib/presence'
import { useAuth } from '@/stores/auth'

/**
 * Reactive list of who is currently on `path`. `mode` is how *we* announce
 * ourselves ('viewing' for readers, 'editing' for the editor). Re-connects when
 * the path changes and cleans up on unmount.
 */
export function usePresence(path: Ref<string>, mode: ViewerMode = 'viewing') {
  const viewers = ref<PresenceViewer[]>([])
  const auth = useAuth()
  let disconnect: (() => void) | null = null

  function connect(target: string): void {
    disconnect?.()
    viewers.value = []
    disconnect = connectPresence(
      target,
      { name: auth.user?.name ?? 'Anonymous', userId: auth.user?.id ?? null, mode },
      (next) => {
        viewers.value = next
      },
    )
  }

  watch(
    path,
    (target) => {
      if (target) connect(target)
    },
    { immediate: true },
  )

  onUnmounted(() => disconnect?.())

  return { viewers }
}
