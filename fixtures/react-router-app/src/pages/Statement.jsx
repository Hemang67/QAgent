import { useSearchParams } from 'react-router-dom';

// Needs ?statementId=…, and no page leads to one: QAgent reports it unverified (missing-test-data)
export default function Statement() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('statementId');
  return (
    <article>
      <h1>Statement {id}</h1>
    </article>
  );
}
