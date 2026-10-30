import { useEffect, useState } from 'react';

// Planted flaws for the security scan: links to server pages with unsafe parameters,
// and an API that answers without a login
export default function Sec() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    fetch('/api/open-orders').then((r) => r.json()).then(setRows);
  }, []);
  return (
    <section>
      <h1>Security lab</h1>
      <a href="/lab/echo?q=hello">Echo</a> <a href="/lab/db?id=1">Record</a> <a href="/go?next=/dashboard">Go</a>
      <p>{rows.length} open orders</p>
    </section>
  );
}
