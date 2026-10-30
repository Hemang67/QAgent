import type { EnvName, RouteInfo } from '../shared/types';

export interface DetectedEnv {
  url?: string;
  apiUrl?: string;
  /** File the URL was read from, shown in setup */
  from?: string;
}

/**
 * One framework. Adding a framework = one folder implementing these four
 * functions plus a fixture app.
 */
export interface Adapter {
  id: string;
  label: string;
  /** True when the project's marker files say it is this framework */
  detect(root: string): boolean;
  /** Command and URL that start the app locally */
  startCommand(root: string): { command: string; url: string } | null;
  environments(root: string): Partial<Record<EnvName, DetectedEnv>>;
  routes(root: string): RouteInfo[];
}
