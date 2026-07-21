import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  readonly user = signal<string | null>(null);

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(this.http.post<{ user: string }>('/api/auth/login', { username, password }));
    this.user.set(res.user);
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    this.user.set(null);
  }

  async refresh(): Promise<boolean> {
    try {
      const res = await firstValueFrom(this.http.get<{ user: string }>('/api/auth/me'));
      this.user.set(res.user);
      return true;
    } catch {
      this.user.set(null);
      return false;
    }
  }
}
