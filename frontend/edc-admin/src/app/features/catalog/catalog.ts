import { Component, inject, signal } from '@angular/core';
import { DxFormModule } from 'devextreme-angular/ui/form';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { DxDataGridModule } from 'devextreme-angular/ui/data-grid';
import notify from 'devextreme/ui/notify';
import { EdcService } from '../../core/edc.service';

interface Dataset {
  id: string;
  name: string;
  contentType: string;
  offerId: string;
  policyCount: number;
  /** Raw odrl offer, needed to start a contract negotiation. */
  offer: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  constructor() {
    // Prefill the form with the own connector's DSP address + BPN as a working example.
    this.edc
      .connectorInfo()
      .then((info) => {
        if (!this.query.counterPartyAddress) this.query.counterPartyAddress = info.dspAddress ?? '';
        if (!this.query.counterPartyId) this.query.counterPartyId = info.bpn ?? info.participant ?? '';
      })
      .catch(() => {});
  }

  async loadOwn(): Promise<void> {
    try {
      const info = await this.edc.connectorInfo();
      this.query.counterPartyAddress = info.dspAddress ?? '';
      this.query.counterPartyId = info.bpn ?? info.participant ?? '';
      if (!this.query.counterPartyAddress) {
        this.error.set('Für diesen Connector ist keine DSP-Adresse konfiguriert (EdcManagement:DspAddress).');
        return;
      }
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
        offer: policies[0] ?? null,
      } as Dataset;
    });
  }

  /** Full consumer flow for one dataset: negotiate -> wait for agreement -> start pull transfer.
   *  The download itself happens in the Transfers view once the transfer is STARTED. */
  async requestAsset(row: Dataset): Promise<void> {
    if (!row.offer) {
      notify('Für dieses Asset ist kein Angebot (Policy) im Katalog vorhanden.', 'warning', 4000);
      return;
    }
    const { counterPartyAddress, counterPartyId } = this.query;
    try {
      notify(`Vertragsverhandlung für ${row.id} gestartet…`, 'info', 2500);
      const neg = await this.edc.negotiate(row.offer, row.id, counterPartyAddress, counterPartyId);
      const negId = neg['@id'];

      let agreementId = '';
      for (let i = 0; i < 40 && !agreementId; i++) {
        await sleep(1500);
        const n = await this.edc.getNegotiation(negId);
        if (n.state === 'FINALIZED') agreementId = n.contractAgreementId;
        else if (n.state === 'TERMINATED') throw new Error('Verhandlung abgelehnt (TERMINATED).');
      }
      if (!agreementId) throw new Error('Zeitüberschreitung bei der Verhandlung.');

      notify('Vertrag geschlossen. Transfer wird gestartet…', 'info', 2500);
      await this.edc.startTransfer(agreementId, row.id, counterPartyAddress);
      notify('Transfer gestartet. Unter „Transfers" herunterladen, sobald Status STARTED.', 'success', 5000);
    } catch (e: any) {
      notify(`Anfrage fehlgeschlagen: ${e?.message ?? 'unbekannter Fehler'}`, 'error', 5000);
    }
  }
}
