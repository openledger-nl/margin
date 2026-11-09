// Content script entry: mounts the overlay on the pages it may run on (sites.ts).
import { HOST_TAG } from './targets.ts';
import { createExtensionHost } from './extension-host.ts';
import { mountOverlay } from './mount.tsx';

// Already injected: the extension was reloaded and runs this script again.
if (!document.querySelector(HOST_TAG)) mountOverlay(createExtensionHost());
