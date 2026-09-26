interface EmptyStateProps {
  title: string;
  detail?: string;
}

/**
 * UI-DATA-CONTRACT §8's three empty states — no recent trips, no candidates
 * in corridor, no price sheet imported — share this one block instead of
 * three near-identical bits of inline JSX.
 */
export default function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      {detail && <p className="empty-state-detail">{detail}</p>}
    </div>
  );
}
