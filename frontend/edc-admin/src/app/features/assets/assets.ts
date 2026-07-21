import { Component, inject, signal, viewChild } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import notify from 'devextreme/ui/notify';
import { DxDataGridModule, DxDataGridComponent } from 'devextreme-angular/ui/data-grid';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { DxPopupModule } from 'devextreme-angular/ui/popup';
import { DxFormModule } from 'devextreme-angular/ui/form';
import { EdcService, NewAsset } from '../../core/edc.service';

@Component({
  selector: 'app-assets',
  imports: [DxDataGridModule, DxButtonModule, DxPopupModule, DxFormModule],
  templateUrl: './assets.html',
  styleUrl: './assets.scss',
})
export class Assets {
  private edc = inject(EdcService);
  readonly grid = viewChild(DxDataGridComponent);

  readonly store: CustomStore = this.edc.assetsStore();
  readonly popupVisible = signal(false);
  readonly saving = signal(false);

  newAsset: NewAsset = this.emptyAsset();

  openCreate(): void {
    this.newAsset = this.emptyAsset();
    this.popupVisible.set(true);
  }

  async save(): Promise<void> {
    if (!this.newAsset.id || !this.newAsset.baseUrl) {
      notify('ID und Basis-URL sind erforderlich.', 'warning', 3000);
      return;
    }
    this.saving.set(true);
    try {
      await this.edc.createAsset(this.newAsset);
      this.popupVisible.set(false);
      notify('Asset angelegt.', 'success', 2500);
      this.grid()?.instance.refresh();
    } catch {
      notify('Asset konnte nicht angelegt werden.', 'error', 4000);
    } finally {
      this.saving.set(false);
    }
  }

  private emptyAsset(): NewAsset {
    return { id: '', name: '', contentType: 'application/json', baseUrl: '' };
  }
}
