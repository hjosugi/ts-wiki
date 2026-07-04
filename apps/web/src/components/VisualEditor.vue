<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Api } from '@/lib/api'
import AssetPicker from '@/components/AssetPicker.vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editor = ref<HTMLElement | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const showAssets = ref(false)
let lastEmitted = ''

interface CalloutBlock {
  type: string
  title: string
  body: string
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const escapeAttr = escapeHtml

const visibleText = (node: Node): string =>
  (node.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')

const isBlank = (line: string): boolean => line.trim() === ''
const isFenceStart = (line: string): RegExpMatchArray | null => line.match(/^```([A-Za-z0-9_-]*)\s*$/)
const isHeading = (line: string): RegExpMatchArray | null => line.match(/^(#{1,6})\s+(.+)$/)
const isTableSeparator = (line: string): boolean =>
  /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line) && line.includes('-')
const isPipeRow = (line: string): boolean => line.trim().startsWith('|') && line.trim().endsWith('|')
const isListItem = (line: string): RegExpMatchArray | null => line.match(/^([-*+]|\d+[.)])\s+(.+)$/)
const isRawBlockStart = (line: string): boolean =>
  /^(>\s+| {4,}|\t|\s+[-*+]\s+|\s+\d+[.)]\s+|---+$|\*\*\*+$|___+$)/.test(line)

const tableCells = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

const parseCallout = (content: string): CalloutBlock => {
  const fields = new Map<string, string>()
  const body: string[] = []
  let inBody = false

  for (const line of content.split('\n')) {
    const match = !inBody ? line.match(/^([A-Za-z][A-Za-z_-]*):\s*(.*)$/) : null
    if (match && ['type', 'title'].includes(match[1]!.toLowerCase())) {
      fields.set(match[1]!.toLowerCase(), match[2]!.trim())
      continue
    }
    inBody = true
    body.push(line)
  }

  const type = fields.get('type') || 'info'
  return {
    type: ['info', 'success', 'warning', 'danger'].includes(type) ? type : 'info',
    title: fields.get('title') || type,
    body: body.join('\n').trim(),
  }
}

const inlineToHtml = (markdown: string): string => {
  let html = ''
  let index = 0

  while (index < markdown.length) {
    const rest = markdown.slice(index)
    const image = rest.match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    if (image) {
      html += `<img src="${escapeAttr(image[2] ?? '')}" alt="${escapeAttr(image[1] ?? '')}" />`
      index += image[0].length
      continue
    }

    const link = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (link) {
      html += `<a href="${escapeAttr(link[2] ?? '')}">${inlineToHtml(link[1] ?? '')}</a>`
      index += link[0].length
      continue
    }

    const bold = rest.match(/^\*\*([^*]+)\*\*/)
    if (bold) {
      html += `<strong>${inlineToHtml(bold[1] ?? '')}</strong>`
      index += bold[0].length
      continue
    }

    const italic = rest.match(/^\*([^*]+)\*/)
    if (italic) {
      html += `<em>${inlineToHtml(italic[1] ?? '')}</em>`
      index += italic[0].length
      continue
    }

    const underItalic = rest.match(/^_([^_]+)_/)
    if (underItalic) {
      html += `<em>${inlineToHtml(underItalic[1] ?? '')}</em>`
      index += underItalic[0].length
      continue
    }

    const code = rest.match(/^`([^`]+)`/)
    if (code) {
      html += `<code>${escapeHtml(code[1] ?? '')}</code>`
      index += code[0].length
      continue
    }

    html += escapeHtml(markdown[index] ?? '')
    index += 1
  }

  return html
}

const rawBlockHtml = (markdown: string): string =>
  `<pre class="visual-editor-raw" data-md-block="raw">${escapeHtml(markdown)}</pre>`

const calloutHtml = (content: string): string => {
  const callout = parseCallout(content)
  return `<aside class="visual-editor-callout wiki-callout wiki-callout-${escapeAttr(callout.type)}" data-md-block="callout" data-callout-type="${escapeAttr(callout.type)}">
    <div class="wiki-callout-title" data-callout-title="true">${inlineToHtml(callout.title)}</div>
    <div class="wiki-callout-body" data-callout-body="true">${markdownToEditableHtml(callout.body)}</div>
  </aside>`
}

const markdownToEditableHtml = (markdown: string): string => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (isBlank(line)) {
      index += 1
      continue
    }

    const fence = isFenceStart(line)
    if (fence) {
      const start = index
      const info = (fence[1] ?? '').toLowerCase()
      index += 1
      const body: string[] = []
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(info === 'callout' ? calloutHtml(body.join('\n')) : rawBlockHtml(lines.slice(start, index).join('\n')))
      continue
    }

    const heading = isHeading(line)
    if (heading) {
      const level = heading[1]!.length
      blocks.push(`<h${level}>${inlineToHtml(heading[2] ?? '')}</h${level}>`)
      index += 1
      continue
    }

    if (index + 1 < lines.length && isPipeRow(line) && isTableSeparator(lines[index + 1] ?? '')) {
      const header = tableCells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && isPipeRow(lines[index] ?? '')) {
        rows.push(tableCells(lines[index] ?? ''))
        index += 1
      }
      blocks.push(`<table><thead><tr>${header.map((cell) => `<th>${inlineToHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineToHtml(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`)
      continue
    }

    const list = isListItem(line)
    if (list) {
      const start = index
      let scan = index
      let hasIndentedListContent = false
      while (scan < lines.length && !isBlank(lines[scan] ?? '')) {
        const candidate = lines[scan] ?? ''
        if (/^(\s+[-*+]\s+|\s+\d+[.)]\s+| {2,}\S|\t\S)/.test(candidate)) {
          hasIndentedListContent = true
          scan += 1
          continue
        }
        if (!isListItem(candidate)) break
        scan += 1
      }
      if (hasIndentedListContent) {
        // Nested/continued lists are kept raw until the visual serializer grows
        // a real Markdown list tree; flattening them would silently change data.
        blocks.push(rawBlockHtml(lines.slice(start, scan).join('\n')))
        index = scan
        continue
      }

      const ordered = /^\d/.test(list[1] ?? '')
      const tag = ordered ? 'ol' : 'ul'
      const items: string[] = []
      while (index < lines.length) {
        const item = isListItem(lines[index] ?? '')
        if (!item || /^\d/.test(item[1] ?? '') !== ordered) break
        items.push(`<li>${inlineToHtml(item[2] ?? '')}</li>`)
        index += 1
      }
      blocks.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    if (isRawBlockStart(line)) {
      const raw: string[] = []
      while (index < lines.length && !isBlank(lines[index] ?? '')) {
        raw.push(lines[index] ?? '')
        index += 1
      }
      // Unsupported block Markdown stays visible and round-trips as raw text
      // instead of being rendered through an incomplete visual parser.
      blocks.push(rawBlockHtml(raw.join('\n')))
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (
        isBlank(next) ||
        isFenceStart(next) ||
        isHeading(next) ||
        isRawBlockStart(next) ||
        isListItem(next) ||
        (index + 1 < lines.length && isPipeRow(next) && isTableSeparator(lines[index + 1] ?? ''))
      ) {
        break
      }
      paragraph.push(next)
      index += 1
    }
    blocks.push(`<p>${inlineToHtml(paragraph.join(' '))}</p>`)
  }

  return blocks.join('\n') || '<p><br></p>'
}

const markdownText = (node: Node): string => visibleText(node).replace(/\s+/g, ' ').trim()

const inlineMarkdown = (nodes: NodeListOf<ChildNode> | ChildNode[]): string =>
  Array.from(nodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
      if (!(node instanceof HTMLElement)) return ''
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') return '\n'
      if (tag === 'strong' || tag === 'b') return `**${inlineMarkdown(node.childNodes)}**`
      if (tag === 'em' || tag === 'i') return `*${inlineMarkdown(node.childNodes)}*`
      if (tag === 'code') return `\`${visibleText(node).replace(/`/g, '\\`')}\``
      if (tag === 'a') {
        const href = node.getAttribute('href')
        const label = inlineMarkdown(node.childNodes) || href || ''
        return href ? `[${label}](${href})` : label
      }
      if (tag === 'img') {
        const src = node.getAttribute('src') || ''
        const alt = node.getAttribute('alt') || 'image'
        return src ? `![${alt}](${src})` : ''
      }
      return inlineMarkdown(node.childNodes)
    })
    .join('')

const rowCellsMarkdown = (row: HTMLTableRowElement): string[] =>
  Array.from(row.cells).map((cell) => inlineMarkdown(cell.childNodes).replace(/\|/g, '\\|').trim())

const tableMarkdown = (table: HTMLTableElement): string => {
  const rows = Array.from(table.rows)
  if (!rows.length) return ''
  const header = rowCellsMarkdown(rows[0]!)
  const body = rows.slice(1).map(rowCellsMarkdown)
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

const blockMarkdown = (node: Element): string => {
  const tag = node.tagName.toLowerCase()

  if (node instanceof HTMLElement && node.dataset.mdBlock === 'raw') return visibleText(node)

  if (node instanceof HTMLElement && node.dataset.mdBlock === 'callout') {
    const type = node.dataset.calloutType || 'info'
    const title = markdownText(node.querySelector('[data-callout-title="true"]') ?? node)
    const body = node.querySelector('[data-callout-body="true"]')
    const bodyMarkdown = body ? childrenMarkdown(body).trim() : ''
    return ['```callout', `type: ${type}`, `title: ${title}`, '', bodyMarkdown, '```'].join('\n')
  }

  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineMarkdown(node.childNodes).trim()}`
  if (tag === 'p') return inlineMarkdown(node.childNodes).trim()
  if (tag === 'ul' || tag === 'ol') {
    return Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${inlineMarkdown(child.childNodes).trim()}`)
      .join('\n')
  }
  if (tag === 'table' && node instanceof HTMLTableElement) return tableMarkdown(node)
  if (tag === 'pre') return visibleText(node)
  if (tag === 'blockquote') {
    return visibleText(node)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
  }
  if (tag === 'div') {
    const blockChildren = Array.from(node.children).filter((child) => isBlockElement(child))
    return blockChildren.length ? childrenMarkdown(node) : inlineMarkdown(node.childNodes).trim()
  }

  return inlineMarkdown(node.childNodes).trim()
}

