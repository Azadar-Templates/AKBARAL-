/** next/navigation outside Next: the pathname under audit, inert router. */
export function usePathname() { return globalThis.RESPONSIVE_PATHNAME || '/'; }
export function useSearchParams() { return new URLSearchParams(); }
export function useParams() { return {}; }
export function useRouter() {
  return { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
}
export function redirect() {}
export function notFound() {}
