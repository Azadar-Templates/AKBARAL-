// Minimal ambient types for the jsdom dashboard harness
// (dashboard-session.test.ts). jsdom ships no bundled types; declaring the
// small surface the suite uses keeps the tests dependency-free.
declare module 'jsdom' {
  interface JSDOMOptions {
    url?: string;
    runScripts?: string;
    pretendToBeVisual?: boolean;
    beforeParse?: (window: Window) => void;
  }
  class JSDOM {
    constructor(html: string, options?: JSDOMOptions);
    readonly window: Window;
  }
}
