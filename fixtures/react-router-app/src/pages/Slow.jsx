import OrdersTable from '../OrdersTable';
import { useData } from '../useData';

// Its API takes 3.5 s (Performance must fail it with this fixture's budgets)
export default function Slow() {
  const { loading, data } = useData('/slow');
  return (
    <section>
      <h1>Slow</h1>
      {loading ? <div className="spinner" /> : <OrdersTable rows={data} />}
    </section>
  );
}
