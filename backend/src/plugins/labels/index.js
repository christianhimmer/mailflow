// Gmail labels plugin (Tier-1, bundled).
//
// Gmail exposes a label as a folder over IMAP, and MailFlow already syncs those folders. This
// plugin reads the label membership MailFlow already stores (a message's sibling copies in label
// folders), shows it in the reading pane, and applies or removes a label through the same reviewed
// label capabilities GTD uses. Label creation and deletion go through the app's folder routes: a
// label is a folder here, and those routes already own the IMAP mechanics.
import router from './routes.js';

export const gmailLabelsPlugin = {
  id: 'gmail-labels',
  name: 'Gmail labels',
  version: '1.0.0',
  tier: 1,
  // Mounted under its own subtree so the plugin's router-level requireAuth cannot intercept the
  // unauthenticated /api/health and /api/version probes.
  router: { base: '/api/gmail-labels', handler: router },
};
