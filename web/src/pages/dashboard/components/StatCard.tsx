export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dash-stat-card">
      <div className="dash-stat-card-value">{value}</div>
      <div className="dash-stat-card-label">{label}</div>
    </div>
  )
}
