import '@testing-library/jest-dom/vitest';

// jsdom ships no matchMedia, so any component using a responsive hook throws
// on mount. Stub it as "no media query matches" — the desktop layout — which
// is the branch component tests should assert against by default. A test that
// cares about the phone layout can override window.matchMedia itself.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
