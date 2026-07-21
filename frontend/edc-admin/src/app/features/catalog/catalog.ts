import { Component, inject, signal } from '@angular/core';
import { DxFormModule } from 'devextreme-angular/ui/form';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { DxDataGridModule } from 'devextreme-angular/ui/data-grid';
import { EdcService } from '../../core/edc.service';

interface Dataset {
  id: string;
  name: string;
  contentType: string;
  offerId: string;
  policyCount: number;
}

@Component({
  selector: 'app-catalog',
  imports: [DxFormModule, DxButtonModule, DxDataGridModule],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class Catalog {
  private edc = inject(EdcService);

  readonly query = { counterPartyAddress: '', counterPartyId: '' };
  readonly datasets = signal<Dataset[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async loadOwn(): Promise<void> {
    try {
      const info = await this.edc.connectorInfo();
      this.query.counterPartyAddress = info.edcBaseUrl.replace(/\/management.*$/, '') + '/api/dsp';
      this.query.counterPartyId = info.participant;
      await this.request();
    } catch {
      this.error.set('Eigene Connector-Daten konnten nicht geladen werden.');
    }
  }

  async request(): Promise<void> {
    if (!this.query.counterPartyAddress || !this.query.counterPartyId) {
      this.error.set('Bitte DSP-Adresse und Teilnehmer-ID angeben.');
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    try {
      const catalog = await this.edc.requestCatalog(this.query.counterPartyAddress, this.query.counterPartyId);
      this.datasets.set(this.extractDatasets(catalog));
    } catch {
      this.error.set('Katalog konnte nicht abgerufen werden.');
      this.datasets.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private extractDatasets(catalog: any): Dataset[] {
    const raw = catalog?.['dcat:dataset'] ?? catalog?.dataset ?? [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.filter(Boolean).map((d: any) => {
      const policy = d['odrl:hasPolicy'] ?? d.hasPolicy;
      const policies = Array.isArray(policy) ? policy : policy ? [policy] : [];
      return {
        id: d['@id'],
        name: d.name ?? d['dct:title'] ?? d['@id'],
        contentType: d.contenttype ?? d['dct:format'] ?? '',
        offerId: policies[0]?.['@id'] ?? '',
        policyCount: policies.length,
      } as Dataset;
    });
  }
}
