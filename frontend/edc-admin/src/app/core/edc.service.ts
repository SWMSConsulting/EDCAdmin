import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import CustomStore from 'devextreme/data/custom_store';

// JSON-LD context every EDC Management API v3 call expects.
const EDC_CTX = {
  '@context': {
    '@vocab': 'https://w3id.org/edc/v0.0.1/ns/',
    odrl: 'http://www.w3.org/ns/odrl/2/',
  },
};

export interface ConnectorInfo {
  edcBaseUrl: string;
  participant: string;
  bpn: string;
  dspAddress: string;
}

export interface NewAsset {
  id: string;
  name: string;
  contentType: string;
  baseUrl: string;
}

@Injectable({ providedIn: 'root' })
export class EdcService {
  private http = inject(HttpClient);
  private base = '/api/edc/v3';

  /** POST {resource}/request with a QuerySpec (empty body = all). The EDC management API
   *  rejects a context-only body, so the QuerySpec @type is always sent. */
  query<T = any>(resource: string, body: Record<string, unknown> = {}): Promise<T[]> {
    return firstValueFrom(
      this.http.post<T[]>(`${this.base}/${resource}/request`, { ...EDC_CTX, '@type': 'QuerySpec', ...body }),
    );
  }

  create(resource: string, body: Record<string, unknown>): Promise<any> {
    return firstValueFrom(this.http.post(`${this.base}/${resource}`, { ...EDC_CTX, ...body }));
  }

  remove(resource: string, id: string): Promise<any> {
    return firstValueFrom(this.http.delete(`${this.base}/${resource}/${encodeURIComponent(id)}`));
  }

  /** Deploy-fixed connector coordinates (read-only), served by the backend. */
  connectorInfo(): Promise<ConnectorInfo> {
    return firstValueFrom(this.http.get<ConnectorInfo>('/api/config'));
  }

  // --- Catalog ----------------------------------------------------------------------------------
  requestCatalog(counterPartyAddress: string, counterPartyId: string): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(`${this.base}/catalog/request`, {
        ...EDC_CTX,
        '@type': 'CatalogRequest',
        counterPartyAddress,
        counterPartyId,
        protocol: 'dataspace-protocol-http',
      }),
    );
  }

  // --- Assets -----------------------------------------------------------------------------------
  private async listAssetsFlat(): Promise<any[]> {
    const raw = await this.query('assets');
    return raw.map((a: any) => ({
      id: a['@id'],
      name: a.properties?.name ?? a['@id'],
      contentType: a.properties?.contenttype ?? '',
      addressType: a.dataAddress?.type ?? '',
      baseUrl: a.dataAddress?.baseUrl ?? '',
    }));
  }

  assetsStore(): CustomStore {
    return new CustomStore({
      key: 'id',
      loadMode: 'raw',
      load: () => this.listAssetsFlat(),
      remove: (key) => this.remove('assets', String(key)),
    });
  }

  createAsset(a: NewAsset): Promise<any> {
    return this.create('assets', {
      '@id': a.id,
      properties: { name: a.name, contenttype: a.contentType },
      dataAddress: { '@type': 'DataAddress', type: 'HttpData', baseUrl: a.baseUrl },
    });
  }

  // --- Contract negotiations --------------------------------------------------------------------
  negotiationsStore(): CustomStore {
    return new CustomStore({
      key: 'id',
      loadMode: 'raw',
      load: async () => {
        const raw = await this.query('contractnegotiations');
        return raw.map((n: any) => ({
          id: n['@id'],
          state: n.state,
          type: n.type,
          counterPartyId: n.counterPartyId,
          counterPartyAddress: n.counterPartyAddress,
          agreementId: n.contractAgreementId ?? '',
        }));
      },
    });
  }

  // --- Transfer processes -----------------------------------------------------------------------
  transfersStore(): CustomStore {
    return new CustomStore({
      key: 'id',
      loadMode: 'raw',
      load: async () => {
        const raw = await this.query('transferprocesses');
        return raw.map((t: any) => ({
          id: t['@id'],
          state: t.state,
          type: t.type,
          assetId: t.assetId ?? '',
          contractId: t.contractId ?? '',
          counterPartyId: t.counterPartyId ?? '',
        }));
      },
    });
  }
}
