import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// antd's responsive components read matchMedia, which jsdom does not implement.
// Without this, any Table with `responsive` columns throws on render.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// antd v6 measures scrollbar width on mount; jsdom reports 0 for every layout
// box, which is fine, but ResizeObserver must at least exist.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
