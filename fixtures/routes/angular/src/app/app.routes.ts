import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'orders', loadComponent: () => import('./orders/orders.component').then((m) => m.OrdersComponent) },
  { path: 'orders/:id', loadComponent: () => import('./orders/order-detail.component').then((m) => m.OrderDetailComponent) },
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'legacy', redirectTo: 'orders', pathMatch: 'full' },
  { path: '**', loadComponent: () => import('./not-found.component').then((m) => m.NotFoundComponent) },
];
