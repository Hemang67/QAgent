import type { Adapter } from './types';
import { angular } from './angular';
import { crawl } from './crawl';
import { dotnet } from './dotnet';
import { laravel } from './laravel';
import { nextjs } from './nextjs';
import { python } from './python';
import { reactRouter } from './react-router';
import { staticSite } from './static';
import { svelte } from './svelte';
import { vue } from './vue';

// Order matters: the most specific marker wins. Laravel (artisan) and .NET (.csproj) come
// first because they often ship a Vue or React front end whose pages are their routes.
// Next.js and Nuxt may also list react-router or vue-router. Python's markers are weaker
// (a requirements.txt can sit next to a React app), so it follows the JS frameworks.
// Setup lets the user pick another adapter (framework in .qagent.json).
export const ADAPTERS: Adapter[] = [laravel, dotnet, nextjs, angular, svelte, vue, reactRouter, python, staticSite, crawl];

export const detectAdapter = (root: string, preferred?: string): Adapter =>
  ADAPTERS.find((a) => a.id === preferred) ?? ADAPTERS.find((a) => a.detect(root)) ?? crawl;

export type { Adapter } from './types';