const isBlockElement = (element: Element): boolean =>
  /^(h[1-6]|p|ul|ol|table|pre|blockquote|div|aside)$/i.test(element.tagName)

const childrenMarkdown = (root: Element): string =>
  Array.from(root.childNodes)
    .map((child) => {
      if (child.nodeType === Node.TEXT_NODE) return (child.textContent ?? '').trim()
      return child instanceof Element ? blockMarkdown(child).trimEnd() : ''
    })
    .filter((block) => block.trim().length > 0)
    .join('\n\n')

const currentMarkdown = (): string => {
  const markdown = editor.value ? childrenMarkdown(editor.value).trimEnd() : ''
  return markdown ? `${markdown}\n` : ''
}

function renderFromMarkdown(markdown: string): void {
  if (!editor.value) return
  editor.value.innerHTML = markdownToEditableHtml(markdown)
}

function syncFromDom(): void {
  const markdown = currentMarkdown()
  lastEmitted = markdown
  emit('update:modelValue', markdown)
}

function ensureSelection(): void {
  const root = editor.value
  if (!root) return
  const selection = window.getSelection()
  if (selection?.rangeCount && root.contains(selection.anchorNode)) return
  root.focus()
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function runCommand(command: string, value?: string): void {
  ensureSelection()
  document.execCommand(command, false, value)
  syncFromDom()
}

function insertHtml(html: string): void {
  ensureSelection()
  document.execCommand('insertHTML', false, html)
  syncFromDom()
}

function formatBlock(tag: 'p' | 'h1' | 'h2' | 'h3'): void {
  runCommand('formatBlock', tag.toUpperCase())
}

function createLink(): void {
  ensureSelection()
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) {
    insertHtml(`<a href="https://">link</a>`)
    return
  }
  const href = window.prompt('Link URL', 'https://')
  if (!href) return
  runCommand('createLink', href)
}

