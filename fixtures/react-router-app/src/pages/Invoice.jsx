import { useSearchParams } from 'react-router-dom';

// Needs ?invoiceId=…, opened only by the Invoices button on /customers: QAgent clicks it
export default function Invoice() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('invoiceId');
  return (
    <article>
      <h1>Invoice {id}</h1>
    </article>
  );
}
