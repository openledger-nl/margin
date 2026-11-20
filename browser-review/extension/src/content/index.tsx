// Content script entry: mounts the overlay on the pages it may run on (sites.ts).
import { HOST_TAG, REVIEW_ATTR } from './targets.ts';
import { createExtensionHost } from './extension-host.ts';
import { mountOverlay } from './mount.tsx';

// Already injected: the extension was reloaded and runs this script again.
// A review link from margin.js (a customer's view of staging) takes the page instead.
if (!document.querySelector(HOST_TAG) && !document.documentElement.hasAttribute(REVIEW_ATTR)) {
  mountOverlay(createExtensionHost());
}
