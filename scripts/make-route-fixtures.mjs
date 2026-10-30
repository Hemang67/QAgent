// Writes fixtures/routes/<framework>/: small source trees shaped like real projects,
// with expected-routes.json listing the pages each adapter must find. Run once; the
// files are committed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'routes');
const write = (dir, files) => {
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(ROOT, dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text, null, 2) + '\n');
  }
};

write('vue-router', {
  'package.json': { dependencies: { vue: '3.5.0', 'vue-router': '4.4.0' }, scripts: { dev: 'vite' } },
  'src/router/index.js': `import { createRouter, createWebHistory } from 'vue-router';
import Home from '../views/Home.vue';
export const PATHS = { orders: '/orders' };
export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: PATHS.orders, component: () => import('../views/Orders.vue'), children: [{ path: ':id', component: () => import('../views/OrderDetail.vue') }] },
    { path: '/settings', component: () => import('../views/Settings.vue'), children: [{ path: '', component: () => import('../views/SettingsHome.vue') }, { path: 'profile', component: () => import('../views/Profile.vue') }] },
    { path: '/old', redirect: '/orders' },
    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue') },
  ],
});
`,
  ...Object.fromEntries(['Home', 'Orders', 'OrderDetail', 'Settings', 'SettingsHome', 'Profile', 'NotFound'].map((v) => [`src/views/${v}.vue`, `<template><h1>${v}</h1></template>\n`])),
  'expected-routes.json': { adapter: 'vue', routes: { '/': 'src/views/Home.vue', '/orders': 'src/views/Orders.vue', '/orders/:id': 'src/views/OrderDetail.vue', '/settings': 'src/views/Settings.vue', '/settings/profile': 'src/views/Profile.vue' } },
});

write('nuxt', {
  'package.json': { dependencies: { nuxt: '3.13.0' }, scripts: { dev: 'nuxt dev' } },
  'pages/index.vue': '<template><h1>Home</h1></template>\n',
  'pages/about.vue': '<template><h1>About</h1></template>\n',
  'pages/users/index.vue': '<template><h1>Users</h1></template>\n',
  'pages/users/[id].vue': '<template><h1>User</h1></template>\n',
  'pages/blog/[[slug]].vue': '<template><h1>Blog</h1></template>\n',
  'pages/(marketing)/pricing.vue': '<template><h1>Pricing</h1></template>\n',
  'pages/[...slug].vue': '<template><h1>Not found</h1></template>\n',
  'expected-routes.json': { adapter: 'vue', routes: { '/': 'pages/index.vue', '/about': 'pages/about.vue', '/users': 'pages/users/index.vue', '/users/:id': 'pages/users/[id].vue', '/blog/:slug?': 'pages/blog/[[slug]].vue', '/pricing': 'pages/(marketing)/pricing.vue' } },
});

