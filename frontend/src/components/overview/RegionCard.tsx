"use client";

import Link from "next/link";
import { useState } from "react";
import type { RegionView, Tile } from "../../lib/overviewView";
import Corners from "../Corners";

function Money({ tile, big }: { tile: Tile; big?: boolean }) {
  return (
    <div className={big ? "ov-tile-num ov-big" : "ov-tile-num"}>
      {tile.cc !== "" && <span className="ov-cc">{tile.cc}</span>}
      <span className="ov-num" style={{ color: tile.color }}>
        {tile.value}
      </span>
      {tile.unit !== "" && <span className="ov-unit">{tile.unit}</span>}
    </div>
  );
}

function TileBox({ tile, big }: { tile: Tile; big?: boolean }) {
  return (
    <div className={big ? "ov-tile ov-tile-big" : "ov-tile"} data-testid="ov-tile" data-label={tile.label}>
      <div className="ov-tile-top">
        <span className="ov-tile-label">{tile.label}</span>
      </div>
      <Money tile={tile} big={big} />
      <div className="ov-tile-bottom">
        <span className="ov-tile-sub">
          {tile.sub}
          {tile.link !== null && (
            <Link className="ov-link" href={tile.link.href} data-testid="anomalies-link">
              {tile.link.text}
            </Link>
          )}
        </span>
        <span className="ov-tile-note">{tile.note}</span>
      </div>
    </div>
  );
}

/** One country's card: two big tiles and six small ones, or the absent-side empty state. */
export default function RegionCard({ region: native }: { region: RegionView }) {
  const [caUnits, setCaUnits] = useState(false);
  const alt = native.caUnits ?? null;
  const region = caUnits && alt !== null ? alt : native;
  return (
    <section
      className="ov-card ov-region blueprint"
      style={{ borderTopColor: region.accent }}
      aria-label={region.name}
      data-testid={`${region.side}-panel`}
    >
      <Corners />
      <header className="ov-region-head">
        <span className="ov-region-badge" style={{ background: region.accent }}>
          {region.code}
        </span>
        <div className="ov-region-titles">
          <h2 className="ov-region-name">{region.name}</h2>
          <div className="ov-region-sub">{region.sub}</div>
        </div>
        {native.present && native.side === "us" && (
          <div className="ov-units" role="group" aria-label="Units" data-testid="units-toggle">
            <button type="button" aria-pressed={!caUnits} onClick={() => setCaUnits(false)}>
              US units
            </button>
            <button
              type="button"
              aria-pressed={caUnits}
              disabled={alt === null}
              title={alt === null ? "Enter an exchange rate to convert" : "Show CAD and litres"}
              onClick={() => setCaUnits(true)}
            >
              CA units
            </button>
          </div>
        )}
      </header>
      {region.present ? (
        <>
          <div className="ov-tiles-big">
            {region.big.map((t) => (
              <TileBox key={t.label} tile={t} big />
            ))}
          </div>
          <div className="ov-tiles-small">
            {region.small.map((t) => (
              <TileBox key={t.label} tile={t} />
            ))}
          </div>
        </>
      ) : (
        <div className="ov-absent" data-testid={`${region.side}-not-imported`}>
          <div className="ov-absent-title">{region.absentMessage}</div>
          <div className="ov-absent-text">This side is left out of the combined totals for this week.</div>
          <Link className="ov-link" href="/import">
            Import an invoice →
          </Link>
        </div>
      )}
    </section>
  );
}
