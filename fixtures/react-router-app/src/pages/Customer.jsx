import { useSearchParams } from 'react-router-dom';
import { useData } from '../useData';

// Needs ?customerId=…; no ID is set in test data, so QAgent finds one by opening the first row on /customers
export default function Customer() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('customerId');
  const { loading, data } = useData('/customers');
  if (loading) return <div className="spinner" />;
  return (
    <article>
      <h1>Customer {id}</h1>
      <p>{data.find((c) => String(c.id) === id)?.name ?? 'Unknown'}</p>
    </article>
  );
}
