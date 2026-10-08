"use client";

import * as React from "react";

type RevealProps = {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  as?: React.ElementType;
  threshold?: number;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Reveal({
  children,
  className,
  style,
  delay = 0,
  as: Tag = "div",
  threshold = 0.15,
}: RevealProps) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const node = ref.current;
    if (!node) return;

    const timer = window.setTimeout(() => setShown(true), 1200);

    if (typeof IntersectionObserver === "undefined") {
      window.clearTimeout(timer);
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
          window.clearTimeout(timer);
        }
      },
      { threshold },
    );
    io.observe(node);

    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [threshold]);

  return React.createElement(
    Tag,
    {
      ref: ref as never,
      className,
      style: {
        opacity: 1,
        transform: shown ? "none" : "translateY(24px)",
        transition: "opacity 700ms ease-out, transform 700ms ease-out",
        transitionDelay: `${delay}ms`,
        ...style,
      },
    },
    children,
  );
}

type BlurRevealProps = {
  text: string;
  className?: string;
  align?: "center" | "left";
  delay?: number;
  threshold?: number;
};

export function BlurReveal({
  text,
  className,
  align = "center",
  delay = 0,
  threshold = 0.15,
}: BlurRevealProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState(false);
  const words = React.useMemo(() => text.split(" "), [text]);

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const node = ref.current;
    if (!node) return;

    const timer = window.setTimeout(() => setShown(true), 1200);

    if (typeof IntersectionObserver === "undefined") {
      window.clearTimeout(timer);
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
          window.clearTimeout(timer);
        }
      },
      { threshold },
    );
    io.observe(node);

    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [threshold]);

  return React.createElement(
    "div",
    {
      ref,
      className,
      style: {
        display: "flex",
        flexWrap: "wrap",
        rowGap: "0.1em",
        justifyContent: align === "center" ? "center" : "flex-start",
      },
    },
    words.map((word, i) =>
      React.createElement(
        "span",
        {
          key: `${word}-${i}`,
          style: {
            display: "inline-block",
            marginRight: "0.28em",
            opacity: 1,
            filter: shown ? "blur(0px)" : "blur(10px)",
            transform: shown ? "none" : "translateY(20px)",
            transition:
              "opacity 700ms ease-out, filter 700ms ease-out, transform 700ms ease-out",
            transitionDelay: `${delay + i * 100}ms`,
          },
        },
        word,
      ),
    ),
  );
}

export default Reveal;
