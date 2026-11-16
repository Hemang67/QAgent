import { useSearchParams } from 'react-router-dom';

// Needs ?invoiceId=…, and no page leads to one: QAgent reports it unverified (missing-test-data)
export default function Invoice() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('invoiceId');
  return (
    <article>
      <h1>Invoice {id}</h1>
    </article>
  );
}
