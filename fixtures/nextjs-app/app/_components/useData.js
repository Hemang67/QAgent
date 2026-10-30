'use client';
import { useEffect, useState } from 'react';

// A private folder: the adapter must not report it as a page
export const useData = (url) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error: String(error) }));
  }, [url]);
  return state;
};
