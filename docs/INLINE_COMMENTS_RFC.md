<!-- i18n: language-switcher -->
[English](INLINE_COMMENTS_RFC.md) | [日本語](INLINE_COMMENTS_RFC.ja.md)

# Inline Anchored Comments RFC

Status: go for block/heading anchored comments; defer arbitrary text ranges.

Related issue: #258.

## Problem

Page-level comments are useful for discussion, but reviewers often need to point
at a specific heading, list item, paragraph, or embedded block. A full Google
Docs style range-comment system is expensive because Markdown edits constantly
shift offsets and can invalidate selections.

## Decision

Start with anchored block comments:

- Anchor to a stable block id derived from a heading slug, fenced-block id, or
  generated paragraph/list-item hash.
- Store the page path, anchor id, optional quote preview, and normal comment
  thread id.
- Render anchors in the reader and editor preview as small comment affordances.
- Fall back to page-level comments when the anchor cannot be resolved after an
  edit.

Do not implement arbitrary character-range selection in the first version. It is
the highest-risk part of the feature and can be added later behind the same
thread model.

## Data Model Sketch

Add a table next to `page_comments`:

```sql
CREATE TABLE page_comment_anchors (
  comment_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  path TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX page_comment_anchors_page_idx ON page_comment_anchors(page_id);
CREATE INDEX page_comment_anchors_anchor_idx ON page_comment_anchors(path, anchor_id);
```

The existing comment body, author, resolved state, and mention handling should
stay in `page_comments`.

## Anchor Generation

- Headings: use existing slugified heading ids from the Markdown renderer.
- Fences: prefer an explicit `id:` field when present; otherwise hash the fence
  type plus normalized body.
- Paragraphs/list items: hash normalized text with a short prefix such as
  `p-4f8a21`.
- On render, if multiple blocks collide, append an occurrence suffix.

## UI Landing Zone

- Reader: show a comment marker at the right edge of eligible blocks.
- Editor preview: show the same markers in preview/visual surfaces.
- Comments panel: group by anchor first, then by unresolved/resolved state.
- Empty anchor state: if the block disappeared, show the quote and a "page-level
  fallback" label rather than hiding the thread.

## Go/No-Go

Go for the block/heading version because it fits the current Markdown canonical
model and reuses the existing comment service. No-go for arbitrary ranges until
the editor has a proven stable mapping between Markdown source positions and
rendered preview nodes.
