import { useEffect, useState } from 'react';
import { api } from '../api';

// A simple master-data screen for CRUD: add, edit and delete colours
export default function Colors() {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null); // { id?, name }
  const load = () => api('/colors').then(setRows);
  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    const body = JSON.stringify({ name: form.name });
    if (form.id) await api(`/colors/${form.id}`, { method: 'PUT', body });
    else await api('/colors', { method: 'POST', body });
    setForm(null);
    load();
  };
  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.name}?`)) return;
    await api(`/colors/${row.id}`, { method: 'DELETE' });
    load();
  };

  if (!rows) return <div className="spinner" />;
  return (
    <section>
      <h1>Colours</h1>
      <button onClick={() => setForm({ name: '' })}>Add colour</button>
      {form && (
        <form onSubmit={save}>
          <label>
            Colour name <input name="colorName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <button type="submit">Save</button>
        </form>
      )}
      <table>
        <thead>
          <tr><th>Name</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                <button aria-label={`Edit ${r.name}`} onClick={() => setForm({ id: r.id, name: r.name })}>Edit</button>
                <button aria-label={`Delete ${r.name}`} onClick={() => remove(r)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
