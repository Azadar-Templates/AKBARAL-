'use client';

/**
 * AKBARAL! motion primitives — `Reveal` (block entrance) and `BlurReveal`
 * (word-by-word blur reveal).
 *
 * ============================================================
 * SAFETY RAILS (non-negotiable — each one is asserted by
 * src/app/motion-reveal.test.ts)
 * ============================================================
 * 1. FIRST RENDER IS VISIBLE. The server renders content with no hiding
 *    style at all. A client with no JavaScript, a blocked bundle, or a
 *    hydration failure therefore shows the finished page. Hiding only ever
 *    happens after mount, and only when we know we can un-hide it.
 * 2. REDUCED MOTION NEVER HIDES. `prefers-reduced-motion: reduce` short-
 *    circuits arming entirely; the component stays in the visible state.
 *    A CSS guard backs the JS guard, so the content is visible even if a
 *    media-query listener is unavailable.
 * 3. CONTENT CAN NEVER STAY HIDDEN. Three independent un-hide paths: the
 *    IntersectionObserver callback, a safety timeout, and a `focusin`
 *    handler (a focusable child must never be focused while invisible).
 * 4. NO LAYOUT SHIFT. Only `opacity`, `transform` and `filter` animate.
 *    No width/height/margin/position changes, so nothing reflows.
 * 5. NO DEPENDENCIES. Plain React + IntersectionObserver + CSS. Nothing
 *    is added to the client bundle for this file.
 */

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import styles from './motion-reveal.module.css';

/** Visible forever. Nothing in this file ever leaves this state behind. */
const IDLE = 'idle';
/** Armed by the client, waiting for the viewport (or a safety net). */
const ARMED = 'armed';
/** Settled visible; the entrance transition is running or finished. */
const IN = 'in';

type State = typeof IDLE | typeof ARMED | typeof IN;

/** Entrance duration for `Reveal`, matching the brief's ~700ms ease-out. */
const REVEAL_MS = 700;
/** Per-word stagger for `BlurReveal`, matching the brief's ~100ms. */
export const BLUR_REVEAL_STAGGER_MS = 100;

/**
 * If the observer never fires (element removed from the layout, a
 * zero-height ancestor, an exotic browser bug), reveal anyway. Long enough
 * to never pre-empt a real entrance, short enough that a stuck element is
 * invisible for at most a beat.
 */
const SAFETY_TIMEOUT_MS = 1600;

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Owns the idle -> armed -> in lifecycle plus every safety net.
 * Returns the current state and a ref to attach to the observed element.
 */
function useRevealState({ threshold = 0.15, disabled = false }: { threshold?: number; disabled?: boolean } = {}) {
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<State>(IDLE);

  useEffect(() => {
    // Rail 2: reduced motion, or explicitly disabled -> never arm.
    if (disabled || prefersReducedMotion()) {
      setState(IDLE);
      return;
    }

    const element = ref.current;
    if (!element) return;
    // No IntersectionObserver (very old browser, test environment): stay
    // visible rather than risk hiding content with no way back.
    if (typeof IntersectionObserver !== 'function') {
      setState(IDLE);
      return;
    }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safety);
      setState(IN);
    };

    // Rail 3a: the observer fires.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio >= threshold) settle();
        }
      },
      { threshold, rootMargin: '0px 0px -5% 0px' },
    );
    observer.observe(element);

    // Rail 3b: the safety timeout.
    const safety = window.setTimeout(settle, SAFETY_TIMEOUT_MS);

    // Rail 3c: focus must never land on an invisible element.
    const onFocusIn = (event: FocusEvent) => {
      if (element.contains(event.target as Node | null)) settle();
    };
    element.addEventListener('focusin', onFocusIn);

    // Arm only now that every un-hide path exists.
    setState(ARMED);

    return () => {
      observer.disconnect();
      element.removeEventListener('focusin', onFocusIn);
      window.clearTimeout(safety);
    };
  }, [threshold, disabled]);

  return { ref, state };
}

type RevealProps = {
  children: ReactNode;
  /** Extra entrance delay in ms, for staggering sibling blocks. */
  delay?: number;
  /** Viewport entry ratio (0-1) that triggers the reveal. */
  threshold?: number;
  className?: string;
  style?: CSSProperties;
  /** Element to render — keep the semantic tag, change only the motion. */
  as?: ElementType;
  /** Skip the observer and reveal as soon as the client mounts. */
  immediate?: boolean;
};

/**
 * Block entrance: `y: 24 -> 0` with a fade, ~700ms ease-out, triggered on
 * viewport entry.
 */
export function Reveal({
  children,
  delay = 0,
  threshold = 0.15,
  className,
  style,
  as: Tag = 'div',
  immediate = false,
}: RevealProps) {
  const { ref, state } = useRevealState({ threshold, disabled: immediate });

  // `immediate` still animates, it just does not wait for the viewport.
  useEffect(() => {
    if (!immediate) return;
    if (prefersReducedMotion()) return;
    const timer = window.setTimeout(() => ref.current?.setAttribute('data-state', IN), 0);
    return () => window.clearTimeout(timer);
  }, [immediate, ref]);

  return (
    <Tag
      ref={ref}
      data-state={immediate ? undefined : state}
      className={className ? `${styles.reveal} ${className}` : styles.reveal}
      style={{ ...style, ['--ak-reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

type BlurRevealProps = {
  /** Plain text/plain-inline nodes. Split into words for the stagger. */
  children: string;
  /** Per-word stagger in ms. */
  stagger?: number;
  threshold?: number;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
  /** Reveal on mount instead of on viewport entry (hero headlines). */
  immediate?: boolean;
};

/**
 * Word-by-word blur reveal. Each word travels `blur(10px) -> blur(0)`,
 * `opacity 0 -> 1`, `y 20 -> 0` on a ~100ms stagger.
 *
 * The words are real inline spans separated by real space text nodes, so
 * `textContent`, copy/paste and screen readers still see one normal
 * sentence — the flex `column-gap` supplies the visual spacing.
 */
export function BlurReveal({
  children,
  stagger = BLUR_REVEAL_STAGGER_MS,
  threshold = 0.15,
  className,
  style,
  as: Tag = 'span',
  immediate = false,
}: BlurRevealProps) {
  const { ref, state } = useRevealState({ threshold, disabled: immediate });
  const words = String(children).split(/\s+/).filter(Boolean);

  useEffect(() => {
    if (!immediate) return;
    if (prefersReducedMotion()) return;
    const timer = window.setTimeout(() => ref.current?.setAttribute('data-state', IN), 0);
    return () => window.clearTimeout(timer);
  }, [immediate, ref]);

  return (
    <Tag
      ref={ref}
      data-state={immediate ? undefined : state}
      className={className ? `${styles.words} ${className}` : styles.words}
      style={{ ...style, ['--ak-word-stagger' as string]: `${stagger}ms` }}
    >
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          {index > 0 ? ' ' : null}
          <span
            className={styles.word}
            style={{ ['--ak-word-index' as string]: index }}
          >
            {word}
          </span>
        </Fragment>
      ))}
    </Tag>
  );
}

export { REVEAL_MS, SAFETY_TIMEOUT_MS };
