import { Component, inject, signal } from '@angular/core';
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
}
