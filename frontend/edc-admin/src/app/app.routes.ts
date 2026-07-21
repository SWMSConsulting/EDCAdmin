import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { Shell } from './shell/shell';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./login/login').then(m => m.Login) },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'catalog', pathMatch: 'full' },
      { path: 'catalog', loadComponent: () => import('./features/catalog/catalog').then(m => m.Catalog) },
      { path: 'assets', loadComponent: () => import('./features/assets/assets').then(m => m.Assets) },
      { path: 'contracts', loadComponent: () => import('./features/contracts/contracts').then(m => m.Contracts) },
      { path: 'transfers', loadComponent: () => import('./features/transfers/transfers').then(m => m.Transfers) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then(m => m.Settings) },
    ],
  },
  { path: '**', redirectTo: '' },
];
