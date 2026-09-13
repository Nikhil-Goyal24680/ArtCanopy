# Dark mode — parked for future work

**Status (2026-09-13):** A full dark-mode pass was built and verified for all 8
category themes plus the homepage, then **deliberately reverted** — light mode
looked noticeably better across the board, and doing dark mode justice needs
more design iteration than one pass allows. The site now ignores
`prefers-color-scheme` entirely and always renders its light appearance. This
doc captures what was learned so a future pass doesn't have to re-derive it.

## Architecture that worked

For each theme, dark values were generated with a **hue-preserving lightness
flip**, not a naive invert:

- `--paper`/`--paper-alt` (or a theme's equivalent, e.g. theme-22's `--canvas`)
  → same hue, lightness forced down to roughly L 0.10–0.13, saturation
  roughly halved (`darkenPaper()` helper: convert hex → HSL, force L, scale S).
- Text colors (`--ink`, `--ink-soft`, and each theme's heading/kicker/price
  accent) → same hue, lightness searched **upward** from the color's own
  starting point until contrast against the **lighter of the two dark
  backgrounds** (`--paper-alt`, since it's stricter than `--paper`) cleared
  4.5:1 (WCAG AA). Verified with an actual relative-luminance contrast
  calculation (sRGB → linear → luminance → contrast ratio), not eyeballed.
- Button backgrounds paired with white text (`.btn-whatsapp`, `.btn-primary`,
  tag chips) were generally **left unchanged** — their contrast requirement
  (white text vs. that fixed color) doesn't depend on page background, so
  they don't need a dark variant at all.

## Three gotchas worth knowing before redoing this

### 1. Dual-role colors need a `--text-X` split

Several themes reuse the *same* CSS variable both as a text color sitting on
`--paper` (needs to brighten in dark mode) **and** as a fixed button/tag
background paired with white text (must *not* change, or that button's own
contrast breaks). Example: theme-24's `--ocean-dark` is both
`h1,h2,h3{color}` (text role) and a `.btn-primary` gradient stop (background
role).

Fix pattern used: introduce a new `--text-<name>` token that defaults to
`var(--<name>)` in light mode, gets its own brightened value in the dark
media query, and only the *text* call sites get switched to reference it.
The background call sites keep using the original variable untouched.

Themes that needed this split: 18 (`--text-coral`), 20 (`--text-maroon`,
`--text-maroon-dark`), 22 (`--ink-fixed` — inverse direction, see below),
24 (`--text-ocean`, `--text-ocean-dark`), 29 (`--text-terracotta`).

### 2. `category-nav.css` has a shared `.product-search` rule keyed to `--paper`/`--ink`

`css/category-nav.css` (loaded on every page, after the theme's own CSS)
defines its own `.product-search { background: var(--paper); color:
var(--ink); }` — a "shared search box" component. Because it loads *after*
the theme file and has equal specificity, **it always wins the cascade** for
that element, regardless of what the theme's own `.product-search` rule says.

This is harmless for 7 of 8 themes, which use `--paper`/`--ink` as their real,
only surface/text tokens (so the shared rule already resolves correctly once
those are dark-overridden). Theme-22 (Painting/Sketch) was the exception: it
uses its own `--canvas`/`--canvas-light`/`--canvas-dark` as the *real* surface
tokens internally, leaving `--paper` as a vestigial, never-updated duplicate
— so the shared search box silently stayed light no matter what `--canvas`
was set to. Cost real debugging time (chased it as a Chrome
form-control/caching bug before finding the actual cause).

**Lesson for next time:** any theme with its own internal alias for
"paper"/"ink" must *also* dark-override the literal `--paper`/`--ink`
variables, even if nothing in the theme's own CSS reads them, because
`category-nav.css`'s shared rule does.

### 3. Theme-22's `--ink` is *also* a fixed background (the inverse problem)

Theme-22 uniquely uses `--ink` as a **background** color too (`.btn-dark`,
`.paint-strip`, `.product-tags .tag`, `.site-footer` all use
`background: var(--ink)` with white text on top). Brightening `--ink` for
dark-mode text readability would have broken all four of those.

Fix used: `--ink-fixed: #1d1d1b` (a new, permanently-dark token) took over the
4 background call sites; `--ink` itself became the mode-adjustable text-role
variable (matching the convention every other theme already follows), which
also happens to be what fixes gotcha #2 above for this theme.

### 4. Hardcoded decorative gradients don't adapt on their own

Theme-26 (Mirror)'s hero has a soft "glass reflection" radial-gradient wash
sitting directly behind the h1 (`rgba(228,239,243,0.6)` at 50%/30%, i.e.
right where the text is). It's a light, translucent wash tuned for a light
background. Once the page around it went dark, that same wash created a
bright patch that nearly erased the (correctly-computed, AA-passing-in-
isolation) heading text — contrast math against the flat background doesn't
account for decorative overlays sitting on top of it in the same spot.

Fix used: pulled that one gradient stop into a `--hero-center-glow` variable,
dropped its dark-mode opacity from 0.6 to 0.08. The two corner glows (not
behind any text) were left alone.

**Lesson for next time:** after computing "safe" text/background pairs,
still screenshot every hero — decorative overlays are invisible to a contrast
calculator.

## Per-theme dark palette reference

All values below passed a real contrast check (≥4.5:1) against
`--paper-alt` at the time they were computed. `--border` and purely
decorative fills were left unchanged (no text sits on them).

### Homepage (`css/style.css`) — already had a dark block pre-existing this project; values below are what it was updated to during the "All Pieces" redesign
```
--ink: #ede6d9;       --ink-soft: #aebab3;
--paper: #14201d;     --paper-alt: #1b2b26;
--teal: #4fa88f;      --teal-dark: #2f6b5c;
--gold: #d9a83f;      --gold-dark: #d9a83f;
--accent: #d4352e;    --accent-dark: #e2604f;
--whatsapp: #21864b;  --whatsapp-dark: #1d8748;
--border: #33443d;
```

### Theme 17 — Lippan (`theme-17-lippan-mudwork.css`)
Hero has a fixed solid `--terracotta` background (not paper-derived) — its
own text (`--mud`) never needed a dark variant.
```
--ink: #bb7f5c;          --ink-soft: #aa8769;
--paper: #231d10;        --paper-alt: #2b2517;
--card-bg: #2b2517;      (new token; .product-card used --mud, which is
                          also the hero's fixed text color, so needed its
                          own switchable copy)
--terracotta-dark: #d36650;  (headings/price text role only; its
                              decorative/border uses were untouched)
```

### Theme 18 — Mosaic (`theme-18-mosaic-fragments.css`)
```
--ink: #8e8b88;          --ink-soft: #948e84;
--paper: #211c12;        --paper-alt: #292519;
--text-coral: #d86d57;   (--coral itself, used as price-tag bg, unchanged)
--card-bg: #292519;      (new token; .product-card/.product-search were
                          hardcoded #fff)
--grout: #706a5e;        (border color — was near-black #2b2b2b, invisible
                          against a dark card; lightened for visibility)
```

### Theme 20 — Festival Special / Diya & Rangoli (`theme-20-diya-rangoli.css`)
Hero has a fixed solid `--maroon` background — only body-section colors
needed dark variants.
```
--ink: #ce708e;              --ink-soft: #ae838b;
--paper: #251a0e;            --paper-alt: #2e2415;
--text-maroon-dark: #ce708e; (headings text role; --maroon-dark's button-
                              text and decorative-bg uses unchanged)
--text-maroon: #db6882;      (price/footer-hover text role; --maroon's
                              button/tag-bg uses unchanged)
.hero h1 color was hardcoded to #fdf6ee instead of var(--paper), since the
hero's own bg is fixed and never needed to track the page's mode.
```

### Theme 22 — Painting/Sketch (`theme-22-painting-art.css`)
The one with the `--canvas` vs `--paper` split (see gotcha #2) and the
inverse `--ink` background problem (gotcha #3).
```
--canvas: #1f1b14;       --canvas-light: #2a2518;   --canvas-dark: #15130e;
--paper: #1f1b14;        (kept in sync with --canvas — only exists for
                          category-nav.css's shared search-box rule)
--ink: #8e8e85;          --ink-soft: #928f88;
--ink-fixed: #1d1d1b;    (new, permanent — takes over the 4 background
                          call sites .btn-dark/.paint-strip/tag-chip/footer)
--text-terracotta: #d96e49;      (--terracotta's own button/motif uses unchanged)
--text-studio-green: #5e988b;    (--studio-green's own cta-bg/button uses unchanged)
color-scheme: light dark; was added to :root (harmless to keep either way)
```

### Theme 24 — Resin Art (`theme-24-liquid-resin.css`)
```
--ink: #4093ba;          --ink-soft: #70909f;
--paper: #121c21;        --paper-alt: #1a2428;
--text-ocean: #1596be;          (--ocean's tile-strip/gradient uses unchanged)
--text-ocean-dark: #1396c1;     (--ocean-dark's btn-primary gradient/tag-bg uses unchanged)
```

### Theme 26 — Mirror (`theme-26-prism-reflection.css`)
```
--ink: #9b848a;          --ink-soft: #9a878a;
--paper: #201c13;        --paper-alt: #28231a;
--hero-center-glow: rgba(228, 239, 243, 0.08);   (was 0.6 — see gotcha #4)
--gold-leaf needed no change (already ~6.9:1 against dark paper-alt as-is).
--ink also backs .btn-primary/.theme-tag (paired with --paper as their
text) — brightening --ink flips that pairing's visual weight, but contrast
stays well over 4.5:1 either way since it's the same two colors swapped.
```

### Theme 29 — Home Decor (`theme-29-heritage-decor.css`)
```
--ink: #ba7f6a;          --ink-soft: #a6887d;
--paper: #241e0f;        --paper-alt: #2b2517;
--text-terracotta: #db6b5b;   (--terracotta's tag-bg/button uses unchanged)
--brass-gold, --mango-leaf needed no change (no text role).
```

### Theme 31 — Gift (`theme-31-wrapped-gift-story.css`)
```
--ink: #a08287;          --ink-soft: #998688;
--paper: #25160e;        --paper-alt: #2c1e16;
--ribbon-dark: #ca6f6a;  (safe to override directly — no background role)
--card-bg: #2c1e16;      (new token; .product-card/.product-search were
                          hardcoded #fff)
--ribbon, --sage, --gold needed no change (button/tag-bg/decorative only).
```

## What to check first, next time

1. Re-derive with the same `darkenPaper()`/`adjustForContrast()` approach
   (hue-preserving, contrast-verified) rather than starting over.
2. For every theme, grep whether `--paper`/`--ink` are the *real* surface/text
   tokens or just aliases — if aliased (like theme-22), the literal
   `--paper`/`--ink` still need dark values because of `category-nav.css`'s
   shared search-box rule.
3. Grep every accent color for dual role (`color:` *and* `background:` on the
   same variable) before assuming it's safe to brighten directly.
4. Screenshot every hero specifically, not just body copy — decorative
   gradient washes sitting behind text are the easiest thing to miss.
5. Consider whether dark mode should get its *own* creative pass per theme
   (different accent emphasis, maybe different decorative treatment) rather
   than a mechanical palette flip — that's likely why light mode reads as
   more "designed" right now.
