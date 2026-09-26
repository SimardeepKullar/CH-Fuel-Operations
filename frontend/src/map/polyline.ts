/**
 * Decodes Google's encoded-polyline format into GeoJSON `[lng, lat]` pairs.
 *
 * `optimized.polyline` / `baseline.polyline` are the provider's own encoding —
 * precision 5 for ORS `driving-hgv` (routePersistence.ts), the same string the
 * backend decodes in SQL with `ST_LineFromEncodedPolyline`. Written here rather
 * than pulled in as a dependency: the algorithm is fixed, ~20 lines, and
 * checked against Google's published reference vector in polyline.test.ts.
 *
 * Throws on a truncated string rather than returning a partial line — a route
 * drawn short of its destination would look plausible and be wrong.
 */
export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const nextValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error("truncated encoded polyline");
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += nextValue();
    lng += nextValue();
    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}
