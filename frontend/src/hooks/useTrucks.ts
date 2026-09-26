import { listTrucks } from "../lib/api";
import { useApiResource } from "./useApiResource";

/**
 * `GET /trucks` with no `period` (D23) — the real 27-unit fleet roster, each
 * row carrying its own mpg/tank spec (T-56). The only truck picker in the
 * app: New Plan's truck field and Dev Tools' spec preview both read this.
 */
export function useTrucks() {
  const { data, loading, error, refetch } = useApiResource(listTrucks);
  return { trucks: data?.rows ?? [], loading, error, refetch };
}
