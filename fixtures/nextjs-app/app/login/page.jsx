'use client';
import { useState } from 'react';

export default function Login() {
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const body = JSON.stringify(Object.fromEntries(new FormData(e.target)));
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) return setError('Wrong email or password');
    window.location.href = '/dashboard';
  };
  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      <input name="email" type="email" placeholder="Email" />
      <input name="password" type="password" placeholder="Password" />
      <button type="submit">Sign in</button>
      {error && <p>{error}</p>}
    </form>
  );
}
