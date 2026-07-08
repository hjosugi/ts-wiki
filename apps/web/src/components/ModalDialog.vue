<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  containerClass?: string
  panelClass?: string
}>(), {
  containerClass: 'items-center justify-center p-4',
  panelClass: 'card w-full max-w-lg p-4',
})

const emit = defineEmits<{
  close: []
}>()

const panel = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
let previousBodyOverflow: string | null = null
let focusTimer: number | null = null

const focusableSelector = [
  'a[href]',
  'button',
  'textarea',
  'input',
  'select',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const focusableElements = (): HTMLElement[] =>
  Array.from(panel.value?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
    .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)

function close(): void {
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const elements = focusableElements()
  if (!elements.length) {
    event.preventDefault()
    panel.value?.focus()
    return
  }
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

function cleanup(): void {
  window.removeEventListener('keydown', onKeydown)
  if (focusTimer !== null) window.clearTimeout(focusTimer)
  focusTimer = null
  if (previousBodyOverflow !== null) document.body.style.overflow = previousBodyOverflow
  previousBodyOverflow = null
}

function focusInitialControl(): void {
  const target = focusableElements()[0] ?? panel.value
  target?.focus()
}

function scheduleFocusRetry(): void {
  focusTimer = window.setTimeout(() => {
    focusTimer = null
    if (props.open && document.activeElement === panel.value) focusInitialControl()
  })
}

async function activate(): Promise<void> {
  cleanup()
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  focusInitialControl()
  scheduleFocusRetry()
}

function deactivate(): void {
  cleanup()
  previousFocus?.focus()
  previousFocus = null
}

onMounted(() => {
  if (props.open) void activate()
})

watch(() => props.open, (open) => {
  if (open) void activate()
  else deactivate()
}, { flush: 'post' })

onBeforeUnmount(cleanup)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex bg-black/40"
      :class="containerClass"
      @click.self="close"
    >
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        :class="panelClass"
      >
        <slot />
      </section>
    </div>
  </Teleport>
</template>
