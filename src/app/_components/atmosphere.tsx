/**
 * AKBARAL! atmospheric background — cinematic depth with NO external assets.
 *
 * ============================================================
 * DEFAULT IS CSS-ONLY.
 * ============================================================
 * The layered radial + conic gradient fields below are painted entirely
 * from design tokens (--atmo-*, --accent-soft, --bg-deep). There is no
 * network fetch, no third-party CDN, and no media request of any kind on
 * the default path.
 *
 * OWNER VIDEO (opt-in, off by default)
 * ------------------------------------
 * A hero loop can be enabled by the repository owner WITHOUT code changes:
 *   1. set `AKBARAL_ENABLE_HERO_VIDEO=true`
 *   2. drop a self-hosted file at `public/media/hero-loop.mp4`
 *      (optional still frame at `public/media/hero-poster.jpg`)
 * The page (a server component) reads the flag and passes `enableVideo`.
 * When the flag is absent/false, or the path is not a local owner asset,
 * no <video> element is rendered at all — never a broken layer, never a
 * request to a third party.
 *
 * See docs/HERO_VIDEO.md for the owner file spec (resolution, duration,
 * size budget, encoding).
 */

import type { ReactNode } from 'react';
import styles from './atmosphere.module.css';

/** Canonical location of the owner-supplied hero loop, relative to /public. */
export const OWNER_HERO_VIDEO_SRC = '/media/hero-loop.mp4';
/** Canonical location of the owner-supplied poster frame. */
export const OWNER_HERO_POSTER_SRC = '/media/hero-poster.jpg';

/**
 * True only for a path that is local, absolute and traversal-free.
 * Rejects every remote form: absolute remote schemes, protocol-relative
 * and host-relative (`//host/...`) URLs, and any parent-directory escape.
 */
export function isLocalOwnerAssetPath(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('://')) return false;
  if (value.startsWith('//') || value.startsWith('\\\\')) return false;
  if (!value.startsWith('/')) return false;
  if (value.includes('..')) return false;
  // A single leading slash, then safe path characters only.
  return /^\/[A-Za-z0-9._\-/]+$/.test(value);
}

/**
 * Server-side read of the owner opt-in flag. Default OFF.
 * Called from server components (pages); never from client code, so the
 * value never needs to be inlined into the browser bundle.
 */
export function heroVideoEnabled(): boolean {
  const raw = process.env.AKBARAL_ENABLE_HERO_VIDEO;
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

type AtmosphereProps = {
  /** Owner opt-in. Default false — CSS-only atmosphere. */
  enableVideo?: boolean;
  /** Local path only. Anything remote is rejected, not rendered. */
  videoSrc?: string;
  /** Local path only. */
  poster?: string;
  /** `hero` is denser and taller; `page` is a restrained wash. */
  variant?: 'hero' | 'page';
  /** When provided the component becomes a positioned stage. */
  children?: ReactNode;
  className?: string;
};

export function Atmosphere({
  enableVideo = false,
  videoSrc = OWNER_HERO_VIDEO_SRC,
  poster = OWNER_HERO_POSTER_SRC,
  variant = 'page',
  children,
  className,
}: AtmosphereProps) {
  // Every one of these conditions must hold for a <video> to exist.
  const videoAllowed = enableVideo === true && isLocalOwnerAssetPath(videoSrc);
  const posterAllowed = poster ? isLocalOwnerAssetPath(poster) : false;

  return (
    <div className={className ? `${styles.stage} ${className}` : styles.stage}>
      <div className={styles.atmosphere} data-variant={variant} aria-hidden="true">
        <span className={styles.fieldIndigo} />
        <span className={styles.fieldViolet} />
        <span className={styles.fieldCyan} />
        <span className={styles.conicSweep} />
        <span className={styles.vignette} />
        <span className={styles.grain} />
        {videoAllowed ? (
          <video
            className={styles.video}
            src={videoSrc}
            poster={posterAllowed ? poster : undefined}
            autoPlay
            loop
            muted
            playsInline
            preload="none"
            tabIndex={-1}
            aria-hidden="true"
            disablePictureInPicture
          />
        ) : null}
      </div>
      {children ? <div className={styles.content}>{children}</div> : null}
    </div>
  );
}

export default Atmosphere;
