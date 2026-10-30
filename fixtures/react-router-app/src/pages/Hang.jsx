import { useEffect } from 'react';
import { api } from '../api';

// Its API call never answers
export default function Hang() {
  useEffect(() => {
    api('/hang').catch(() => {});
  }, []);
  return (
    <section>
      <h1>Hang</h1>
      <p>Waiting for data</p>
    </section>
  );
}
