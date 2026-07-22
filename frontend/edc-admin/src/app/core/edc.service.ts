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

export interface DirectoryEntry {
  bpn: string;
  did: string;
  self: boolean;
}

export interface NewAsset {
  id: string;
  name: string;
  contentType: string;
  baseUrl: string;
}

export interface NewPolicy {
  id: string;
  /** Constraint left operand, e.g. 'BusinessPartnerNumber' (tractusx-edc BPN policy function). */
  leftOperand: string;
  operator: string;
  /** Empty => unconstrained policy (allow all). */
  rightOperand: string;
}

export interface NewContractDefinition {
  id: string;
  /** Who may SEE the asset in the catalog. */
  accessPolicyId: string;
  /** Under which terms it may be negotiated/downloaded. */
  contractPolicyId: string;
  /** Single asset this definition applies to (empty => all assets). */
  assetId: string;
}

function summarizePolicy(policy: any): string {
  const perms = policy?.permission ?? policy?.['odrl:permission'];
  const arr = Array.isArray(perms) ? perms : perms ? [perms] : [];
  const cons = arr.flatMap((p: any) => {
    const c = p?.constraint ?? p?.['odrl:constraint'];
    return Array.isArray(c) ? c : c ? [c] : [];
  });
  if (!cons.length) return 'ohne Einschränkung (alle)';
  return cons
    .map((c: any) => `${c.leftOperand ?? c['odrl:leftOperand']} ${c.operator ?? c['odrl:operator']} ${c.rightOperand ?? c['odrl:rightOperand']}`)
    .join(', ');
}

function summarizeSelector(selector: any): string {
  const arr = Array.isArray(selector) ? selector : selector ? [selector] : [];
  if (!arr.length) return 'alle Assets';
  return arr.map((c: any) => `${c.operandRight}`).join(', ');
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

  /** All registered dataspace participants (BPN -> DID) from the central BDRS directory. */
  directory(): Promise<DirectoryEntry[]> {
    return firstValueFrom(this.http.get<DirectoryEntry[]>('/api/directory'));
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

  /** Start a contract negotiation for a catalog offer. `offer` is the raw odrl policy taken
   *  from the catalog dataset; assigner (provider) and target (asset) are stamped in. */
  negotiate(offer: any, assetId: string, counterPartyAddress: string, counterPartyId: string): Promise<any> {
    // assigner and target must be in the odrl namespace and be node references ({ @id }); a plain
    // 'assigner' resolves to the edc @vocab and a string target has no @id -> EDC 400.
    const policy = {
      ...offer,
      '@type': 'odrl:Offer',
      'odrl:assigner': { '@id': counterPartyId },
      'odrl:target': { '@id': assetId },
    };
    return firstValueFrom(
      this.http.post<any>(`${this.base}/contractnegotiations`, {
        ...EDC_CTX,
        '@type': 'ContractRequest',
        counterPartyAddress,
        protocol: 'dataspace-protocol-http',
        policy,
      }),
    );
  }

  getNegotiation(id: string): Promise<any> {
    return firstValueFrom(this.http.get<any>(`${this.base}/contractnegotiations/${encodeURIComponent(id)}`));
  }

  /** Consumer-pull transfer: HttpData-PULL causes the EDC to cache an EDR, retrievable via /edrs. */
  startTransfer(agreementId: string, assetId: string, counterPartyAddress: string): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(`${this.base}/transferprocesses`, {
        ...EDC_CTX,
        '@type': 'TransferRequest',
        counterPartyAddress,
        contractId: agreementId,
        assetId,
        protocol: 'dataspace-protocol-http',
        transferType: 'HttpData-PULL',
      }),
    );
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

  // --- Policy definitions (provider access/contract policies) ------------------------------------
  policyDefinitionsStore(): CustomStore {
    return new CustomStore({
      key: 'id',
      loadMode: 'raw',
      load: async () => {
        const raw = await this.query('policydefinitions');
        return raw.map((p: any) => ({
          id: p['@id'],
          type: p.policy?.['@type'] ?? '',
          summary: summarizePolicy(p.policy),
        }));
      },
      remove: (key) => this.remove('policydefinitions', String(key)),
    });
  }

  /** Bare list of policy-definition ids, for pickers in the contract-definition form. */
  async policyIds(): Promise<string[]> {
    const raw = await this.query('policydefinitions');
    return raw.map((p: any) => p['@id']).filter(Boolean);
  }

  createPolicyDefinition(p: NewPolicy): Promise<any> {
    const permission = p.rightOperand
      ? [{ action: 'use', constraint: [{ leftOperand: p.leftOperand, operator: p.operator, rightOperand: p.rightOperand }] }]
      : [];
    return this.create('policydefinitions', {
      '@id': p.id,
      // Inner ODRL context: the policy engine reads odrl:permission/constraint/leftOperand.
      policy: { '@context': 'http://www.w3.org/ns/odrl.jsonld', '@type': 'Set', permission },
    });
  }

  // --- Contract definitions (bind asset <-> access/contract policy) ------------------------------
  contractDefinitionsStore(): CustomStore {
    return new CustomStore({
      key: 'id',
      loadMode: 'raw',
      load: async () => {
        const raw = await this.query('contractdefinitions');
        return raw.map((c: any) => ({
          id: c['@id'],
          accessPolicyId: c.accessPolicyId,
          contractPolicyId: c.contractPolicyId,
          assets: summarizeSelector(c.assetsSelector),
        }));
      },
      remove: (key) => this.remove('contractdefinitions', String(key)),
    });
  }

  createContractDefinition(c: NewContractDefinition): Promise<any> {
    const assetsSelector = c.assetId
      ? [{ '@type': 'Criterion', operandLeft: 'https://w3id.org/edc/v0.0.1/ns/id', operator: '=', operandRight: c.assetId }]
      : [];
    return this.create('contractdefinitions', {
      '@id': c.id,
      accessPolicyId: c.accessPolicyId,
      contractPolicyId: c.contractPolicyId,
      assetsSelector,
    });
  }
}
