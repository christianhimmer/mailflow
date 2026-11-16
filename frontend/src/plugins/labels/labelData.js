// Shared label helpers for the Gmail labels plugin.
//
// A label is a folder membership in Gmail, and Gmail's label colour is not available over IMAP at
// all, so a colour is either the one the user picked on the settings screen (stored per account by
// the plugin's backend) or a stable colour derived from the label's name. The palette is Gmail's.
export const LABEL_COLORS = [
  '#4986e7', '#42d692', '#e66550', '#eaa041', '#a479e2', '#f691b3',
  '#fb4c2f', '#16a765', '#4a86e8', '#ff8833', '#9fc6e7', '#b99aff',
  '#ac725e', '#ff7537', '#2da2bb', '#f2a600', '#cca6ac', '#7bd148',
];

// GTD's own label folders are not the user's labels: showing them as such (and offering to remove
// them) would be wrong. Each state maps to a folder, with the account's overrides winning over the
// defaults, exactly as the GTD plugin resolves them.
export const GTD_DEFAULT_FOLDERS = {
  todo: 'Todo',
  watch: 'Watch',
  delegated: 'Delegated',
  someday: 'Someday',
  reference: 'Reference',
};

function hashName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function labelColor(name, colors) {
  const picked = colors?.[name];
  if (typeof picked === 'string' && /^#[0-9a-fA-F]{6}$/.test(picked)) return picked;
  return LABEL_COLORS[hashName(name) % LABEL_COLORS.length];
}

export function isLabelFolder(folder, account) {
  if (!folder?.path) return false;
  if (folder.special_use) return false; // Inbox, Sent, Drafts, Trash, Junk, Flagged, All Mail
  if (folder.path === 'INBOX') return false;
  // Gmail's namespace container itself is not a mailbox (and must never be offered for deletion).
  if (folder.path === '[Gmail]') return false;
  if (/^\[Gmail\]\//i.test(folder.path)) return false;
  if (account?.gtd_enabled) {
    const hidden = new Set();
    for (const [state, def] of Object.entries(GTD_DEFAULT_FOLDERS)) {
      const path = account.gtd_folders?.[state];
      hidden.add(typeof path === 'string' && path ? path : def);
    }
    if (hidden.has(folder.path)) return false;
  }
  return true;
}

// The account's label folders, sorted for a stable list.
export function labelFoldersOf(folders, account) {
  return (folders || [])
    .filter(folder => isLabelFolder(folder, account))
    .sort((a, b) => a.path.localeCompare(b.path));
}
