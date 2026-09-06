# Luqmat Al Malek — site

Single-page brand site. Hand-written HTML, CSS and JS. **No build step and no dependencies** —
if you have Node 18+, you can run it.

```bash
npm run dev      # http://127.0.0.1:3003
npm run check    # the static layer (see below)
```

From the workspace root, the harness runs both:

```powershell
python agency-workflows\tools\client_run.py check luqmat-al-malek --lane website
```

Expect `partial`: `static` PASS, `runtime` PASS, `e2e` SKIP. A skipped layer is not a pass.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The whole page. Ends with the **owner-confirmation queue** — read it. |
| `assets/css/style.css` | One stylesheet. Tokens at the top, then sections in page order. |
| `assets/js/main.js` | Responsive scroll-film engine: aspect-ratio cut selection, frame loading, ImageBitmap window, canvas rendering, beat timing, `?jump=`/`window.__ready`, sticky nav and section reveals. |
| `server.mjs` | ~70-line local static server. |
| `scripts/check.mjs` | The static layer. |
| `media/frames/` | 189 source-faithful 1280×720 JPEG frames from desktop/landscape v4. |
| `media/frames-9x16/` | 217 source-faithful 720×1280 JPEG frames from mobile/portrait v1. |
| `media/menu/` | Optimized concept menu imagery. |

The browser selects one film by viewport aspect ratio and never requests the other set. The
original MP4s remain local source evidence under `../assets/generated/cinematic-concepts/` and
are excluded from the Vercel upload; direct `<video>.currentTime` seeking is not used because it
cannot meet the bidirectional scroll-jank gate.

## What `npm run check` actually enforces

There is no compiler here, so the check does the three jobs a compiler would:

1. every local `href`/`src` in `index.html` resolves on disk
2. `assets/js/main.js` parses
3. **no unconfirmed client fact reached rendered copy**

Point 3 is the one that matters for this client. The check strips HTML comments, then fails
the build if the remaining markup contains a dollar price, a bare "100% Halal" claim, or the
DoorDash trading hours. All three are forbidden — the DoorDash prices are delivery prices
running well above the counter (`../DECISIONS.md` D-006), and the halal claim is a
certification claim with no certifying body named yet.

This is mechanical on purpose. The price ban is one careless paste away from being broken, and
publishing marked-up delivery prices as the in-store menu would misprice the client's own food
on the client's own website.

## Typography

Three families, no fourth. Loaded from Google Fonts in one request.

| Role | Face | Why |
| --- | --- | --- |
| Display | **Bodoni Moda** (variable optical size) | The brand's whole idea is royal. A high-contrast didone carries that with hairline serifs instead of crown ornament — which matters, because the crest is already the loudest thing in the identity. Never set below 22px anywhere; its hairlines vanish at small sizes. |
| Text / UI | **Instrument Sans** | Quiet, slightly condensed grotesque. Carries menu rows, address and buttons at speed and stays out of the display face's way. |
| Arabic | **Noto Kufi Arabic** | For the لقمة الملك lockup. Kufi's squared terminals sit with Bodoni's verticals; a naskh face fights them. |

Rejected: Playfair Display (the category default — fails the "only this client" test on sight)
and a single-sans system (cheap, and it throws away the one idea the brand hands us for free).
Full reasoning in `../DECISIONS.md` D-010.

## Before this can launch

Not launch-ready. Two things gate it, both tracked in `../lanes/website/FEATURES.md`:

- **F-011** — the six items in the confirmation queue at the foot of `index.html`. The halal
  certifying body is the highest-value single line: this audience looks for it first, and it
  is currently absent from the page.
- **F-012** — real in-store photography. The hero is the generated concept film
  (`concept_only`, `motion_led`, D-008). Good enough to show the owner; not a launch asset.

Visual review is also `pending` and cannot be self-approved — it needs a reviewer independent
of whoever built this, the rubric from `templates/visual-review.md`, and a manifest that
`validate_visual_evidence.py` accepts.
