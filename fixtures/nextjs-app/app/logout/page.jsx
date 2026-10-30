'use client';
import { useEffect } from 'react';

export default function Logout() {
  useEffect(() => {
    fetch('/api/logout', { method: 'POST' }).then(() => (window.location.href = '/login'));
  }, []);
  return <p>Signing out…</p>;
}
