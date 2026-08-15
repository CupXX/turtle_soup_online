type AdminKeyPoint = { ordinal: number; content: string };

export function AdminKeyPoints({ keyPoints }: { keyPoints: AdminKeyPoint[] }) {
  return (
    <section className="admin-card status-card" aria-labelledby="admin-key-points-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">判定调试</p>
          <h2 id="admin-key-points-title">已提取的关键点</h2>
        </div>
        <span className="status-pill status-ready">只读</span>
      </div>
      <ol className="admin-key-points-list">
        {keyPoints.map((keyPoint) => (
          <li key={keyPoint.ordinal}>
            <span className="admin-key-point-ordinal">KP{keyPoint.ordinal}</span>
            <span>{keyPoint.content}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
