# llmwiki Design Tokens

> Authority: `runs/run_20260521_093931_p5_sw_llmwiki_slice2/agreed_contract.json#design_tokens`.
> This document is the single source of truth for visual tokens consumed by
> `src/lib/components/DisclosureBanner.svelte`, `src/lib/components/UploadZone.svelte`,
> and `src/lib/components/AuthStateIndicator.svelte`. The runtime values are mirrored
> as CSS custom properties in `src/lib/tokens.css`.

The tokens below are chosen as **positive substitutions** for common AI-default
scaffold patterns (neutral-50 → indigo accent, Inter-as-both, linear 8/16/24/32
ladder, default `ease`, uniform 8px radius, soft drop-shadow, indigo focus ring).
Originality is enforced by these positive values, not by negative avoidance
clauses.

## Color palette (ten named tokens)

| Token              | Hex       | Use                                                                                      |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `surface-base`     | `#F4EFE6` | App background. Warm ivory.                                                              |
| `surface-elevated` | `#FBF7EE` | DisclosureBanner background, UploadZone idle background.                                 |
| `surface-sunken`   | `#E8E1D2` | UploadZone drop target inner area; AuthStateIndicator base track.                        |
| `text-primary`     | `#211C16` | Body and heading text. Warm near-black.                                                  |
| `text-secondary`   | `#5A5247` | Subordinate text, captions, "Why this banner" expansion body.                            |
| `accent-oxblood`   | `#7A2B26` | DisclosureBanner left rule, primary CTA fill, UploadZone success border.                 |
| `warn-amber`       | `#B86E1E` | UploadZone rejecting border, AuthStateIndicator `degraded` state stroke.                 |
| `success-moss`     | `#3F5E3A` | AuthStateIndicator `oauth-child-up` state, UploadZone success icon.                      |
| `danger-rust`      | `#8B3A1F` | DisclosureBanner key-phrase emphasis on "password-equivalent" wording. Not used elsewhere.|
| `border-subtle`    | `#CFC4AE` | Default border on cards, UploadZone idle border (solid 1px).                             |

### Forbidden color patterns

- `neutral-50 #FAFAFA → neutral-900 #0A0A0A` Tailwind/AI-default ramp.
- `indigo #6366F1` as accent or CTA fill.
- `emerald #10B981` as success color.
- `amber #F59E0B` (high-saturation) as warning color.
- Pure white `#FFFFFF` as surface.

## Typography pair

- **Heading family:** `"Söhne Breit", "Inter Tight", system-ui, sans-serif`.
  Heading sizes use the heading family exclusively. When Söhne is not licensed
  for distribution, the fallback chain renders Inter Tight in heavy weights —
  explicitly **not** the same family as the body.
- **Body family:** `"IBM Plex Serif", Georgia, "Times New Roman", serif`. Body,
  paragraph, list, and form-control labels use the body family.
- **Forbidden pattern:** using `"Inter"` (regular) as both heading and body —
  this is the canonical AI-default scaffold.

## Spacing ladder (Fibonacci-shaped)

| Token       | Value | Use                                                            |
| ----------- | ----- | -------------------------------------------------------------- |
| `space-xs`  | `3px` | Icon-to-text inner gap.                                        |
| `space-sm`  | `7px` | Tight stack (e.g. inside chip-style components).               |
| `space-md`  | `13px`| Default vertical rhythm between paragraph lines and form rows. |
| `space-lg`  | `21px`| Section internal padding.                                      |
| `space-xl`  | `34px`| Component-to-component separation.                             |
| `space-2xl` | `55px`| Major-section vertical separation.                             |

Progression is Fibonacci-shaped (3, 7, 13, 21, 34, 55), explicitly avoiding the
AI-default `8/16/24/32` linear stack and the Tailwind-default `0.25rem` step.

### Forbidden spacing patterns

- `8px / 16px / 24px / 32px / 48px / 64px` linear stack.
- Tailwind `0.25rem` step (`1`, `2`, `3`, `4`, ...).
- Any 4px-multiple-only ladder.

## Easing and motion

- **Named curve:** `ease-deliberate = cubic-bezier(0.22, 1.06, 0.36, 1.0)`.
- **Applied to:** every hover, focus, active, and state-change transition on
  `DisclosureBanner.svelte`, `UploadZone.svelte`, and `AuthStateIndicator.svelte`.
- **Duration tokens:**

  | Token         | Value   | Use                                                      |
  | ------------- | ------- | -------------------------------------------------------- |
  | `motion-fast` | `140ms` | Hover/focus micro-interactions; tooltip reveal.          |
  | `motion-base` | `220ms` | Default state-change transition (banner expand, etc.).   |
  | `motion-slow` | `360ms` | Layout shifts spanning multiple stacked elements only.   |

### Forbidden easing values

