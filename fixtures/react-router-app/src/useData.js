import { useEffect, useState } from 'react';
import { api } from './api';

// Loads data once; the page shows a spinner while loading
export const useData = (path, options) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    api(path, options)
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error: String(error) }));
  }, [path]);
  return state;
};
