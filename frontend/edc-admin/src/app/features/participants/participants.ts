import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DxDataGridModule } from 'devextreme-angular/ui/data-grid';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { DirectoryEntry, EdcService } from '../../core/edc.service';

@Component({
  selector: 'app-participants',
  imports: [DxDataGridModule, DxButtonModule],
  templateUrl: './participants.html',
  styleUrl: './participants.scss',
})
export class Participants {
  private edc = inject(EdcService);
  private router = inject(Router);

  readonly entries = signal<DirectoryEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.entries.set(await this.edc.directory());
    } catch {
      this.error.set('Teilnehmerverzeichnis konnte nicht abgerufen werden (BDRS).');
      this.entries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** Jump to the catalog view, pre-filled with this partner's DSP address + BPN. */
  openCatalog(entry: DirectoryEntry): void {
    if (!entry.dspUrl) return;
    this.router.navigate(['/catalog'], { queryParams: { dsp: entry.dspUrl, bpn: entry.bpn } });
  }
}
