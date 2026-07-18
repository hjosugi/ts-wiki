<!-- i18n: language-switcher -->
[English](LIVE_PREVIEW_EDITOR_SPIKE.md) | [日本語](LIVE_PREVIEW_EDITOR_SPIKE.ja.md)

# Live Preview Editor Spike

Status: viable as an optional editor mode; do not replace Markdown or visual
editing.

Related issue: #260.

## Goal

Explore a SilverBullet-style editing mode where Markdown source remains editable
but common syntax is rendered inline. The target user can write Markdown without
constantly switching between Write and Preview, while still being able to see and
fix the source text.

## Current Editor Baseline

- Markdown source is canonical.
- CodeMirror 6 powers the Markdown editor.
- Visual mode exists for non-engineers and round-trips common blocks.
- Collaborative autosave currently depends on Markdown text, not rendered DOM.

## Viable Approach

Add a third editor mode later: `Live`.

- Use CodeMirror 6 decorations, not a separate contenteditable renderer.
- Hide or style syntax markers for headings, emphasis, links, and task lists.
- Render block widgets for callouts, embeds, events, and image previews only
  when the block is not actively selected.
- Keep source text fully recoverable with keyboard navigation and copy/paste.
- Reuse the existing Markdown renderer for previews where possible, but avoid
  injecting arbitrary rendered HTML into the editable document.

## Non-Goals

- Replacing visual mode.
- Replacing the Markdown editor.
- Implementing a complete WYSIWYG engine.
- Supporting every Markdown extension in the first prototype.

## Prototype Scope

1. Add an internal-only CodeMirror extension for headings, bold/italic, links,
   task checkboxes, and images.
2. Add read-only block widgets for existing fenced blocks.
3. Measure typing latency on large pages before exposing the mode.
4. Add a user preference only after the prototype handles source selection,
   undo/redo, paste, IME input, and mobile typing.

## Decision

Proceed later as a contained CodeMirror decoration prototype. The current
visual-first default is the right non-engineer path today; live preview is a
power-user writing mode, not the main editing architecture.
