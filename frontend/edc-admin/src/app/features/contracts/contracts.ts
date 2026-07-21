import { Component, inject } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import { DxDataGridModule } from 'devextreme-angular/ui/data-grid';
import { EdcService } from '../../core/edc.service';

@Component({
  selector: 'app-contracts',
  imports: [DxDataGridModule],
  templateUrl: './contracts.html',
  styleUrl: './contracts.scss',
})
export class Contracts {
  private edc = inject(EdcService);
  readonly store: CustomStore = this.edc.negotiationsStore();
}
