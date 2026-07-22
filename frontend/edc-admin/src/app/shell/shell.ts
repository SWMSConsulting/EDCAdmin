import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { DxDrawerModule } from 'devextreme-angular/ui/drawer';
import { DxToolbarModule } from 'devextreme-angular/ui/toolbar';
import { DxListModule } from 'devextreme-angular/ui/list';
import { AuthService } from '../core/auth.service';

interface NavItem {
  text: string;
  icon: string;
  path: string;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, DxDrawerModule, DxToolbarModule, DxListModule],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private router = inject(Router);
  readonly auth = inject(AuthService);
  readonly drawerOpen = signal(true);

  readonly navItems: NavItem[] = [
    { text: 'Katalog', icon: 'search', path: '/catalog' },
    { text: 'Assets', icon: 'box', path: '/assets' },
    { text: 'Policies', icon: 'key', path: '/policies' },
    { text: 'Vertragsdefinitionen', icon: 'detailslayout', path: '/contract-definitions' },
    { text: 'Verträge', icon: 'file', path: '/contracts' },
    { text: 'Transfers', icon: 'movetofolder', path: '/transfers' },
    { text: 'Einstellungen', icon: 'preferences', path: '/settings' },
  ];

  readonly menuButtonOptions = {
    icon: 'menu',
    stylingMode: 'text',
    onClick: () => this.drawerOpen.update((v) => !v),
  };

  readonly logoutButtonOptions = {
    icon: 'runner',
    text: 'Abmelden',
    stylingMode: 'text',
    onClick: () => this.logout(),
  };

  onNavItemClick(e: any): void {
    const item = e.itemData as NavItem;
    if (item?.path) this.router.navigateByUrl(item.path);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}
