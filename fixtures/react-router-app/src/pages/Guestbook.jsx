import { useEffect, useState } from 'react';
import { api } from '../api';

// Planted flaw: saved messages are rendered as raw HTML (stored XSS)
export default function Guestbook() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const load = () => api('/guestbook').then(setRows);
  useEffect(() => {
    load();
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    await api('/guestbook', { method: 'POST', body: JSON.stringify({ message }) });
    setMessage('');
    load();
  };
  return (
    <section>
      <h1>Guestbook</h1>
      <form onSubmit={submit}>
        <label>
          Message <input name="message" value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <button type="submit">Add entry</button>
      </form>
      {rows.map((m, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: m }} />
      ))}
    </section>
  );
}
