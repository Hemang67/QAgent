import { useMemo, useState } from 'react';

// Suggestions shown at once; typing narrows the rest
const SHOWN = 14;

const norm = (p: string) => p.trim().replace(/\/+$/, '').toLowerCase() || '/';

/**
 * The Smoke list: chosen pages as chips with a remove button, and a search box that adds
 * a page found in the code, or any path typed ("/orders/1"). Empty = the top menu pages.
 */
export function SmokePicker({ value, pages, onChange }: { value: string[]; pages: string[]; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => new Set(value.map(norm)), [value]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => pages.filter((p) => !chosen.has(norm(p)) && p.toLowerCase().includes(q)), [pages, chosen, q]);

  // What Enter or Add would add: the page typed exactly, the only match, or a typed path
  const pick = (): string | null => {
    if (!q) return null;
    const exact = pages.find((p) => norm(p) === norm(query));
    if (exact) return chosen.has(norm(exact)) ? null : exact;
    if (matches.length === 1) return matches[0];
    if (query.trim().startsWith('/') && !chosen.has(norm(query))) return query.trim();
    return null;
  };
  const add = (p: string | null) => {
    if (!p) return;
    onChange([...value, p]);
    setQuery('');
  };
  const next = pick();

  return (
    <div className="stack">
      <div className="toggle-group" aria-label="Smoke pages chosen">
        {value.map((p) => (
          <span key={p} className="chip on">
            {p}
            <button className="chip-x" title={`Remove ${p}`} aria-label={`Remove ${p}`} onClick={() => onChange(value.filter((v) => v !== p))}>
              ×
            </button>
          </span>
        ))}
        {!value.length && <span className="muted small">None chosen: Smoke opens the top menu pages it finds on the home page.</span>}
      </div>
      <div className="row">
        <input
          type="text"
          className="grow"
          value={query}
          placeholder="Add a page: type to search, or a path such as /orders"
          aria-label="Add a Smoke page"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(next);
            if (e.key === 'Escape') setQuery('');
          }}
        />
        <button className="btn" disabled={!next} onClick={() => add(next)}>
          Add
        </button>
        {value.length > 0 && (
          <button className="btn link" onClick={() => onChange([])}>
            Remove all
          </button>
        )}
      </div>
      {q && !next && !matches.length && <span className="muted small">No page in the code matches. A path starting with / can be added as typed.</span>}
      {matches.length > 0 && (
        <div className="toggle-group">
          {matches.slice(0, SHOWN).map((p) => (
            <button key={p} className="chip add" title={`Add ${p}`} onClick={() => add(p)}>
              + {p}
            </button>
          ))}
          {matches.length > SHOWN && <span className="muted small">{matches.length - SHOWN} more: type to narrow</span>}
        </div>
      )}
    </div>
  );
}
