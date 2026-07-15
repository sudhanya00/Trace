// Custom entry: the recording task must be defined in the global JS scope
// BEFORE any React tree exists, or background location batches delivered to a
// headless app would find no handler. Do not move this into a component.
import './src/lib/recording';

import 'expo-router/entry';
