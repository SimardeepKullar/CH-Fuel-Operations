/**
 * A stand-in for `maplibre-gl` in component tests. MapLibre needs WebGL,
 * which jsdom has none of, so tests mock the module with this and assert on
 * what the component handed it — sources, layers, handlers, camera calls —
 * rather than on pixels. Whether tiles actually load and draw is checked in
 * a real browser (see the T-22 PR), not here.
 *
 * Usage:
 *   vi.mock("maplibre-gl", async () => (await import("../map/testing/fakeMaplibre")).fakeMaplibreModule);
 *   const map = lastMap();
 */

type Handler = (event?: unknown) => void;

interface Registered {
  event: string;
  layerId: string | null;
  handler: Handler;
}

export class FakeMap {
  readonly options: Record<string, unknown>;
  readonly handlers: Registered[] = [];
  readonly sources = new Map<string, { spec: Record<string, unknown>; data: unknown; setData: (d: unknown) => void }>();
  readonly layers: Array<Record<string, unknown>> = [];
  readonly layout = new Map<string, Record<string, unknown>>();
  readonly fitBoundsCalls: Array<{ bounds: unknown; options: unknown }> = [];
  readonly controls: unknown[] = [];
  removed = false;
  resizeCalls = 0;
  canvasCursor = "";
  private loaded = false;

  constructor(options: Record<string, unknown>) {
    if (failNextConstruction) {
      failNextConstruction = false;
      throw new Error("Failed to initialize WebGL");
    }
    this.options = options;
    instances.push(this);
  }

  on(event: string, layerOrHandler: string | Handler, maybeHandler?: Handler): this {
    if (typeof layerOrHandler === "function") {
      this.handlers.push({ event, layerId: null, handler: layerOrHandler });
    } else {
      this.handlers.push({ event, layerId: layerOrHandler, handler: maybeHandler! });
    }
    return this;
  }

  /** Test driver: fire an event as MapLibre would. `layerId` targets a layer-scoped handler. */
  fire(event: string, payload?: unknown, layerId: string | null = null): void {
    if (event === "style.load") this.loaded = true;
    for (const h of this.handlers) {
      if (h.event === event && h.layerId === layerId) h.handler(payload);
    }
  }

  isStyleLoaded(): boolean {
    return this.loaded;
  }

  addControl(control: unknown): this {
    this.controls.push(control);
    return this;
  }

  addSource(id: string, spec: Record<string, unknown>): this {
    const source = {
      spec,
      data: spec.data,
      setData: (d: unknown) => {
        source.data = d;
      },
    };
    this.sources.set(id, source);
    return this;
  }

  getSource(id: string) {
    return this.sources.get(id);
  }

  addLayer(layer: Record<string, unknown>): this {
    this.layers.push(layer);
    this.layout.set(layer.id as string, { ...((layer.layout as Record<string, unknown>) ?? {}) });
    return this;
  }

  getLayer(id: string) {
    return this.layers.find((l) => l.id === id);
  }

  setLayoutProperty(layerId: string, name: string, value: unknown): this {
    this.layout.get(layerId)![name] = value;
    return this;
  }

  getLayoutProperty(layerId: string, name: string): unknown {
    return this.layout.get(layerId)?.[name];
  }

  fitBounds(bounds: unknown, options?: unknown): this {
    this.fitBoundsCalls.push({ bounds, options });
    return this;
  }

  /** A fixed projection: enough for the hover card to be placed somewhere. */
  project(lngLat: [number, number] | { lng: number; lat: number }) {
    const [lng, lat] = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
    return { x: Math.round((lng + 180) * 2), y: Math.round((90 - lat) * 2) };
  }

  getCanvas() {
    const self = this;
    return {
      style: {
        get cursor() {
          return self.canvasCursor;
        },
        set cursor(v: string) {
          self.canvasCursor = v;
        },
      },
      clientWidth: 800,
    };
  }

  resize(): this {
    this.resizeCalls++;
    return this;
  }

  remove(): void {
    this.removed = true;
  }
}

class FakeNavigationControl {
  constructor(readonly options?: unknown) {}
}

const instances: FakeMap[] = [];
let failNextConstruction = false;

/** The next `new Map()` throws, as MapLibre does when WebGL is unavailable. */
export function failNextMapConstruction(): void {
  failNextConstruction = true;
}

export function mapInstances(): FakeMap[] {
  return instances;
}

export function lastMap(): FakeMap {
  const map = instances.at(-1);
  if (!map) throw new Error("no map has been constructed");
  return map;
}

export function resetFakeMaplibre(): void {
  instances.length = 0;
  failNextConstruction = false;
}

export const fakeMaplibreModule = {
  default: { Map: FakeMap, NavigationControl: FakeNavigationControl },
  Map: FakeMap,
  NavigationControl: FakeNavigationControl,
};
