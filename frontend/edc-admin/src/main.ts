import { bootstrapApplication } from '@angular/platform-browser';
import config from 'devextreme/core/config';

import { appConfig } from './app/app.config';
import { App } from './app/app';
import { DEVEXTREME_LICENSE_KEY } from './license';

if (DEVEXTREME_LICENSE_KEY) {
  config({ licenseKey: DEVEXTREME_LICENSE_KEY });
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
