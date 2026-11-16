import { useEffect, useMemo, useState } from 'react';
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
  // Where a run opens a record when no ID is set: read from the project's code
  const finding = project.config.findRecords !== false;
  const [sources, setSources] = useState<Record<string, { route: string; file: string }[]> | null>(null);
  useEffect(() => {
    setSources(null);
    if (finding && project.routes.some((r) => r.params.length)) api.recordSources(project.root).then(setSources, () => setSources({}));
  }, [project.root, project.routes, finding]);
  const unset = (route: string, params: string[]) => envs.some((e) => params.some((p) => !project.testDataKeys[e]?.includes(keyFor(route, p))));

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
                    <td className="muted nowrap">{HOW[r.source]}</td>
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
                      {finding && r.params.length > 0 && unset(r.path, r.params) && (
                        <div className="small muted" style={{ marginTop: 4 }}>
                          {!sources ? (
                            'Looking in the code for the pages that open it…'
                          ) : sources[r.path]?.length ? (
                            <span title={sources[r.path].map((s) => `${s.route}: ${s.file}`).join('\n')}>Without an ID, a run opens the first record on {sources[r.path].map((s) => s.route).join(', ')}</span>
                          ) : (
                            'No page in the code opens it with an ID: a run tries the first row of the lists it tests'
                          )}
                        </div>
                      )}
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
