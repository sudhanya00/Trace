import * as Sentry from '@sentry/react-native';
import { registerRootComponent } from 'expo';

// Client-side DSN, safe to hardcode in a throwaway calibration app. Gives us
// crash stacks from real rides without a cable.
Sentry.init({
  dsn: 'https://8e6e7a40b295af11683f1000f7d0aa7c@o4511739055177728.ingest.de.sentry.io/4511739059109968',
  sendDefaultPii: false,
});

// Must be imported at module scope: TaskManager.defineTask has to run in the
// global JS context so the background task fires when the app is headless.
import './src/locationTask';

import App from './App';

registerRootComponent(App);
