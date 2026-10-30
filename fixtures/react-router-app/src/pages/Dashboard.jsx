import OrdersTable from '../OrdersTable';
import { useData } from '../useData';

export default function Dashboard() {
  const { loading, data } = useData('/orders');
  return (
    <section>
      <h1>Dashboard</h1>
      {loading ? <div className="spinner">Loading</div> : <OrdersTable rows={data} />}
    </section>
  );
}
