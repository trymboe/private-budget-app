# Design direction

**Calm and editorial.** A budgeting app is opened when money feels tight, so it
should feel like a well-set page, not a trading terminal: warm paper, ink-dark type,
generous space, one accent colour, and numbers that are exact but never shouted.

## Principles

1. **One answer per screen.** Home answers "how am I doing this month?" in one
   sentence and one bar before anything else.
2. **Thumb first.** Phone layout is the design; desktop adds a side nav and wider
   columns. Primary actions sit in the lower half; tap targets are 44 px or more.
3. **Honest numbers.** Missing data is never shown as low spending. Partial months,
   pending items, uncategorised and foreign-currency amounts carry a quiet note
   (an info icon and one plain sentence).
4. **No red alarms.** Over budget uses a muted orange (`--over`), with words ("over
   by 1 200 kr"), never colour alone.
5. **Stable layouts.** The category grid in review never reorders, so it can be
   learned; suggestions appear above it instead.
6. **Every action reversible.** Review decisions show an Undo toast; destructive
   actions (merge, disconnect) confirm first.

## Type

- Display: Instrument Serif for page titles and the review merchant name.
- Text and UI: Geist. Numbers use tabular figures (`.tnum`).
- Scale is set in `globals.css`; small caps-style eyebrows (`.eyebrow`) label
  sections.

## Colour tokens

Defined once in `src/app/globals.css` as CSS variables, with dark mode values under
`prefers-color-scheme: dark`.

| Token | Light | Use |
| --- | --- | --- |
| `--paper` | `#f4f1ea` | page background |
| `--surface` / `--sunken` | | cards, inputs / wells, hovered rows |
| `--ink`, `--ink-2`, `--ink-3` | `#1b1a17` … | text, secondary, muted |
| `--line`, `--line-strong` | | hairlines and borders |
| `--accent` | `#2c5a4c` | the one action colour (suggestion, links, progress) |
| `--ochre` | | reminders (consent renewal), "approaching" |
| `--brick` | | errors only |
| `--under` / `--over` | `#1f6e93` / `#b4562f` | chart diverging pair: under / over budget |
| `--cat-*` | 10 muted hues | category identity (icon tint), never meaning |

Text always uses ink tokens; category colours only tint the icon tile beside it.

## Charts

Recharts, styled with the same tokens.
- **Budget vs actual** per finished month: diverging bars from zero, blue under,
  orange over, with a grey neutral axis. Blue/orange was chosen because it survives
  the common colour-vision deficiencies: validated at a CVD ΔE of 14.8 on the light
  surface and 16.4 on the dark one (target ≥ 8).
- **Pace**: cumulative spending this month vs last month, two lines with a legend,
  and this month's budget as a dashed reference line.
- **Category trends**: one category at a time, picked from a row of chips, with
  the month's budget as a dashed step line and the average of complete months.
- **Cash flow** (money in vs out per month) is a table, kept apart from budget
  variance because transfers to savings and fixed costs dominate it.
- One y-axis per chart, hover tooltips, a table with the same numbers under the
  variance chart, and incomplete months drawn faded with a dashed outline and
  labelled "incomplete".

## Motion

Short (150–250 ms), ease-out: review cards slide out and in, bars grow once on
load. All of it is turned off under `prefers-reduced-motion`.

## Name and mark

"Måte" is Norwegian for way or measure, as in "med måte": in moderation. It is set
in one place (`src/lib/brand.ts`). The mark is a lowercase å in paper colour on
the accent green, drawn as strokes so it stays legible at 16 px. The same shape
lives in `src/app/icon.svg` (browser tab), `src/components/logo.tsx` (in the app,
following light and dark mode) and the PNG icons for the home screen.
