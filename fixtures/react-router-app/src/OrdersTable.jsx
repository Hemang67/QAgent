export default function OrdersTable({ rows }) {
  return (
    <table>
      <thead>
        <tr><th>ID</th><th>Customer</th><th>Status</th></tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}><td>{o.id}</td><td>{o.customer}</td><td>{o.status}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
