/* Static layer for a no-build site.
   There is no compiler to catch mistakes here, so this asserts the three things
   that actually break a hand-written page:
     1. every local href/src/link the HTML references exists on disk
     2. the JS parses
     3. no unconfirmed client fact leaked into rendered copy (see ../notes.md)
   Exits non-zero on any failure. */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = readFileSync(join(SITE, 'index.html'), 'utf8');

const failures = [];
const note = (msg) => failures.push(msg);

/* ── 1. local asset references resolve ─────────────────────────────────── */
const refs = new Set();
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const value = m[1];
  if (/^(https?:|mailto:|tel:|#|data:)/.test(value)) continue;
  refs.add(value.split('?')[0]);
}
for (const ref of refs) {
  if (!existsSync(join(SITE, ref))) note(`missing local asset referenced by index.html: ${ref}`);
}
if (refs.size === 0) note('no local asset references found — index.html may be malformed');

/* ── 2. JS parses ──────────────────────────────────────────────────────── */
try {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(join(SITE, 'assets/js/main.js'), 'utf8'));
} catch (err) {
  note(`assets/js/main.js failed to parse: ${err.message}`);
}

/* ── 3. no unconfirmed claim in rendered copy ──────────────────────────── */
// Everything inside an HTML comment is intentionally excluded: the
// owner-confirmation queue at the foot of index.html names these on purpose.
const rendered = html.replace(/<!--[\s\S]*?-->/g, '');

const forbidden = [
  [/100%\s*halal/i, 'a "100% Halal" certification claim is rendered without a named certifying body (design/brief.md, Content And Claim Boundaries)'],
  [/1:40\s*a\.?m\.?|2:00\s*p\.?m\.?/i, 'DoorDash trading hours are rendered — these are delivery hours, not confirmed door hours'],
];
for (const [pattern, why] of forbidden) {
  if (pattern.test(rendered)) note(why);
}

/* ── 4. every rendered price matches the in-store board ────────────────── */
// The blanket price ban was lifted on 2026-08-23 when the counter menu board
// arrived (D-012). It is replaced by an allowlist rather than dropped: the
// original hazard has not gone away, it has only become more specific. The
// DoorDash figures are still public, still complete, and still 25-40% higher,
// so the failure mode is now "someone tops up the menu from the delivery app"
// rather than "someone pastes the whole thing in".
//
// Source of truth: assets/source/reference/ref-01-menu-board-screenshot.jpg,
// transcribed at 3.4x on 2026-08-23. Update BOTH together, never just the page.
const BOARD_PRICES = new Set([
  // sandwiches
  '$15.99', '$14.99', '$13.99', '$17.99', '$12.99', '$9.99',
  // burgers + add-ons
  '$10.99', '$0.50',
  // chicken
  '$5.99', '$18.99',
  // poutine + sides
  '$7.99', '$6.99', '$4.99',
  // combo, extras, drinks
  '+$5.99', '+$3.99', '$1.99', '$3.00', '$1.50',
]);

const DELIVERY_ONLY = new Set(['$19.99', '$21.99', '$20.99', '$16.99', '$11.99']);

for (const m of rendered.matchAll(/\+?\$\s?\d+(?:\.\d{2})?/g)) {
  const price = m[0].replace(/\s/g, '');
  if (DELIVERY_ONLY.has(price.replace('+', ''))) {
    note(`${price} is a DoorDash delivery price, not a counter price — publishing it would misprice the client's own food (DECISIONS.md D-006)`);
  } else if (!BOARD_PRICES.has(price)) {
    note(`${price} is not on the in-store menu board. Add it to BOARD_PRICES here only after confirming it against ref-01-menu-board-screenshot.jpg or the owner`);
  }
}

/* ── report ────────────────────────────────────────────────────────────── */
if (failures.length) {
  console.error('static check FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`static check passed — ${refs.size} local references resolved, JS parses, no unconfirmed claim rendered`);
