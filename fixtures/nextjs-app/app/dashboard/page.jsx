'use client';
import Link from 'next/link';
import { useData } from '../_components/useData';

export default function Dashboard() {
  const { loading, data } = useData('/api/items');
  return (
    <section>
      <h1>Dashboard</h1>
      {loading ? (
        <div className="spinner" />
      ) : (
        <ul>
          {data.map((i) => (
            <li key={i.id}>
              <Link href={`/products/${i.id}`}>{i.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
