import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

class TestResizeObserver implements ResizeObserver {
  private readonly onResize: EventListener;

  constructor(callback: ResizeObserverCallback) {
    this.onResize = () => callback([], this);
  }

  observe(): void {
    window.addEventListener("resize", this.onResize);
  }

  unobserve(): void {
    window.removeEventListener("resize", this.onResize);
  }

  disconnect(): void {
    window.removeEventListener("resize", this.onResize);
  }
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);

afterEach(cleanup);
