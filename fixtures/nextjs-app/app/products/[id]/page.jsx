'use client';
import { useParams } from 'next/navigation';
import { useData } from '../../_components/useData';

// Dynamic segment: /products/:id, filled from .qagent/test-data.local.json
export default function Product() {
  const { id } = useParams();
  const { loading, data } = useData(`/api/items/${id}`);
  if (loading) return <div className="spinner" />;
  return (
    <article>
      <h1>{data.name}</h1>
      <p>Item {data.id}</p>
    </article>
  );
}