- `ease`
- `ease-in-out`
- `ease-out`
- `linear` (forbidden for state-change transitions; reads as default at small durations)

## Radius scale (non-uniform)

| Token               | Value              | Use                                                                              |
| ------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `radius-tight`      | `2px`              | Form controls, tooltips.                                                         |
| `radius-soft`       | `6px`              | Cards, banner body.                                                              |
| `radius-pill`       | `999px`            | DisclosureBanner acknowledgment primary CTA (pill shape).                        |
| `radius-asymmetric` | `2px 12px 2px 12px`| UploadZone drop target. Asymmetric, differentiates the upload affordance.        |

### Forbidden radius patterns

- Uniform `8px` applied to every surface (AI-default scaffold).
- Uniform `border-radius: 0.5rem` Tailwind default.
- Fully rounded squares (`9999px`) on rectangular CTAs.

## Shadow

| Token             | Value                                          | Use                                                              |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `shadow-hairline` | `0 0 0 1px rgba(33, 28, 22, 0.06)`             | Default card outline (a hairline instead of a soft drop-shadow). |
| `shadow-press`    | `inset 0 1px 0 rgba(33, 28, 22, 0.08)`         | Pressed-state CTA, AuthStateIndicator `unconfigured` track.      |

### Forbidden shadow patterns

- `0 4px 12px rgba(0, 0, 0, 0.1)` and similar soft drop shadows (AI-default
  "card lift").
- Multiple layered drop shadows (Material Design elevation `0` → `24`).
- Outer-glow shadows.

## Focus ring

- **Style:** 2px outset solid `accent-oxblood` (`#7A2B26`) at 40% alpha, with a
  2px gap between the element edge and the ring. Total visual extent: 4px
  outside the element.
- **Token name:** `focus-ring`.
- **Applied to:** every interactive control on the three named components
  uniformly (CTA, UploadZone drop target, AuthStateIndicator interactive
  surface, inputs, links).

### Forbidden focus-ring patterns

- Browser-default `outline: auto` (the dotted blue/grey ring).
- `2px solid #6366F1` indigo ring (AI-default).
- `outline: none` with no replacement (a11y violation).

## Token-to-component application

| Component            | Background         | Border / state cue                                                  | Accent                                                          | Shape                       |
| -------------------- | ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------- |
| DisclosureBanner     | `surface-elevated` | 1px `border-subtle` + 4px left rule `accent-oxblood`                | `accent-oxblood` CTA fill; `danger-rust` emphasis on row 3      | `radius-soft` body, `radius-pill` CTA |
| UploadZone           | `surface-sunken`   | per state (see five-state table below)                              | `accent-oxblood` (drag-over/accepting), `warn-amber` (rejecting), `success-moss` (success) | `radius-asymmetric` |
| AuthStateIndicator   | `surface-base`     | shape-keyed (see five-state table below)                            | per-state stroke color (see five-state table)                   | shape-keyed                 |

### UploadZone five-state cues (shape + color + icon + text)

| State       | Border style                                                                | Icon                      | Text tone        |
| ----------- | --------------------------------------------------------------------------- | ------------------------- | ---------------- |
| `idle`      | 1px solid `border-subtle`                                                   | neutral upload glyph      | `text-secondary` |
| `drag-over` | 2px solid `accent-oxblood`, background `surface-elevated`, icon +6% scale   | upload glyph (+6%)        | `text-primary`   |
| `accepting` | 2px solid `accent-oxblood`, top hairline progress bar `accent-oxblood`      | paper-with-arrow          | `text-primary`   |
| `rejecting` | Diagonal-stripe `warn-amber + surface-sunken`, 8px pitch repeating-gradient | hex no-entry outline (`warn-amber`) | reason text `text-primary` body |
| `success`   | 1px solid `success-moss`                                                    | checkmark-in-square       | `text-primary`   |

Rejection signal is **triple** (shape + icon + text); color is the third signal,
never the first.

### AuthStateIndicator five-state cues (shape primary, color tertiary)

| State                 | Shape                | Icon                            | Stroke color     |
| --------------------- | -------------------- | ------------------------------- | ---------------- |
| `unconfigured`        | empty square outline | minus sign                      | `text-secondary` |
| `codex-detected`      | filled square        | dot                             | `text-primary`   |
| `oauth-child-up`      | filled circle        | upward triangle                 | `success-moss`   |
| `degraded`            | half-filled diamond  | exclamation-in-triangle         | `warn-amber`     |
| `dev-fallback-active` | hollow triangle      | gear                            | `text-secondary` |

The five shapes are mutually distinguishable in monochrome (empty square /
filled square / filled circle / half-filled diamond / hollow triangle).

## Authority and stability

- Renames of the three component files require contract refresh.
- Slice 2 commits these tokens. Subsequent slices may **extend** the token set
  but must not silently **mutate** existing token values without contract refresh.
