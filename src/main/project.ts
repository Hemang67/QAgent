import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../schemas/qagent.schema.json';
import { findSideEffectEndpoints } from '../planner/side-effects';
import { inspectProject } from '../planner/plan';
import { readTestData, writeConfig, type QAgentConfig } from '../shared/config';
import type { ProjectView, ValidationResult } from '../shared/ipc';
import { ENV_NAMES, type EnvName } from '../shared/types';

const GITIGNORE_ENTRIES = ['qagent-results.xlsx', '.qagent/'];

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv, ['uri']);
const check = ajv.compile(schema);

export const validateConfig = (config: unknown): ValidationResult => {
  if (check(config)) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: (check.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}${e.params && 'additionalProperty' in e.params ? `: ${e.params.additionalProperty}` : ''}`),
  };
};

const gitignoreReady = (root: string) => {
  try {
    const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    return GITIGNORE_ENTRIES.every((e) => lines.includes(e) || lines.includes(`/${e}`));
  } catch {
    return false;
  }
};

export const addGitignore = (root: string) => {
  const file = path.join(root, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  const missing = GITIGNORE_ENTRIES.filter((e) => !lines.includes(e) && !lines.includes(`/${e}`));
  if (!missing.length) return;
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${sep}\n# QAgent: results and per-machine record IDs\n${missing.join('\n')}\n`, 'utf8');
};

export const projectView = (root: string): ProjectView => {
  const info = inspectProject(root);
  const testDataKeys: ProjectView['testDataKeys'] = {};
  for (const env of ENV_NAMES as EnvName[]) {
    const keys = Object.entries(readTestData(root, env)).filter(([, v]) => v !== null && v !== '').map(([k]) => k);
    if (keys.length) testDataKeys[env] = keys;
  }
  const resultsFile = path.resolve(root, info.config.results?.file ?? 'qagent-results.xlsx');
  return {
    root,
    name: info.name,
    framework: info.framework,
    hasConfig: fs.existsSync(path.join(root, '.qagent.json')),
    config: info.config,
    routes: info.routes,
    urls: info.urls,
    localStart: info.localStart,
    endpointCandidates: findSideEffectEndpoints(root, info.routes.map((r) => r.path), info.config.blockedEndpoints ?? []),
    testDataKeys,
    gitignoreReady: gitignoreReady(root),
    resultsFile,
    resultsExists: fs.existsSync(resultsFile),
  };
};

export const saveProjectConfig = (root: string, config: QAgentConfig, withGitignore?: boolean): ValidationResult => {
  const v = validateConfig(config);
  if (!v.ok) return v;
  writeConfig(root, config);
  if (withGitignore) addGitignore(root);
  return v;
};
