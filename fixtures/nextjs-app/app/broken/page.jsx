'use client';
import { useData } from '../_components/useData';

// Its API returns 500: QAgent must fail this page
export default function Broken() {
  const { loading } = useData('/api/broken');
  if (loading) return <div className="spinner" />;
  return (
    <section>
      <h1>Broken</h1>
      <p>No data found</p>
    </section>
  );
}
