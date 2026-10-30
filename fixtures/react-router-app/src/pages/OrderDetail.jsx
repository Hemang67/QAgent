import { useParams } from 'react-router-dom';
import { useData } from '../useData';

// Needs a record ID: /orders/:orderId, filled from .qagent/test-data.local.json
export default function OrderDetail() {
  const { orderId } = useParams();
  const { loading, data } = useData(`/orders/${orderId}`);
  if (loading) return <div className="spinner" />;
  return (
    <article>
      <h1>Order {data?.id}</h1>
      <p>Customer: {data?.customer}</p>
    </article>
  );
}
