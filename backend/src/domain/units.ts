export const METERS_PER_MILE = 1609.344;
export const KM_PER_MILE = METERS_PER_MILE / 1000;
export const LITERS_PER_GALLON = 3.785411784;

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

/** Edge 3 of CLAUDE.md's three conversion edges: the API's `?units=metric` toggle. */
export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function litersToGallons(liters: number): number {
  return liters / LITERS_PER_GALLON;
}

export function gallonsToLiters(gallons: number): number {
  return gallons * LITERS_PER_GALLON;
}

const UNIT_NUMBER_PATTERN = /^\d{3,4}$/;

/**
 * D18 (supersedes D6): unit_number is text, stored exactly as the fleet
 * writes it — never computed or padded. The real roster runs 031...073 and
 * 101, 1012...1023, so a fixed-width pad would either truncate a 4-digit
 * unit or fail to distinguish '031' from a raw '31'. This validates and
 * normalises (trims whitespace) for display; it does not reformat.
 */
export function formatUnitNumber(unitNumber: string): string {
  const trimmed = unitNumber.trim();
  if (!UNIT_NUMBER_PATTERN.test(trimmed)) {
    throw new Error(`invalid unit number: ${JSON.stringify(unitNumber)}`);
  }
  return trimmed;
}

const ALL_DIGITS = /^\d+$/;

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, "");
}

/**
 * Whether a unit as entered at the pump is the same truck as a roster
 * `unit_number` (A10): `50` is `050`. Both are trimmed; when both are all
 * digits their leading zeros are ignored (an all-zero value stays `0`), and
 * anything else compares exactly. Compares only — `unit_raw` and
 * `unit_number` are stored as written (D18).
 */
export function sameUnit(entered: string, unitNumber: string): boolean {
  const a = entered.trim();
  const b = unitNumber.trim();
  if (ALL_DIGITS.test(a) && ALL_DIGITS.test(b)) {
    return stripLeadingZeros(a) === stripLeadingZeros(b);
  }
  return a === b;
}
