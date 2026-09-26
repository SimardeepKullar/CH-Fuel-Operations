import type { Pool } from "pg";
import type { FuelCardRow } from "../db/types.js";

export async function getCardById(pool: Pool, id: string): Promise<FuelCardRow | null> {
  const { rows } = await pool.query<FuelCardRow>("SELECT * FROM fuel_cards WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getCardByNumber(pool: Pool, cardNumber: string): Promise<FuelCardRow | null> {
  const { rows } = await pool.query<FuelCardRow>(
    "SELECT * FROM fuel_cards WHERE card_number = $1",
    [cardNumber],
  );
  return rows[0] ?? null;
}

/** `driver_id` is nullable (A11) — a card between drivers still lists. */
export async function listCards(pool: Pool): Promise<FuelCardRow[]> {
  const { rows } = await pool.query<FuelCardRow>("SELECT * FROM fuel_cards ORDER BY card_number");
  return rows;
}
