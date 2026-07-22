import { Component, inject } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import { DxDataGridModule } from 'devextreme-angular/ui/data-grid';
import { DxButtonModule } from 'devextreme-angular/ui/button';
import { EdcService } from '../../core/edc.service';

@Component({
  selector: 'app-transfers',
  imports: [DxDataGridModule, DxButtonModule],
  templateUrl: './transfers.html',
  styleUrl: './transfers.scss',
})
export class Transfers {
  private edc = inject(EdcService);
  readonly store: CustomStore = this.edc.transfersStore();

  /** Download via the server-side proxy (resolves the EDR + streams the bytes). */
  download(id: string): void {
    window.open(`/api/download/${encodeURIComponent(id)}`, '_blank');
  }
}
