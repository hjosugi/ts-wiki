# Kawaii Wiki Design RFC

Status: accepted baseline for the `kawaii-wiki.ts` product direction.

Related issue: #262.

## Intent

ts-wiki should feel less like a corporate docs clone and more like a personal,
pop-culture, game-wiki friendly publishing tool. The direction is expressive,
but still practical: dense wiki reading, fast editing, and accessible controls
remain more important than decorative novelty.

This RFC does not rename packages or the repository. The full rebrand is tracked
separately in #261 because it needs owner-controlled GitHub, package, container,
and compatibility decisions.

## Design Principles

- Keep pages inspectable: page title, icon, cover, status, path, labels, and key
  actions must stay visible without hunting.
- Make customization local and reversible: presets, fonts, backgrounds, icons,
  covers, and landing blocks should be admin/page settings, not hardcoded forks.
- Use expressive surfaces where they carry content: hero covers, profile cards,
  stream embeds, link cards, and landing widgets should show real wiki material.
- Avoid noisy one-off decoration in work views: admin panels, editors, history,
  and ACL screens stay compact and task-oriented.
- Preserve accessibility: color contrast, reduced motion, keyboard reachability,
  focus states, and semantic dialogs remain release gates.

## Baseline Tokens

The default remains `classic`; kawaii/pop/game looks are presets, not mandatory.

- `classic`: neutral wiki baseline for compatibility.
- `kawaii`: soft accents, rounded-friendly typography, gentle surfaces.
- `pop`: brighter accents and higher energy landing/profile presentation.
- `gamer`: high-contrast neon accents for game/wiki communities.
- `minimal`: quiet neutral mode for operational documentation.
- `custom`: custom CSS escape hatch for teams with their own brand.

Font family settings should map to intent rather than raw CSS names: system,
rounded, maru, Japanese sans, and serif.

## Component Direction

- Page header: icon + cover support, compact metadata, export/share/history/edit
  actions, and a lightweight insights panel.
- Landing blocks: Markdown fences for `hero`, `pages`, `recent`, and `popular`
  are the preferred way to assemble a themed front page.
- Cards: used for repeated content such as page lists, recent activity, profile
  blocks, link previews, and media embeds. Do not wrap whole page sections in
  decorative cards.
- Editor: visual-first can be the default for non-engineers, but Markdown stays
  canonical and recoverable.
- Admin: keep utilitarian density; expose safe customization controls without
  turning admin into a marketing page builder.

## Already Landed

- Theme presets, font families, backgrounds, and admin appearance controls.
- Per-page icons and covers with export/import/git preservation.
- Landing-page widgets for hero, page collections, recent pages, and popular
  pages.
- Reduced-motion-aware micro-interactions.
- VTuber/wiki starter templates and media/link-card fences.
- Page insights and daily-note shortcuts in the command palette.

## Next Steps

- Treat #261 as a separate compatibility/release project.
- Add richer default preset screenshots once visual regression assets exist.
- Add reusable color swatches for custom preset editing only when admin demand
  appears; avoid building a general design editor prematurely.
