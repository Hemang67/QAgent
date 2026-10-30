import { useMemo, useState } from 'react';
import type { ProjectView } from '../../shared/ipc';
import { ENV_LABEL, ENV_NAMES } from '../../shared/types';
import { api } from '../api';
import { FileLink, PageHead } from '../components';
import NewPages from './NewPages';

const HOW: Record<string, string> = { router: 'Router code', filesystem: 'Folder structure', crawl: 'Crawl', config: 'Settings' };

/** Every page QAgent found, how it found it, and which record IDs it still needs. */
export default function Pages({ project, onSaved }: { project: ProjectView; onSaved: () => void }) {
  const [query, setQuery] = useState('');
  const pages = useMemo(() => project.routes.filter((r) => r.path.toLowerCase().includes(query.toLowerCase()) || (r.file ?? '').toLowerCase().includes(query.toLowerCase())), [project.routes, query]);
  const envs = ENV_NAMES.filter((e) => project.urls[e]);
  const keyFor = (route: string, param: string) => project.config.pages?.[route]?.params?.[param.replace(/^\?/, '')] ?? param.replace(/^\?/, '');

  return (
    <div className="page">
      <PageHead title="Pages" subtitle={`${project.routes.length} pages found in ${project.framework} code`}>
        <input type="text" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
      </PageHead>
      <NewPages project={project} onSaved={onSaved} />
      {!project.routes.length && <div className="empty">No pages were found in the code. Each run crawls the site from the home page instead.</div>}
      {project.routes.length > 0 && (
        <div className="card flush">
          <table className="data">
            <thead>
              <tr>
                <th>Page</th>
                <th>Source file</th>
                <th>Found from</th>
                <th>Record IDs needed</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((r) => {
                const skip = project.config.pages?.[r.path]?.skip;
                return (
                  <tr key={r.path}>
                    <td className="mono">
                      {r.path} {skip && <span className="tag" title={skip}>skipped</span>}
                    </td>
                    <td>
                      <FileLink file={r.file} onOpen={(f) => api.openFile(project.root, f)} />
                    </td>
                    <td className="muted">{HOW[r.source]}</td>
                    <td>
                      {r.params.map((p) => {
                        const key = keyFor(r.path, p);
                        return (
                          <div key={p} className="small">
                            <code>{key}</code>{' '}
                            {envs.map((e) => (
                              <span key={e} className="tag" style={{ marginRight: 4, opacity: project.testDataKeys[e]?.includes(key) ? 1 : 0.45 }} title={project.testDataKeys[e]?.includes(key) ? 'Set' : `Missing in .qagent/test-data.${e}.json`}>
                                {ENV_LABEL[e]} {project.testDataKeys[e]?.includes(key) ? '✓' : '–'}
                              </span>
                            ))}
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