write('angular', {
  'angular.json': { projects: { shop: { architect: { serve: { options: { port: 4300 } } } } } },
  'package.json': { dependencies: { '@angular/core': '19.0.0', '@angular/router': '19.0.0' }, scripts: { start: 'ng serve' } },
  'src/environments/environment.ts': "export const environment = { production: false, apiUrl: 'http://localhost:5000/api' };\n",
  'src/environments/environment.development.ts': "export const environment = { siteUrl: 'https://dev.shop.example', apiUrl: 'https://dev-api.shop.example/api' };\n",
  'src/environments/environment.prod.ts': "export const environment = { siteUrl: 'https://shop.example', apiUrl: 'https://api.shop.example/api' };\n",
  'src/app/app.routes.ts': `import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'orders', loadComponent: () => import('./orders/orders.component').then((m) => m.OrdersComponent) },
  { path: 'orders/:id', loadComponent: () => import('./orders/order-detail.component').then((m) => m.OrderDetailComponent) },
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'legacy', redirectTo: 'orders', pathMatch: 'full' },
  { path: '**', loadComponent: () => import('./not-found.component').then((m) => m.NotFoundComponent) },
];
`,
  'src/app/admin/admin.routes.ts': `import { Routes } from '@angular/router';
import { UsersComponent } from './users.component';
export const ADMIN_ROUTES: Routes = [
  { path: 'users', component: UsersComponent },
  { path: 'audit', loadComponent: () => import('./audit.component').then((m) => m.AuditComponent) },
];
`,
  'src/app/home/home.component.ts': 'export class HomeComponent {}\n',
  'src/app/orders/orders.component.ts': 'export class OrdersComponent {}\n',
  'src/app/orders/order-detail.component.ts': "export class OrderDetailComponent { id = this.route.snapshot.queryParamMap.get('tab'); }\n",
  'src/app/admin/users.component.ts': 'export class UsersComponent {}\n',
  'src/app/admin/audit.component.ts': 'export class AuditComponent {}\n',
  'src/app/not-found.component.ts': 'export class NotFoundComponent {}\n',
  'expected-routes.json': {
    adapter: 'angular',
    start: 'http://localhost:4300',
    envs: { local: { apiUrl: 'http://localhost:5000' }, dev: { url: 'https://dev.shop.example', apiUrl: 'https://dev-api.shop.example' }, live: { url: 'https://shop.example', apiUrl: 'https://api.shop.example' } },
    routes: { '/': 'src/app/home/home.component.ts', '/orders': 'src/app/orders/orders.component.ts', '/orders/:id': 'src/app/orders/order-detail.component.ts', '/admin/users': 'src/app/admin/users.component.ts', '/admin/audit': 'src/app/admin/audit.component.ts' },
  },
});

write('sveltekit', {
  'package.json': { devDependencies: { '@sveltejs/kit': '2.8.0', svelte: '5.0.0' }, scripts: { dev: 'vite dev' } },
  'src/routes/+page.svelte': '<h1>Home</h1>\n',
  'src/routes/+layout.svelte': '<slot />\n',
  'src/routes/orders/+page.svelte': '<h1>Orders</h1>\n',
  'src/routes/orders/[id]/+page.svelte': '<h1>Order</h1>\n',
  'src/routes/orders/[id]/+page.server.js': 'export const load = () => ({});\n',
  'src/routes/(app)/settings/+page.svelte': '<h1>Settings</h1>\n',
  'src/routes/docs/[[lang]]/+page.svelte': '<h1>Docs</h1>\n',
  'src/routes/files/[...path]/+page.svelte': '<h1>Files</h1>\n',
  'src/routes/api/health/+server.js': 'export const GET = () => new Response("ok");\n',
  'expected-routes.json': { adapter: 'svelte', routes: { '/': 'src/routes/+page.svelte', '/orders': 'src/routes/orders/+page.svelte', '/orders/:id': 'src/routes/orders/[id]/+page.svelte', '/settings': 'src/routes/(app)/settings/+page.svelte', '/docs/:lang?': 'src/routes/docs/[[lang]]/+page.svelte' } },
});

write('static', {
  'index.html': '<h1>Home</h1>\n',
  'about.html': '<h1>About</h1>\n',
  'docs/index.html': '<h1>Docs</h1>\n',
  'docs/install.html': '<h1>Install</h1>\n',
  'expected-routes.json': { adapter: 'static', routes: { '/': 'index.html', '/about.html': 'about.html', '/docs': 'docs/index.html', '/docs/install.html': 'docs/install.html' } },
});

