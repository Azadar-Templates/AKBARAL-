/**
 * Node module hooks that let the real page components be imported outside of
 * the Next.js runtime, so the responsive harness measures the SAME component
 * tree users get — not a hand-written fixture.
 *
 *  · `*.css` / `*.module.css` → a proxy whose `styles.foo` is the string "foo",
 *    which is exactly the class name used in the SOURCE CSS module files the
 *    audit loads. No hashed-chunk guessing.
 *  · `next/link`              → a plain <a>, same href semantics.
 *  · `next/navigation`        → router hooks backed by RESPONSIVE_PATHNAME.
 *
 * Nothing here is shipped: it exists only for the audit harness.
 */
const stub = (file) => new URL(`./stubs/${file}`, import.meta.url).href;

const STUBS = {
  'next/link': 'next-link.mjs',
  'next/navigation': 'next-navigation.mjs',
  'next/image': 'next-image.mjs',
};

export async function resolve(specifier, context, nextResolve) {
  if (/\.css(\?.*)?$/.test(specifier)) return { url: stub('css-module.mjs'), format: 'module', shortCircuit: true };
  if (STUBS[specifier]) return { url: stub(STUBS[specifier]), format: 'module', shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/\.css(\?.*)?$/.test(url)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'const handler = { get: (_t, key) => (typeof key === "string" ? key : undefined) };\nexport default new Proxy({}, handler);\n',
    };
  }
  return nextLoad(url, context);
}
