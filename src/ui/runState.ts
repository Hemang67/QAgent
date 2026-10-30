import { useEffect, useReducer } from 'react';
import type { RunEvent } from '../shared/ipc';
import type { EngineMessage, EnvName, PageResult, TestType } from '../shared/types';
import { api } from './api';

export interface JobProgress {
  env: EnvName;
  type: TestType;
  total: number;
  pages: { route: string; step: Extract<EngineMessage, { kind: 'page' }>['step']; part?: string; result: PageResult; reason: string; file?: string; at: number }[];
  status?: PageResult;
  counts?: Record<PageResult, number>;
}

export interface RunState {
  status: 'idle' | 'running' | 'done';
  root: string | null;
  jobs: JobProgress[];
  log: string[];
  localLog: string;
  errors: string[];
  workbook?: { file: string; sheets: string[] };
  fallback?: { dir: string; error: string };
  ok?: boolean;
  cancelled?: boolean;
  cancelling?: boolean;
  /** Pages being tested right now */
  active: { env: EnvName; type: TestType; route: string; since: number }[];
  startedAt: number | null;
  endedAt: number | null;
}

export const initialRun: RunState = { status: 'idle', root: null, jobs: [], log: [], localLog: '', errors: [], active: [], startedAt: null, endedAt: null };

type Action = RunEvent | { kind: 'begin'; root: string } | { kind: 'cancelling' } | { kind: 'reset' };

const jobKey = (env: string, type: string) => `${env}:${type}`;

const reducer = (s: RunState, e: Action): RunState => {
  const updateJob = (env: EnvName, type: TestType, fn: (j: JobProgress) => JobProgress) => {
    const exists = s.jobs.some((j) => jobKey(j.env, j.type) === jobKey(env, type));
    const jobs = exists ? s.jobs : [...s.jobs, { env, type, total: 0, pages: [] }];
    return jobs.map((j) => (jobKey(j.env, j.type) === jobKey(env, type) ? fn(j) : j));
  };
  switch (e.kind) {
    case 'begin':
      return { ...initialRun, status: 'running', root: e.root, startedAt: Date.now() };
    case 'page-start':
      return { ...s, active: [...s.active, { env: e.env, type: e.type, route: e.route, since: Date.now() }] };
    case 'reset':
      return initialRun;
    case 'cancelling':
      return { ...s, cancelling: true };
    case 'log':
      return { ...s, log: [...s.log, e.text] };
    case 'local-log':
      return { ...s, localLog: (s.localLog + e.text).slice(-20000) };
    case 'job-start':
      return { ...s, jobs: updateJob(e.env, e.type, (j) => ({ ...j, total: e.pages })) };
    case 'page': {
      // The finished page leaves the "testing now" list (first match: the same route may run in two jobs)
      // CRUD reports four rows for one started screen: only its last phase ends it
      const ends = e.step !== 'crud' || /^delete/.test(e.part ?? '');
      const i = ends ? s.active.findIndex((a) => a.env === e.env && a.type === e.type && a.route === e.route) : -1;
      const active = i < 0 ? s.active : [...s.active.slice(0, i), ...s.active.slice(i + 1)];
      const page = { route: e.route, step: e.step, part: e.part, result: e.result, reason: e.reason, file: e.file, at: Date.now() };
      return { ...s, active, jobs: updateJob(e.env, e.type, (j) => ({ ...j, total: Math.max(j.total, e.total), pages: [...j.pages, page] })) };
    }
    case 'job-end':
      return {
        ...s,
        active: s.active.filter((a) => !(a.env === e.env && a.type === e.type)),
        jobs: updateJob(e.env, e.type, (j) => ({ ...j, status: e.status, counts: e.counts })),
      };
    case 'workbook':
      return { ...s, workbook: { file: e.file, sheets: e.sheets } };
    case 'fallback':
      return { ...s, fallback: { dir: e.dir, error: e.error } };
    case 'error':
      return { ...s, errors: [...s.errors, e.text] };
    case 'run-ended':
      return { ...s, status: 'done', ok: e.ok, cancelled: e.cancelled, cancelling: false, active: [], endedAt: Date.now() };
    default:
      return s;
  }
};

/** Run progress lives at the app level so it survives switching screens. */
export const useRunState = () => {
  const [state, dispatch] = useReducer(reducer, initialRun);
  useEffect(() => api.onRunEvent((e) => dispatch(e)), []);
  return [state, dispatch] as const;
};
