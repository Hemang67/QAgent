import { useState } from 'react';
import OrdersTable from '../OrdersTable';
import { useData } from '../useData';

const TabContent = ({ status }) => {
  const { loading, data } = useData(`/orders?status=${status}`);
  return loading ? <div className="spinner" /> : <OrdersTable rows={data} />;
};

// Two tabs, each loading its own data: QAgent opens both
export default function Orders() {
  const [tab, setTab] = useState('open');
  return (
    <section>
      <h1>Orders</h1>
      <div role="tablist">
        {['open', 'closed'].map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-controls={`panel-${t}`} aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'open' ? 'Open' : 'Closed'}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <TabContent key={tab} status={tab} />
      </div>
    </section>
  );
}
