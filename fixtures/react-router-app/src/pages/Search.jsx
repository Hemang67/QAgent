import OrdersTable from '../OrdersTable';
import { useData } from '../useData';

// Reads data with POST; allowed through readOnlyAllow in .qagent.json
export default function Search() {
  const { loading, data, error } = useData('/search', { method: 'POST', body: JSON.stringify({ q: '' }) });
  if (loading) return <div className="spinner" />;
  return (
    <section>
      <h1>Search</h1>
      {error ? <p>No results found</p> : <OrdersTable rows={data} />}
    </section>
  );
}
