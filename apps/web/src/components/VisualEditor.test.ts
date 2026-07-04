import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'

describe('VisualEditor', () => {
  test('serializes edited visual blocks back to Markdown', async () => {
    const VisualEditor = (await import('./VisualEditor.vue')).default
    const wrapper = mount(VisualEditor, {
      props: { modelValue: '# Title\n\nParagraph with **bold** text.\n' },
      attachTo: document.body,
    })

    const editable = wrapper.find('[contenteditable="true"]')
    expect(editable.find('h1').text()).toBe('Title')
    expect(editable.find('strong').text()).toBe('bold')

    editable.element.innerHTML = [
      '<h2>Heading</h2>',
      '<p>Hello <strong>bold</strong> <em>there</em> <code>x</code> <a href="https://example.com">site</a></p>',
      '<ul><li>One</li><li>Two</li></ul>',
      '<p><img src="/api/assets/a.png" alt="diagram"></p>',
    ].join('')
    await editable.trigger('input')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(
      '## Heading\n\nHello **bold** *there* `x` [site](https://example.com)\n\n- One\n- Two\n\n![diagram](/api/assets/a.png)\n',
    )
  })

  test('keeps unsupported Markdown visible as raw editable blocks', async () => {
    const VisualEditor = (await import('./VisualEditor.vue')).default
    const wrapper = mount(VisualEditor, {
      props: {
        modelValue: [
          '```event',
          'title: Sync',
          'start: 2026-07-05 10:00',
          '```',
          '',
          '> quoted note',
          '',
        ].join('\n'),
      },
      attachTo: document.body,
    })

    const editable = wrapper.find('[contenteditable="true"]')
    const rawBlocks = editable.findAll('[data-md-block="raw"]')
    expect(rawBlocks).toHaveLength(2)
    expect(rawBlocks[0]!.text()).toContain('```event')
    expect(rawBlocks[1]!.text()).toBe('> quoted note')

    rawBlocks[1]!.element.textContent = '> updated quote'
    await editable.trigger('input')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toContain('> updated quote\n')
  })
})
