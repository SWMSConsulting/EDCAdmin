import { Component, inject, signal } from '@angular/core';
import { ConnectorInfo, EdcService } from '../../core/edc.service';

@Component({
  selector: 'app-settings',
  imports: [],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private edc = inject(EdcService);
  readonly info = signal<ConnectorInfo | null>(null);

  constructor() {
    this.edc
      .connectorInfo()
      .then((i) => this.info.set(i))
      .catch(() => this.info.set(null));
  }
}
