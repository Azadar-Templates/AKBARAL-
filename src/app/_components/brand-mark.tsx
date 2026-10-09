/**
 * The AKBARAL! brand mark, inlined.
 *
 * Why inline instead of `<img src="/brand/…svg">`: the tiles that carry the mark
 * (workspace topbar, sign-in card, splash state, public header, hero orb) each
 * already own their colour through a CSS token — `var(--accent-bright)` in the
 * topbar, `var(--on-accent)` on the sign-in tile. An inline path with
 * `fill="currentColor"` follows that colour, so no second copy of the logo is
 * needed per background and no token can be bypassed. The standalone files under
 * public/brand remain the canonical assets for anything that must reference a
 * URL (favicon, manifest, Open Graph, e-mail, the footer lockup).
 *
 * Both come from the same generator, so they cannot disagree:
 * scripts/brand/akbaral-mark.mjs → src/app/_components/brand-mark-data.ts
 * (and → the SVGs and rasters). `npm run brand:check` proves it.
 */

import {
  BRAND_ASSETS,
  BRAND_LOGO_MARK_PATH,
  BRAND_LOGO_VIEWBOX,
  BRAND_LOGO_WORD_PATH,
  BRAND_MARK_PATH,
  BRAND_MARK_VIEWBOX,
} from './brand-mark-data';

/**
 * The monogram at `size` px.
 *
 * `decorative` (the default) hides it from assistive tech, which is right for
 * every tile in this app because the brand name sits next to it as real text —
 * announced twice it becomes noise. Set `decorative={false}` only where the mark
 * IS the name.
 */
export function BrandMark({
  size = 20,
  className,
  decorative = true,
  label = 'AKBARAL!',
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
  label?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${BRAND_MARK_VIEWBOX} ${BRAND_MARK_VIEWBOX}`}
      fill="currentColor"
      fillRule="nonzero"
      focusable={false}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
    >
      {decorative ? null : <title>{label}</title>}
      <path d={BRAND_MARK_PATH} />
    </svg>
  );
}

/**
 * The full lockup (monogram + AKBARAL! wordmark) as the repo-served SVG file.
 * Both dimensions are explicit, so an image loading late cannot shift the page
 * — the aspect ratio is the lockup's own, from the generator.
 */
export function BrandLogo({
  height = 28,
  className,
  decorative = true,
  label = 'AKBARAL!',
}: {
  height?: number;
  className?: string;
  decorative?: boolean;
  label?: string;
}) {
  const [,, vw, vh] = BRAND_LOGO_VIEWBOX.split(' ').map(Number);
  return (
    // A plain HTML img rather than next/image on purpose: the asset is a static
    // repo file at a fixed path, and the optimiser would add a runtime endpoint
    // the 512 MB deployment does not need (see next.config.mjs's memory notes).
    <img
      src={BRAND_ASSETS.logo}
      alt={decorative ? '' : label}
      className={className}
      width={Math.round((height * vw) / vh)}
      height={height}
      decoding="async"
      draggable={false}
    />
  );
}

/**
 * The lockup drawn inline — used where a file cannot be referenced (a document
 * that must render offline, e.g. the splash state).
 */
export function BrandLogoInline({ height = 28, className }: { height?: number; className?: string }) {
  const [,, vw, vh] = BRAND_LOGO_VIEWBOX.split(' ').map(Number);
  return (
    <svg
      className={className}
      width={Math.round((height * vw) / vh)}
      height={height}
      viewBox={BRAND_LOGO_VIEWBOX}
      fillRule="nonzero"
      focusable={false}
      aria-hidden="true"
    >
      <path d={BRAND_LOGO_MARK_PATH} fill="currentColor" />
      <path d={BRAND_LOGO_WORD_PATH} fill="currentColor" />
    </svg>
  );
}
