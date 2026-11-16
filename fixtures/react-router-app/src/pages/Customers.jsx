import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../routes';
import { api } from '../api';
import { useData } from '../useData';

// A list whose rows open the detail page by click, not by link (like many admin apps).
// QAgent opens the first row to find a customerId for /customer. The select box and
// Delete button are left alone; the delete call would be blocked anyway.
export default function Customers() {
  const navigate = useNavigate();
  const { loading, data } = useData('/customers');
  if (loading) return <div className="spinner" />;
  return (
    <section>
      <h1>Customers</h1>
      <table>
        <thead>
          <tr><th>Select</th><th>ID</th><th>Name</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} onClick={() => navigate(`${ROUTES.customer}?customerId=${c.id}`)}>
              <td><input type="checkbox" aria-label={`Select ${c.name}`} onClick={(e) => e.stopPropagation()} /></td>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>
                <button onClick={(e) => (e.stopPropagation(), api(`/customers/${c.id}`, { method: 'DELETE' }).catch(() => {}))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
