import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ModalDialog from './ModalDialog.vue'

describe('ModalDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  test('renders modal dialog semantics and closes on Escape', async () => {
    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Import .ics' },
      slots: { default: '<button type="button">Inside</button>' },
    })

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Import .ics')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('traps focus, restores focus, and unlocks body scrolling after close', async () => {
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.textContent = 'Trigger'
    document.body.appendChild(trigger)
    trigger.focus()

    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Assets' },
      slots: {
        default: `
          <button type="button" id="first">First</button>
          <button type="button" id="last">Last</button>
        `,
      },
    })
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.vm.$nextTick()

    const first = document.getElementById('first')
    const last = document.getElementById('last')
    await vi.waitFor(() => expect(document.activeElement).toBe(first))

    last?.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement).toBe(first)

    first?.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(last)

    await wrapper.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
  })
})
