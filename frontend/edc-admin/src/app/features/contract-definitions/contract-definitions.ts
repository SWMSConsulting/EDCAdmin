import { Component, inject, signal, viewChild } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import notify from 'devextreme/ui/notify';
import { DxDataGridModule, DxDataGridComponent } from 'devextreme-angular/ui/data-grid';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { DxPopupModule } from 'devextreme-angular/ui/popup';
import { DxFormModule } from 'devextreme-angular/ui/form';
import { EdcService, NewContractDefinition } from '../../core/edc.service';

@Component({
  selector: 'app-contract-definitions',
  imports: [DxDataGridModule, DxButtonModule, DxPopupModule, DxFormModule],
  templateUrl: './contract-definitions.html',
  styleUrl: './contract-definitions.scss',
})
export class ContractDefinitions {
  private edc = inject(EdcService);
  readonly grid = viewChild(DxDataGridComponent);

  readonly store: CustomStore = this.edc.contractDefinitionsStore();
  readonly policyIds = signal<string[]>([]);
  readonly popupVisible = signal(false);
  readonly saving = signal(false);

  newDef: NewContractDefinition = this.empty();

  async openCreate(): Promise<void> {
    this.newDef = this.empty();
    try {
      this.policyIds.set(await this.edc.policyIds());
    } catch {
      this.policyIds.set([]);
    }
    this.popupVisible.set(true);
  }

  get policySelectOptions() {
    return { items: this.policyIds(), stylingMode: 'outlined', searchEnabled: true };
  }

  async save(): Promise<void> {
    if (!this.newDef.id || !this.newDef.accessPolicyId || !this.newDef.contractPolicyId) {
      notify('ID, Access-Policy und Contract-Policy sind erforderlich.', 'warning', 3000);
      return;
    }
    this.saving.set(true);
    try {
      await this.edc.createContractDefinition(this.newDef);
      this.popupVisible.set(false);
      notify('Vertragsdefinition angelegt.', 'success', 2500);
      this.grid()?.instance.refresh();
    } catch {
      notify('Vertragsdefinition konnte nicht angelegt werden.', 'error', 4000);
    } finally {
      this.saving.set(false);
    }
  }

  private empty(): NewContractDefinition {
    return { id: '', accessPolicyId: '', contractPolicyId: '', assetId: '' };
  }
}
