import { useData } from '../useData';

// Its API returns 500: QAgent must fail this page
export default function Reports() {
  const { loading, error } = useData('/broken');
  if (loading) return <div className="spinner" />;
  return (
    <section>
      <h1>Reports</h1>
      <p>No data found</p>
      {error && <small>{error}</small>}
    </section>
  );
}