function inlineCode(): void {
  ensureSelection()
  const selection = window.getSelection()
  const selected = selection?.toString() || 'code'
  insertHtml(`<code>${escapeHtml(selected)}</code>`)
}

function insertTable(): void {
  insertHtml('<table><thead><tr><th>Column</th><th>Value</th></tr></thead><tbody><tr><td></td><td></td></tr></tbody></table><p><br></p>')
}

function insertCallout(): void {
  insertHtml(calloutHtml('type: info\ntitle: Note\n\nCallout text') + '<p><br></p>')
}

const imageFiles = (files: FileList | readonly File[] | null | undefined): File[] =>
  Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))

const clipboardImageFiles = (data: DataTransfer | null): File[] =>
  Array.from(data?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file && file.type.startsWith('image/')))

function insertImage(url: string, alt: string): void {
  insertHtml(`<p><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" /></p><p><br></p>`)
}

async function uploadImages(files: File[]): Promise<void> {
  if (!files.length) return
  uploadError.value = null
  uploading.value = true
  try {
    for (const file of files) {
      const asset = await Api.uploadAsset(file)
      insertImage(asset.url, asset.filename.replace(/\.[^.]+$/, '') || 'image')
    }
  } catch (e) {
    uploadError.value = (e as Error).message
  } finally {
    uploading.value = false
  }
}

