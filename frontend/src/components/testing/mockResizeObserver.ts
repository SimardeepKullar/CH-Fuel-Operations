/**
 * jsdom has no layout engine and no `ResizeObserver` — every element's
 * `getBoundingClientRect()` is always `0x0`. Recharts' `ResponsiveContainer`
 * reads that rect first (so it renders nothing, per its own "don't render at
 * a non-positive size" guard) and then relies on `ResizeObserver` for the
 * real measurement. This installs a synchronous fake: `observe()` fires the
 * callback immediately with a fixed, positive `contentRect`, so the chart
 * mounts inside the same effect instead of waiting on a browser resize event
 * that jsdom can never produce.
 */
export function installResizeObserverMock(width = 640, height = 240): void {
  class MockResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element): void {
      const entry = { target, contentRect: { width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width } };
      this.callback([entry as ResizeObserverEntry], this as unknown as ResizeObserver);
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
}
