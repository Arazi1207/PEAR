# DESIGN.md — PEAR Virtual Try-On UI/UX Architecture

> **Scope:** Frontend interface only — the PEAR fitting-room application (`/pear-demo/`) and the MERIDIAN storefront (`/index.html`). Backend API specifications are excluded, except where the UI consumes the WebRTC/VTON video stream.

---

## Table of Contents

1. [Design System & Aesthetics](#1-design-system--aesthetics)
2. [Component Layout Architecture](#2-component-layout-architecture)
3. [Cross-Device Responsiveness Strategy](#3-cross-device-responsiveness-strategy)
4. [UI State Management & Interaction Flow](#4-ui-state-management--interaction-flow)

---

## 1. Design System & Aesthetics

### 1.1 Aesthetic Philosophy — Premium Minimalist Black & White

The PEAR fitting-room interface (`pear-demo/`) operates under a strict **monochrome premium minimalism** aesthetic. Every visual decision reinforces the primary goal: make the clothing — not the chrome — the subject. The interface recedes; the garment leads.

**Core Principles:**

| Principle | Implementation |
|-----------|----------------|
| **Recede, don't compete** | Interface chrome is white, never colored. Only the garment carries visual weight. |
| **High contrast, low noise** | Black text on white, black borders, no mid-tone color blocks. |
| **Spatial honesty** | Generous whitespace instead of dense UI. Every element breathes. |
| **Surgical typography** | Weight and size hierarchy communicate importance; color does not. |
| **Tactile materiality** | Thin hairline borders (1px) simulate physical paper/card separation. |

The MERIDIAN storefront (`/index.html`) uses a complementary **Royal Blue Premium** palette for brand CTAs, hero sections, and navigation. The two palettes never bleed into each other — the monochrome PEAR app is always a visually distinct modal/page context.

---

### 1.2 Color Variables

#### PEAR Demo — Monochrome System (`pear-demo/style.css`)

```css
:root {
  /* Surface */
  --bg:         #ffffff;    /* dominant white — all panels, cards */
  --bg-soft:    #f7f7f8;    /* faint off-white for nested surfaces */
  --bg-soft-2:  #fafafa;    /* subtlest fill layer */

  /* Ink */
  --ink:        #000000;    /* pure black — headings, icon strokes, strong borders */
  --text:       #111111;    /* near-black — primary body text */
  --muted:      #6b7280;    /* mid-gray — secondary labels, captions */
  --muted-2:    #9ca3af;    /* light gray — placeholder, tertiary text */

  /* Borders */
  --line:       #e5e7eb;    /* hairline — card edges, dividers */
  --line-2:     #f0f0f1;    /* softest rule — inner section separators */
  --line-strong:#000000;    /* emphasis rule — capsule button borders, camera frame */

  /* Radii */
  --radius:     18px;       /* standard card corners */
  --radius-sm:  14px;       /* inner nested elements */
  --pill:       9999px;     /* fully elliptical capsule — all interactive buttons */
}
```

**Semantic Usage:**

- `--bg` → entire page background, all white card surfaces
- `--ink` / `--line-strong` → capsule button borders, camera card frame border
- `--bg-soft` → product thumbnail backgrounds, size calculator inputs
- `--muted` → instruction text, inactive labels, step numbers
- Camera card interior: `background: #000000` — pure black to maximize garment contrast against the video feed

#### MERIDIAN Storefront — Royal Blue System (`style.css`)

```css
:root {
  --blue:        #0b3c95;   /* primary brand — CTAs, prices, active states */
  --blue-deep:   #082e73;   /* announcement bar background */
  --blue-night:  #061f4d;   /* footer background */
  --blue-bright: #4169e1;   /* highlight accents, eyebrow labels */
  --blue-tint:   #eef3fc;   /* pale section background */
  --blue-tint-2: #dde7f8;   /* slightly stronger tint */

  --white:       #ffffff;
  --gray-50:     #f8f9fa;
  --gray-100:    #e9ecef;
  --border:      #e5e7eb;   /* 1px hairlines */
  --ink:         #14181f;   /* near-black body text */
  --text:        #3a3f47;
  --muted:       #6b7280;
}
```

---

### 1.3 Typography

#### PEAR Demo

```
Primary:   Urbanist — Google Fonts
           Weights: 400, 500, 600, 700, 800, 900
           Role: Headlines, countdown numbers, size display, button labels

Secondary: Inter — Google Fonts
           Weights: 400, 500, 600, 700, 800
           Role: Body copy, form labels, status text, caption
```

**Type Scale (PEAR Demo):**

| Element | Family | Size | Weight | Line Height |
|---------|--------|------|--------|-------------|
| Size display (`178 cm`) | Urbanist | `2.5rem` (40px) | 900 | 1 |
| Countdown timer | Urbanist | `3rem` (48px) | 900 | 1 |
| Personal title heading | Urbanist | `1.55rem` (24.8px) | 700 | 1.2 |
| Section label | Inter | `0.85rem` (13.6px) | 600 | 1.4 |
| Button text | Urbanist | `1rem` (16px) | 800 | 1 |
| Instruction text | Inter | `0.9rem` (14.4px) | 400 | 1.6 |
| Caption / badge text | Inter | `0.75rem` (12px) | 500 | 1.3 |

#### MERIDIAN Storefront

```
Primary: Inter — Google Fonts
         Weights: 300, 400, 500, 600, 700, 800, 900
         Role: All text

Fluid type scale using CSS clamp():
  Hero title:     clamp(52px, 10vw, 124px), weight 900
  Section titles: clamp(28px, 4.5vw, 44px), weight 700
  Body text:      16px, weight 400
  Card name:      17px, weight 600
  Card category:  11px, weight 500, uppercase, letter-spacing 0.08em
  Nav links:      14px, weight 500
  Announcements:  12.5px, weight 500
```

---

### 1.4 Spacing & Grid Foundation

```css
:root {
  --maxw: 1280px;                       /* maximum content width */
  --pad:  clamp(18px, 4vw, 48px);       /* fluid horizontal padding */
}

.container {
  max-width: var(--maxw);
  margin: 0 auto;
  padding: 0 var(--pad);
}

.sec {                                  /* standard section vertical rhythm */
  padding-block: clamp(56px, 8vw, 104px);
}
```

**Base Grid System:**

- Section columns: CSS `grid-template-columns: repeat(N, 1fr)` — N varies per breakpoint
- Inline flex: `gap` uses multiples of 4px (`4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`)
- No hard-coded pixel margins — all horizontal space is `gap` on flex/grid parents

---

### 1.5 Capsule Component Design Rules

The **Capsule** is the single interactive button shape used throughout PEAR. It is a fully rounded ellipse — `border-radius: var(--pill)` (`9999px`) — with thin, elegant borders and high-contrast state changes.

**Design Rules:**

```
Shape:      Fully rounded ellipsis (pill). Border-radius never less than pill.
Border:     1px solid — either --line (inactive) or --line-strong / #000 (active/hover)
Surface:    --bg (#fff) for secondary; #000 for primary filled
Text:       --ink for light capsule; #fff for dark capsule
Padding:    12px 24px (standard); 10px 20px (compact)
Font:       Urbanist 800, 1rem
Min-width:  none — width is content-driven
Transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease
```

**States:**

| State | Background | Border | Text Color |
|-------|-----------|--------|------------|
| Default (secondary) | `#ffffff` | `1px solid #e5e7eb` | `#000000` |
| Hover (secondary) | `#f7f7f8` | `1px solid #000000` | `#000000` |
| Active (primary filled) | `#000000` | `1px solid #000000` | `#ffffff` |
| Hover (primary filled) | `#1a1a1a` | `1px solid #1a1a1a` | `#ffffff` |
| Disabled | `#f7f7f8` | `1px solid #e5e7eb` | `#9ca3af` |
| Focus ring | any | `2px solid #000`, `outline-offset: 2px` | — |

**Active state should never use color.** Dark-to-darker black transitions only. No blue, no green, no gradient fills on interactive buttons.

---

### 1.6 Motion & Easing

```css
:root {
  --ease: cubic-bezier(0.22, 1, 0.36, 1);  /* snappy premium easing */
}
```

**Duration Reference:**

| Interaction | Duration | Easing |
|-------------|----------|--------|
| Button hover | `0.2s` | `ease` |
| Button press (`translateY(-2px)`) | `0.15s` | `ease` |
| Modal/panel open | `0.35s–0.4s` | `var(--ease)` |
| Card stagger fade-in | `0.55s` | `var(--ease)` |
| Toast appear/disappear | `0.45s` | `var(--ease)` |
| Carousel scroll | `smooth` | browser-native |
| Countdown digit change | `0s` | instantaneous — no tween |
| Live pulse ring | `1.8s` | `ease-out infinite` |

---

## 2. Component Layout Architecture

### 2.1 Product Catalog Grid

**Location:** `/index.html` — `.products` section

The catalog uses a strict **4-column CSS Grid** on desktop that collapses to 2 columns on tablet and 1 column on mobile. Each card is self-contained with its own aspect-ratio-locked media region.

```css
.grid--4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}

@media (max-width: 1024px) {
  .grid--4 { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 760px) {
  .grid--4 { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 460px) {
  .grid--4 { grid-template-columns: 1fr; }
}
```

**Card Component Structure:**

```html
<article class="card" style="--i: 0">   <!-- --i drives stagger delay -->
  <div class="card__media">             <!-- 4:5 aspect ratio container -->
    <svg>...</svg>                       <!-- procedural garment SVG -->
    <span class="card__badge">New</span>
  </div>
  <div class="card__body">
    <p class="card__category">Tops</p>
    <h3 class="card__name">Clean Poplin Shirt</h3>
    <div class="card__footer">
      <span class="card__price">₪299</span>
      <div class="card__actions">
        <button class="btn btn--try">View Product</button>
        <button class="btn btn--add" aria-label="Add to bag">+</button>
      </div>
    </div>
  </div>
</article>
```

**Card Stagger Animation:**

```css
.card {
  opacity: 0;
  transform: translateY(20px);
  animation: fade 0.55s var(--ease) forwards;
  animation-delay: calc(var(--i) * 55ms);
}

@keyframes fade {
  to { opacity: 1; transform: translateY(0); }
}
```

Cards entering the viewport trigger the stagger via `IntersectionObserver` setting `--i` on each element before adding the animation class.

---

### 2.2 4K Product Thumbnails — CSS Sizing Strategy

Every product thumbnail is rendered as a **procedurally generated SVG** from `catalog.js`. There are no raster images for garment catalog items. SVGs are generated at runtime, injected into the DOM, and constrained by a strict CSS aspect-ratio lock.

**The constraint that prevents all warping:**

```css
.card__media {
  position: relative;
  aspect-ratio: 4 / 5;          /* locked portrait ratio — NEVER change */
  width: 100%;                  /* fills grid column */
  overflow: hidden;
  border-radius: var(--radius) var(--radius) 0 0;
  background: radial-gradient(ellipse at 50% 30%, #f5f5f5 0%, #e8e8e8 100%);
}

.card__media svg,
.card__media img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;            /* crop, never stretch */
  object-position: center top;  /* anchor garments to top of frame */
  display: block;
}
```

**Why `aspect-ratio` over `padding-top` hack:**

`aspect-ratio: 4 / 5` is declarative and survives any parent width change identically. The `padding-top: 125%` legacy hack requires the parent to have `position: relative` and the child `position: absolute` — it's fragile in flex/grid contexts. `aspect-ratio` works correctly inside `repeat(4, 1fr)` grid columns with zero additional positioning rules.

**Desktop vs Mobile identity:**

Because `width: 100%` means "fill my grid column" and the grid column's pixel width changes at breakpoints, the thumbnail's pixel dimensions change — but the **ratio** remains 4:5 on every device. A 400px-wide desktop card produces a 320×400px image area. A 180px-wide mobile card produces a 144×180px image area. No warping, no cropping artifacts, because `object-fit: cover` maintains the SVG's own internal aspect ratio within the container.

**For any raster product images used in `product.html`:**

```css
.product__gallery-img {
  width: 100%;
  aspect-ratio: 3 / 4;         /* slightly taller for detail pages */
  object-fit: cover;
  object-position: center;
  border-radius: var(--radius);
  display: block;
}
```

---

### 2.3 Live Try-On Canvas / Mirror

**Location:** `/pear-demo/index.html` — `.camera-card`

The fitting room renders two video layers and one canvas element stacked in absolute position within a single aspect-ratio-locked container.

**Container:**

```css
.camera-card {
  position: relative;
  aspect-ratio: 3 / 4;              /* portrait camera — matches garment ratio */
  width: 100%;
  max-width: 420px;                 /* cap on large desktop */
  margin: 0 auto;
  background: #000000;              /* black surround for video contrast */
  border: 1px solid var(--ink);     /* 1px black border — capsule design language */
  border-radius: var(--radius);     /* 18px — matches all card components */
  overflow: hidden;
}
```

**Layer Stack (bottom → top):**

```
Layer 0: #webcam           z-index: 1   Native HD camera feed (mirrored)
Layer 1: #aiVideo          z-index: 2   Decart VTON WebRTC stream (hidden until LIVE)
Layer 2: #resultCanvas     z-index: 3   Frozen snapshot after session ends (hidden until FROZEN)
Layer 3: .countdown-overlay z-index: 4  5-second countdown + timer UI (shown during LIVE state)
Layer 4: .status-bar       z-index: 5   Connection state badge (always visible top edge)
```

**Common rules for all video/canvas layers:**

```css
#webcam,
#aiVideo,
#resultCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scaleX(-1);            /* mirror — user expects selfie orientation */
  border-radius: inherit;
}

#aiVideo    { display: none; }      /* shown only when state === "LIVE" */
#resultCanvas { display: none; }    /* shown only when state === "FROZEN" */
```

**Mirror Transform Note:** `scaleX(-1)` is applied to all three layers uniformly. This means the AI-composited VTON feed is also mirrored, which matches the user's expectation of "mirror selfie" orientation. The real-world garment orientation is correct because the Decart model operates on the un-mirrored stream and outputs an un-mirrored result; the CSS mirror is purely cosmetic for the viewer.

**WebRTC Resolution Intent:**

The local camera stream is requested at the highest feasible resolution:

```javascript
navigator.mediaDevices.getUserMedia({
  video: {
    width:  { ideal: 3840 },        /* 4K preferred */
    height: { ideal: 2160 },
    facingMode: "user",
    frameRate: { ideal: 30 }
  },
  audio: false
});
```

The browser downgrades automatically if 4K is unavailable. The CSS `object-fit: cover` handles any resolution mismatch by cropping symmetrically to the 3:4 container, so the display is never stretched regardless of native camera resolution.

---

### 2.4 Countdown Overlay & Timer UI

**Location:** `.countdown-overlay` — absolute child of `.camera-card`

During the active 5-second try-on session (`LIVE_DURATION_MS = 5000`), a semi-transparent countdown overlay renders on top of the VTON video feed.

**DOM Structure:**

```html
<div class="countdown-overlay" aria-live="assertive" aria-atomic="true">
  <div class="countdown-ring">
    <svg class="countdown-ring__svg" viewBox="0 0 56 56">
      <circle class="countdown-ring__track" cx="28" cy="28" r="24"/>
      <circle class="countdown-ring__fill"  cx="28" cy="28" r="24"/>
    </svg>
    <span class="countdown-ring__number">5</span>
  </div>
  <p class="countdown-label">מנסה על...</p>
</div>
```

**CSS:**

```css
.countdown-overlay {
  position: absolute;
  inset: 0;
  display: none;                          /* hidden by default */
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(0, 0, 0, 0.25);       /* dark scrim — preserves video legibility */
  border-radius: inherit;
  z-index: 4;
}

.countdown-overlay.visible {
  display: flex;
}

/* Ring */
.countdown-ring {
  position: relative;
  width: 80px;
  height: 80px;
}

.countdown-ring__svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);             /* start progress from top */
}

.countdown-ring__track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.25);
  stroke-width: 3;
}

.countdown-ring__fill {
  fill: none;
  stroke: #ffffff;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 150.8;               /* 2π × r = 2π × 24 ≈ 150.8 */
  stroke-dashoffset: 0;                  /* full circle at t=0 */
  transition: stroke-dashoffset linear;  /* duration set via JS each tick */
}

.countdown-ring__number {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Urbanist', sans-serif;
  font-size: 2rem;
  font-weight: 900;
  color: #ffffff;
  line-height: 1;
}

.countdown-label {
  font-family: 'Inter', sans-serif;
  font-size: 0.9rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  text-align: center;
}
```

**JavaScript Timer Logic:**

The countdown is driven by `LIVE_DURATION_MS = 5000` from `config.js`. The ring's `stroke-dashoffset` is animated from `0` (full ring) to `150.8` (empty ring) linearly over 5 seconds. The integer displayed in `.countdown-ring__number` updates once per second via `setInterval(1000)`.

```javascript
import { LIVE_DURATION_MS } from './config.js';

function startCountdown(overlay, ringFill, numberEl) {
  const CIRCUMFERENCE = 150.8;
  const TOTAL_SECS = LIVE_DURATION_MS / 1000;       // 5
  let remaining = TOTAL_SECS;

  // Animate ring continuously
  ringFill.style.transition = `stroke-dashoffset ${LIVE_DURATION_MS}ms linear`;
  ringFill.style.strokeDashoffset = String(CIRCUMFERENCE);

  // Update integer each second
  const tick = setInterval(() => {
    remaining -= 1;
    numberEl.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) clearInterval(tick);
  }, 1000);

  // Auto-hide after session
  setTimeout(() => {
    overlay.classList.remove('visible');
    clearInterval(tick);
  }, LIVE_DURATION_MS);
}
```

---

### 2.5 Post-Session Control Capsule

After the 5-second session ends, the countdown overlay is replaced by the **Post-Session Control Capsule** — a side-by-side button pair anchored to the bottom of the camera card.

**DOM Structure:**

```html
<div class="post-session-bar">
  <button class="capsule capsule--secondary" id="btnDownload">
    <svg class="capsule__icon"><!-- download icon --></svg>
    <span>הורדת סרטון</span>    <!-- Download Video -->
  </button>
  <button class="capsule capsule--primary" id="btnWatchAgain">
    <svg class="capsule__icon"><!-- replay icon --></svg>
    <span>צפה שוב</span>        <!-- Watch Again -->
  </button>
</div>
```

**CSS:**

```css
.post-session-bar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: none;                         /* hidden until state === "FROZEN" */
  align-items: center;
  gap: 10px;
  z-index: 5;
  white-space: nowrap;
}

.post-session-bar.visible {
  display: flex;
}

/* Base capsule */
.capsule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: var(--pill);            /* 9999px */
  border: 1px solid;
  font-family: 'Urbanist', sans-serif;
  font-size: 0.95rem;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
  backdrop-filter: blur(8px);            /* glass feel over video frame */
  -webkit-backdrop-filter: blur(8px);
}

.capsule__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Download — secondary (light) */
.capsule--secondary {
  background: rgba(255, 255, 255, 0.90);
  border-color: rgba(255, 255, 255, 0.90);
  color: #000000;
}
.capsule--secondary:hover {
  background: #ffffff;
  border-color: #000000;
}

/* Watch Again — primary (dark) */
.capsule--primary {
  background: rgba(0, 0, 0, 0.80);
  border-color: rgba(0, 0, 0, 0.80);
  color: #ffffff;
}
.capsule--primary:hover {
  background: #000000;
  border-color: #000000;
}
```

**Behavior:**

- `#btnDownload` — triggers `MediaRecorder` blob export and native share/download
- `#btnWatchAgain` — rewinds local Blob URL replay (see [§4.4](#44-watch-again-replay-behavior))
- On mobile iOS: Download routes through `navigator.share()` instead of `<a download>` (Share Sheet)
- On Android / desktop: programmatic `<a href="blobURL" download="pear-tryon.mp4">` click

---

### 2.6 Recommendations Carousel — "Add to Look"

**Location:** `/index.html` — `.ctl` section inside `.tryon__panel`

The "Complete the Look" (הוסף ללוק) carousel renders AI-selected garment pairings below the camera region in the try-on modal. It is a horizontally scrollable flex row with scroll-snap.

**DOM Structure:**

```html
<section class="ctl">
  <h3 class="ctl__heading">הוסף ללוק</h3>
  <div class="ctl__track" role="list">
    <div class="ctl__card" role="listitem">
      <div class="ctl__media">
        <svg><!-- garment SVG --></svg>
      </div>
      <p class="ctl__name">Slim Chinos</p>
      <p class="ctl__price">₪349</p>
      <button class="capsule capsule--secondary ctl__cta">+ הוסף</button>
    </div>
    <!-- 3 more cards -->
  </div>
</section>
```

**CSS:**

```css
.ctl {
  padding: 20px 0 0;
  border-top: 1px solid var(--line);
}

.ctl__heading {
  font-family: 'Urbanist', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 14px;
}

.ctl__track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;              /* hide native scrollbar */
  padding-bottom: 4px;                /* prevent clipping of box-shadow on focus */
}

.ctl__track::-webkit-scrollbar { display: none; }

.ctl__card {
  flex: 0 0 140px;                    /* fixed width — prevents flex shrink */
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ctl__media {
  aspect-ratio: 3 / 4;
  width: 100%;
  background: var(--bg-soft);
  border-radius: var(--radius-sm);    /* 14px */
  overflow: hidden;
}

.ctl__media svg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ctl__name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctl__price {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0;
}

.ctl__cta {
  font-size: 0.8rem;
  padding: 6px 12px;
  align-self: flex-start;
}
```

**Interaction:** Clicking `+ הוסף` triggers a `postMessage` to the parent window which updates `activeOutfit` in `store.js`, then re-renders the VTON session with the combined look if the session is still live. If the session has ended, it queues the garment for the next session start.

---

## 3. Cross-Device Responsiveness Strategy

### 3.1 Breakpoints

```css
/* PEAR Demo — pear-demo/style.css */
@media (max-width: 600px)  { /* mobile phones */ }
@media (max-width: 900px)  { /* tablets */       }

/* MERIDIAN Storefront — style.css */
@media (max-width: 1024px) { /* large tablet / small laptop */ }
@media (max-width: 900px)  { /* tablet landscape */            }
@media (max-width: 760px)  { /* tablet portrait / large phone */}
@media (max-width: 460px)  { /* small phone */                  }
```

### 3.2 Grid & Flexbox Constraints

**Product Catalog — Column Collapse:**

```
≥1025px     → 4 columns  (grid-template-columns: repeat(4, 1fr))
901–1024px  → 3 columns  (repeat(3, 1fr))
461–760px   → 2 columns  (repeat(2, 1fr))
≤460px      → 1 column   (1fr)
```

**Camera Card — Max-Width Clamp:**

The camera card is `width: 100%` up to `max-width: 420px` on desktop. On mobile it fills the viewport width with `padding: 0 16px` on the parent. This guarantees an identical **3:4 aspect ratio** on every screen width — the rendered pixel dimensions differ but the visual proportion is identical.

```css
.camera-wrapper {
  width: 100%;
  padding: 0 clamp(0px, 4vw, 24px);   /* no padding on tiny phones */
  box-sizing: border-box;
}

.camera-card {
  aspect-ratio: 3 / 4;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
}
```

**Proof of Identical Aspect Ratio:**

| Screen Width | Camera Card Pixel Width | Camera Card Pixel Height | Ratio |
|---|---|---|---|
| 375px (iPhone SE) | 343px | 457px | 3:4 ✓ |
| 390px (iPhone 15) | 358px | 477px | 3:4 ✓ |
| 768px (iPad) | 420px | 560px | 3:4 ✓ |
| 1440px (Desktop) | 420px | 560px | 3:4 ✓ |

The max-width cap of 420px means desktop and large-tablet viewports produce identical pixel dimensions — the camera does not stretch absurdly wide.

### 3.3 Mobile-Specific Overrides

**Typography:**

```css
@media (max-width: 460px) {
  /* MERIDIAN storefront — hero title shrinks to prevent overflow */
  .hero__title {
    font-size: clamp(36px, 12vw, 52px);
  }
}
```

**Try-On Modal:**

```css
@media (max-width: 600px) {
  /* PEAR demo — single column layout, panel fills screen */
  .tryon__panel {
    width: 100%;
    max-width: none;
    border-radius: 0;
    min-height: 100dvh;             /* dynamic viewport height — avoids mobile browser chrome overlap */
  }
}
```

**Post-Session Capsule on Narrow Screens:**

```css
@media (max-width: 380px) {
  .post-session-bar {
    gap: 6px;
  }
  .capsule {
    padding: 8px 14px;
    font-size: 0.85rem;
  }
  .capsule span {
    display: none;                  /* icon-only on very narrow screens */
  }
}
```

### 3.4 Mobile-Specific Functional Behavior

```javascript
// pear-demo/app.js
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);

// Codec selection
const PREFERRED_CODEC = IS_MOBILE
  ? 'video/mp4; codecs="avc1.42E01E"'    // H.264 MP4 — iOS/Android hardware decode
  : 'video/webm; codecs="vp8"';           // VP8 WebM — Chrome desktop

// Export method
if (IS_MOBILE && navigator.share) {
  await navigator.share({ files: [videoFile] });  // iOS/Android Share Sheet
} else {
  const a = document.createElement('a');
  a.href = blobURL;
  a.download = 'pear-tryon.mp4';
  a.click();                                      // Desktop: native file download
}
```

---

## 4. UI State Management & Interaction Flow

### 4.1 State Machine Overview

The fitting room UI operates as a strict three-state machine. Only one state is active at a time; state transitions are one-way during a session (resetting requires explicit user action).

```
PREPARATION ──────► LIVE (5s) ──────► FINISHED
     │                                    │
     │                    ◄───────────────┘
     │                    Watch Again (local replay resets FINISHED state display only)
     │
     └── network check → token fetch → WebRTC connect (all happen in PREPARATION)
```

**State Responsibilities:**

| State | Duration | User Sees | Layers Visible |
|-------|----------|-----------|----------------|
| `PREPARATION` | Until WebRTC "connected" | Webcam mirror, connecting badge | `#webcam` only |
| `LIVE` | `LIVE_DURATION_MS = 5000ms` | VTON overlay, countdown ring, live badge | `#aiVideo` + countdown overlay |
| `FINISHED` | Until manual reset | Frozen frame, post-session capsule buttons | `#resultCanvas` + `.post-session-bar` |

### 4.2 PREPARATION State

**Entry condition:** Page load → camera permissions granted

**Active elements:**
- `#webcam` is visible and streaming
- Status bar shows `connecting…` spinner badge
- No VTON overlay active
- Network speed probe (`/api/speed-probe`) runs in background

**Transition trigger:** Decart SDK fires `onConnectionChange("connected")`

**Transition actions:**
1. Status bar badge changes to green "LIVE" pulse ring
2. `#webcam` display stays (acts as fallback layer beneath)
3. `#aiVideo.srcObject` set to remote VTON stream
4. `#aiVideo.style.display = 'block'`
5. `.countdown-overlay` gets class `visible`
6. `LIVE_DURATION_MS` countdown timer starts

### 4.3 LIVE State (Active 5-Second Session)

**Entry:** Decart WebRTC stream established

**Active elements:**
- `#aiVideo` renders real-time VTON composite
- `.countdown-overlay` renders with SVG ring + integer countdown
- Status bar shows green live badge with pulse animation

**Timer implementation:**

```javascript
import { LIVE_DURATION_MS } from './config.js';   // 5000

const liveTimer = setTimeout(endSession, LIVE_DURATION_MS);

function endSession() {
  clearTimeout(liveTimer);

  // Freeze the current VTON frame to canvas
  const canvas = document.getElementById('resultCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width  = aiVideo.videoWidth;
  canvas.height = aiVideo.videoHeight;
  ctx.drawImage(aiVideo, 0, 0);

  // Swap layers
  aiVideo.style.display    = 'none';
  canvas.style.display     = 'block';
  countdownOverlay.classList.remove('visible');
  postSessionBar.classList.add('visible');

  // Stop WebRTC to end token spend
  rtClient.disconnect();

  captureState = 'frozen';
}
```

**MediaRecorder capture (parallel to display):**

While the VTON feed is live, `MediaRecorder` captures the `#aiVideo` stream into an array of `Blob` chunks. On `endSession()`, chunks are assembled into a single `Blob` and stored as a local Blob URL for the "Watch Again" replay and "Download" export. No server upload occurs.

### 4.4 FINISHED State & "Watch Again" Replay Behavior

**Entry:** `endSession()` completes

**Active elements:**
- `#resultCanvas` shows the frozen HD snapshot
- `.post-session-bar` shows both capsule buttons
- Status bar changes to `• Finished` neutral badge
- WebRTC connection closed

**"Watch Again" (צפה שוב) behavior:**

Clicking `#btnWatchAgain` does NOT restart the WebRTC session or re-spend any tokens. It plays the locally cached `Blob URL` recorded during the LIVE phase using a hidden `<video>` element:

```javascript
let replayBlobURL = null;  // set when MediaRecorder finishes assembling chunks

document.getElementById('btnWatchAgain').addEventListener('click', () => {
  if (!replayBlobURL) return;

  const replayVideo = document.getElementById('replayVideo');   // hidden <video> behind canvas
  replayVideo.src = replayBlobURL;
  replayVideo.currentTime = 0;          // always rewind to start
  replayVideo.style.display = 'block';
  canvas.style.display = 'none';        // hide frozen frame during replay
  replayVideo.play();

  replayVideo.onended = () => {
    replayVideo.style.display = 'none';
    canvas.style.display = 'block';     // return to frozen frame when replay finishes
  };
});
```

**Key invariant:** `currentTime = 0` is set unconditionally before `.play()`. This guarantees that pressing "Watch Again" multiple times always starts from the first frame of the try-on moment, never from a mid-video position.

**"Download Video" (הורדת סרטון) behavior:**

```javascript
document.getElementById('btnDownload').addEventListener('click', async () => {
  if (!replayBlobURL) return;

  const file = new File([await fetch(replayBlobURL).then(r => r.blob())],
    'pear-tryon.mp4', { type: 'video/mp4' });

  if (IS_MOBILE && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'PEAR Try-On' });
  } else {
    const a = document.createElement('a');
    a.href = replayBlobURL;
    a.download = 'pear-tryon.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
});
```

### 4.5 State-Driven CSS Class Map

All visibility changes are driven by adding/removing CSS classes on root containers — no `style.display` mutations except where noted for video layers (which require direct DOM property access for MediaStream compatibility).

```
.camera-card[data-state="preparation"]  → show #webcam, hide all overlays
.camera-card[data-state="live"]         → show #aiVideo + .countdown-overlay
.camera-card[data-state="frozen"]       → show #resultCanvas + .post-session-bar
```

```css
/* Preparation */
[data-state="preparation"] #webcam           { display: block; }
[data-state="preparation"] #aiVideo          { display: none;  }
[data-state="preparation"] #resultCanvas     { display: none;  }
[data-state="preparation"] .countdown-overlay{ display: none;  }
[data-state="preparation"] .post-session-bar { display: none;  }

/* Live */
[data-state="live"] #webcam                  { display: block; } /* fallback beneath AI */
[data-state="live"] #aiVideo                 { display: block; }
[data-state="live"] #resultCanvas            { display: none;  }
[data-state="live"] .countdown-overlay       { display: flex;  }
[data-state="live"] .post-session-bar        { display: none;  }

/* Frozen */
[data-state="frozen"] #webcam               { display: none;  }
[data-state="frozen"] #aiVideo              { display: none;  }
[data-state="frozen"] #resultCanvas         { display: block; }
[data-state="frozen"] .countdown-overlay    { display: none;  }
[data-state="frozen"] .post-session-bar     { display: flex;  }
```

JavaScript transitions:

```javascript
function setState(newState) {
  document.querySelector('.camera-card').dataset.state = newState;
}

setState('preparation');   // on page load
setState('live');          // on WebRTC connected
setState('frozen');        // after LIVE_DURATION_MS expires
```

---

## Appendix A — File Locations

| File | Role |
|------|------|
| [pear-demo/index.html](index.html) | Fitting room HTML — all component DOM |
| [pear-demo/style.css](style.css) | Monochrome design system & component CSS |
| [pear-demo/app.js](app.js) | VTON session manager, state machine, MediaRecorder |
| [pear-demo/config.js](config.js) | `LIVE_DURATION_MS`, timeouts, endpoints (single source of truth) |
| [style.css](../style.css) | MERIDIAN storefront design system |
| [index.html](../index.html) | Storefront landing — catalog grid, carousels, try-on modal |
| [catalog.js](../catalog.js) | Product data + procedural SVG generator |
| [store.js](../store.js) | Storefront state, network probe, try-on modal orchestration |

## Appendix B — Critical Constants

```javascript
// pear-demo/config.js
LIVE_DURATION_MS       = 5000    // ms — hard cap on VTON session (token protection)
CONNECT_TIMEOUT_MS     = 12000   // ms — abort if WebRTC doesn't reach "connected"
HEALTH_PROBE_TIMEOUT_MS = 4000   // ms — pre-flight connectivity check
TOAST_DURATION_MS      = 2600    // ms — transient notification lifetime

// store.js
NET_MIN_KBPS           = 2000    // kbps — minimum bandwidth to allow VTON modal
NET_PROBE_BYTES        = 102400  // 100KB probe payload for speed test
NET_PROBE_TIMEOUT      = 8000    // ms — abort speed probe after this
```
