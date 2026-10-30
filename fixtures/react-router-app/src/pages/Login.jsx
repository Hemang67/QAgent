import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const nav = useNavigate();
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const body = JSON.stringify(Object.fromEntries(new FormData(e.target)));
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) return setError('Wrong username or password');
    localStorage.setItem('token', (await res.json()).token);
    nav('/dashboard');
  };
  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      <input name="username" placeholder="Username" />
      <input name="password" type="password" placeholder="Password" />
      <button type="submit">Sign in</button>
      {error && <p>{error}</p>}
    </form>
  );
}
