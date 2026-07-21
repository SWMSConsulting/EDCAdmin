import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DxFormModule } from 'devextreme-angular/ui/form';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [DxFormModule, DxButtonModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly credentials = { username: '', password: '' };
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async submit(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.login(this.credentials.username, this.credentials.password);
      this.router.navigateByUrl('/catalog');
    } catch {
      this.error.set('Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.');
    } finally {
      this.busy.set(false);
    }
  }
}
