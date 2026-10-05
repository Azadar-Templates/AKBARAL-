/** A CSS-module stand-in: `styles.foo` resolves to the literal class name "foo",
 *  which matches the selectors in the SOURCE .module.css files the audit loads. */
export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });
