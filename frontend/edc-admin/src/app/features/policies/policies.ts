import { Component, inject, signal, viewChild } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import notify from 'devextreme/ui/notify';
import { DxDataGridModule, DxDataGridComponent } from 'devextreme-angular/ui/data-grid';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { DxPopupModule } from 'devextreme-angular/ui/popup';
import { DxFormModule } from 'devextreme-angular/ui/form';
import { EdcService, NewPolicy } from '../../core/edc.service';

@Component({
  selector: 'app-policies',
  imports: [DxDataGridModule, DxButtonModule, DxPopupModule, DxFormModule],
  templateUrl: './policies.html',
  styleUrl: './policies.scss',
})
export class Policies {
  private edc = inject(EdcService);
  readonly grid = viewChild(DxDataGridComponent);

  readonly store: CustomStore = this.edc.policyDefinitionsStore();
  readonly popupVisible = signal(false);
  readonly saving = signal(false);

  newPolicy: NewPolicy = this.empty();

  openCreate(): void {
    this.newPolicy = this.empty();
    this.popupVisible.set(true);
  }

  async save(): Promise<void> {
    if (!this.newPolicy.id) {
      notify('Policy-ID ist erforderlich.', 'warning', 3000);
      return;
    }
    this.saving.set(true);
    try {
      await this.edc.createPolicyDefinition(this.newPolicy);
      this.popupVisible.set(false);
      notify('Policy angelegt.', 'success', 2500);
      this.grid()?.instance.refresh();
    } catch {
      notify('Policy konnte nicht angelegt werden.', 'error', 4000);
    } finally {
      this.saving.set(false);
    }
  }

  private empty(): NewPolicy {
    // Default: restrict by Business Partner Number (tractusx-edc BPN policy function).
    return { id: '', leftOperand: 'BusinessPartnerNumber', operator: 'eq', rightOperand: '' };
  }
}
