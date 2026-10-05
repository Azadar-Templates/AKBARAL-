import { createElement } from 'react';
/** next/link outside Next: the same anchor, same href. */
export default function Link({ href, children, ...rest }) {
  return createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children);
}
