import { registerRootComponent } from 'expo';

// Must be imported at module scope: TaskManager.defineTask has to run in the
// global JS context so the background task fires when the app is headless.
import './src/locationTask';

import App from './App';

registerRootComponent(App);
