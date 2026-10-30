import { useEffect } from 'react';
import { api } from '../api';

// Writes on page load: QAgent blocks the POST and warns; the page still passes
export default function Audit() {
  useEffect(() => {
    api('/audit', { method: 'POST', body: '{}' }).catch(() => {});
  }, []);
  return (
    <section>
      <h1>Audit</h1>
      <p>Audit trail</p>
    </section>
  );
}
