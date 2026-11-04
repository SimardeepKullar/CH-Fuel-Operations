import { readdirSync } from "node:fs";

export interface ParityResult {
  ok: boolean;
  /** In migrations/synthetic but not in migrations/real. */
  missingInReal: string[];
  /** In migrations/real but not in migrations/synthetic. */
  missingInSynthetic: string[];
}

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

/**
 * The two migration sets must hold the same filenames — only 0005's contents
 * differ — so a migration added to one and forgotten in the other is caught.
 */
export function checkMigrationParity(syntheticDir: string, realDir: string): ParityResult {
  const synthetic = sqlFiles(syntheticDir);
  const real = sqlFiles(realDir);
  const missingInReal = synthetic.filter((file) => !real.includes(file));
  const missingInSynthetic = real.filter((file) => !synthetic.includes(file));
  return { ok: missingInReal.length === 0 && missingInSynthetic.length === 0, missingInReal, missingInSynthetic };
}

export function assertMigrationParity(syntheticDir: string, realDir: string): void {
  const result = checkMigrationParity(syntheticDir, realDir);
  if (result.ok) return;
  const lines = [
    ...result.missingInReal.map((file) => `${file} is in migrations/synthetic but not migrations/real`),
    ...result.missingInSynthetic.map((file) => `${file} is in migrations/real but not migrations/synthetic`),
  ];
  throw new Error(`migrations/synthetic and migrations/real must have identical filenames:\n  ${lines.join("\n  ")}`);
}