write('laravel', {
  'artisan': '#!/usr/bin/env php\n',
  'composer.json': { require: { 'laravel/framework': '^11.0' } },
  '.env': 'APP_NAME=Shop\nAPP_URL=http://shop.test\n',
  'routes/web.php': `<?php
use App\\Http\\Controllers\\OrderController;
use App\\Http\\Controllers\\PhotoController;
use Illuminate\\Support\\Facades\\Route;

Route::get('/', function () { return view('welcome'); });
Route::view('/about', 'pages.about');
Route::get('/orders/{order}', [OrderController::class, 'show']);
Route::post('/orders', [OrderController::class, 'store']);
Route::match(['get', 'post'], '/contact', [OrderController::class, 'contact']);
// Route::get('/commented-out', ...);
Route::resource('photos', PhotoController::class)->only(['index', 'show']);
Route::prefix('admin')->group(function () {
    Route::get('/users', [OrderController::class, 'users']);
    Route::prefix('reports')->group(function () {
        Route::get('/sales/{year?}', [OrderController::class, 'sales']);
    });
});
Route::get('/after-groups', [OrderController::class, 'after']);
`,
  'app/Http/Controllers/OrderController.php': '<?php class OrderController {}\n',
  'app/Http/Controllers/PhotoController.php': '<?php class PhotoController {}\n',
  'resources/views/pages/about.blade.php': '<h1>About</h1>\n',
  'expected-routes.json': {
    adapter: 'laravel',
    envs: { local: { url: 'http://shop.test' } },
    routes: { '/': null, '/about': 'resources/views/pages/about.blade.php', '/orders/:order': 'app/Http/Controllers/OrderController.php', '/contact': 'app/Http/Controllers/OrderController.php', '/photos': 'app/Http/Controllers/PhotoController.php', '/photos/:photo': 'app/Http/Controllers/PhotoController.php', '/admin/users': 'app/Http/Controllers/OrderController.php', '/admin/reports/sales': 'app/Http/Controllers/OrderController.php', '/after-groups': 'app/Http/Controllers/OrderController.php' },
  },
});

write('django', {
  'manage.py': 'import os\n',
  'requirements.txt': 'Django==5.1\n',
  'shop/settings.py': "ROOT_URLCONF = 'shop.urls'\n",
  'shop/urls.py': `from django.contrib import admin
from django.urls import include, path
urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('orders.urls')),
    path('accounts/', include('accounts.urls')),
]
`,
  'orders/urls.py': `from django.urls import path, re_path
from . import views
urlpatterns = [
    path('', views.home, name='home'),
    path('orders/', views.order_list),
    path('orders/<int:pk>/', views.order_detail),
    re_path(r'^legacy/$', views.legacy),
    re_path(r'^archive/(?P<year>[0-9]{4})/$', views.archive),
]
`,
  'orders/views.py': 'def home(r): pass\n',
  'accounts/urls.py': "from django.urls import path\nfrom . import views\nurlpatterns = [path('profile/', views.profile)]\n",
  'accounts/views.py': 'def profile(r): pass\n',
  'expected-routes.json': { adapter: 'python', start: 'http://127.0.0.1:8000', routes: { '/': 'orders/views.py', '/orders': 'orders/views.py', '/orders/:pk': 'orders/views.py', '/legacy': 'orders/views.py', '/accounts/profile': 'accounts/views.py' } },
});

write('fastapi', {
  'requirements.txt': 'fastapi==0.115\njinja2\n',
  'app/main.py': `from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import HTMLResponse
app = FastAPI()
router = APIRouter(prefix="/admin")

@app.get("/", response_class=HTMLResponse)
def home():
    return "<h1>Home</h1>"

@app.get("/api/items")
def items():
    return [1, 2]

@app.get("/orders/{order_id}")
def order(request: Request, order_id: int):
    return templates.TemplateResponse("order.html", {"request": request})

@router.get("/users", response_class=HTMLResponse)
def users():
    return "<h1>Users</h1>"

@app.post("/orders")
def create():
    return {}
`,
  'expected-routes.json': { adapter: 'python', start: 'http://127.0.0.1:8000', startCommand: 'uvicorn app.main:app', routes: { '/': 'app/main.py', '/orders/:order_id': 'app/main.py', '/admin/users': 'app/main.py' } },
});
console.log('Route fixtures written to', ROOT);
