import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectAdapter } from '../src/adapters';
import { dotnetRoutes } from '../src/adapters/dotnet';

const ROUTES = path.resolve(__dirname, '..', 'fixtures', 'routes');
const RUNNABLE = ['flask-app', 'dotnet-app'].map((d) => path.resolve(__dirname, '..', 'fixtures', d));

// Every fixture with expected-routes.json: the right adapter, every page, the right file
const fixtures = [...fs.readdirSync(ROUTES).map((d) => path.join(ROUTES, d)), ...RUNNABLE].filter((d) => fs.existsSync(path.join(d, 'expected-routes.json')));

describe.each(fixtures.map((d) => [path.basename(d), d]))('%s', (_name, dir) => {
  const want = JSON.parse(fs.readFileSync(path.join(dir, 'expected-routes.json'), 'utf8'));
  const adapter = detectAdapter(dir);

  it(`is detected as ${want.adapter}`, () => {
    expect(adapter.id).toBe(want.adapter);
  });

  it('finds every page, and only pages, with its source file', () => {
    const got = Object.fromEntries(adapter.routes(dir).map((r) => [r.path, r.file ?? null]));
    expect(got).toEqual(want.routes);
  });

  if (want.start) {
    it('knows how to start it locally', () => {
      const s = adapter.startCommand(dir)!;
      expect(s.url).toBe(want.start);
      if (want.startCommand) expect(s.command).toBe(want.startCommand);
    });
  }
  if (want.envs) {
    it('reads the environment URLs', () => {
      const envs = adapter.environments(dir);
      for (const [env, v] of Object.entries<Record<string, string>>(want.envs)) expect(envs[env as 'local']).toMatchObject(v);
    });
  }
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-fw-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('.NET Blazor', () => {
  it('reads @page directives from .razor components, one or more per file', () => {
    fs.writeFileSync(path.join(tmp, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web" />');
    fs.mkdirSync(path.join(tmp, 'Components', 'Pages'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Components', 'Pages', 'Counter.razor'), '@page "/counter"\n@page "/counter/{start:int}"\n<h1>Counter</h1>');
    fs.writeFileSync(path.join(tmp, 'Components', 'Pages', 'Home.razor'), '@page "/"\n<h1>Home</h1>');
    fs.writeFileSync(path.join(tmp, 'Components', 'Layout.razor'), '<div>@Body</div>');
    expect(dotnetRoutes(tmp).map((r) => r.path)).toEqual(['/', '/counter', '/counter/:start']);
  });
});
