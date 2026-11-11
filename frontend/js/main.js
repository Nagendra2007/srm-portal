// Entry point. The theme is already applied by the inline script in the page
// head (before first paint); this syncs the rest and starts the app.

import { getTheme, setTheme } from './lib/ui.js';
import { startApp } from './shell.js';

setTheme(getTheme());
startApp();
