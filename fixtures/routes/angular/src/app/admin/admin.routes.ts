import { Routes } from '@angular/router';
import { UsersComponent } from './users.component';
export const ADMIN_ROUTES: Routes = [
  { path: 'users', component: UsersComponent },
  { path: 'audit', loadComponent: () => import('./audit.component').then((m) => m.AuditComponent) },
];