async function onImageInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await uploadImages(imageFiles(input.files))
  input.value = ''
}

function onPaste(event: ClipboardEvent): void {
  const files = clipboardImageFiles(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  void uploadImages(files)
}

function onDrop(event: DragEvent): void {
  const files = imageFiles(event.dataTransfer?.files)
  if (!files.length) return
  event.preventDefault()
  void uploadImages(files)
}

function insertAsset(markdown: string): void {
  insertHtml(markdownToEditableHtml(markdown))
  showAssets.value = false
}

onMounted(() => {
  renderFromMarkdown(props.modelValue)
})

watch(
  () => props.modelValue,
  async (value) => {
    if (value === lastEmitted || value === currentMarkdown()) return
    await nextTick()
    renderFromMarkdown(value)
  },
)
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-ghost" type="button" title="Paragraph" @mousedown.prevent @click="formatBlock('p')">P</button>
      <button class="btn-ghost" type="button" title="Heading 1" @mousedown.prevent @click="formatBlock('h1')">H1</button>
      <button class="btn-ghost" type="button" title="Heading 2" @mousedown.prevent @click="formatBlock('h2')">H2</button>
      <button class="btn-ghost" type="button" title="Heading 3" @mousedown.prevent @click="formatBlock('h3')">H3</button>
      <button class="btn-ghost" type="button" title="Bold" @mousedown.prevent @click="runCommand('bold')">B</button>
      <button class="btn-ghost" type="button" title="Italic" @mousedown.prevent @click="runCommand('italic')">I</button>
      <button class="btn-ghost" type="button" title="Inline code" @mousedown.prevent @click="inlineCode">Code</button>
      <button class="btn-ghost" type="button" title="Link" @mousedown.prevent @click="createLink">Link</button>
      <button class="btn-ghost" type="button" title="Bulleted list" @mousedown.prevent @click="runCommand('insertUnorderedList')">List</button>
      <button class="btn-ghost" type="button" title="Numbered list" @mousedown.prevent @click="runCommand('insertOrderedList')">1.</button>
      <button class="btn-ghost" type="button" title="Table" @mousedown.prevent @click="insertTable">Table</button>
      <button class="btn-ghost" type="button" title="Callout" @mousedown.prevent @click="insertCallout">Callout</button>
      <button class="btn-ghost" type="button" title="Upload image" :disabled="uploading" @mousedown.prevent @click="uploadInput?.click()">
        {{ uploading ? 'Uploading...' : 'Image' }}
      </button>
      <button class="btn-ghost" type="button" title="Browse assets" @mousedown.prevent @click="showAssets = true">
        Assets
      </button>
      <input ref="uploadInput" class="hidden" type="file" accept="image/*" multiple @change="onImageInput" />
    </div>
    <p v-if="uploadError" class="text-sm text-red-600">{{ uploadError }}</p>
    <div
      ref="editor"
      class="visual-editor prose dark:prose-invert max-w-none min-h-[60vh] rounded-lg border border-gray-200 bg-white p-5 outline-none dark:border-gray-800 dark:bg-gray-900"
      contenteditable="true"
      spellcheck="true"
      @input="syncFromDom"
      @paste="onPaste"
      @drop="onDrop"
    ></div>
    <AssetPicker :open="showAssets" @close="showAssets = false" @insert="insertAsset" />
  </div>
</template>
