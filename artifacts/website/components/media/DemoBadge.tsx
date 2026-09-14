export function DemoBadge({ label = "Demo" }: { label?: string }) {
  return <span className="demo-badge">{label}</span>;
}
