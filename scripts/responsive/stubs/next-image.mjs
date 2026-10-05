import { createElement } from 'react';
/** next/image outside Next: a plain responsive <img>. */
export default function Image({ src, alt = '', ...rest }) {
  return createElement('img', { src: typeof src === 'string' ? src : '', alt, ...rest });
}
