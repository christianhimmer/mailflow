// Read and write side of the Gmail labels plugin.
//
// A label in Gmail is a folder membership: applying a label copies the message into that label's
// folder (core's `applyLabel`), removing it deletes only that copy (`removeLabel`). MailFlow already
// stores those copies as sibling rows sharing the RFC Message-ID, so membership is a read over data
// on disk — this route never talks to IMAP itself.
//
// Folder creation and deletion stay on the app's existing folder routes: a label IS a folder here,
// and those routes already own the create/delete mechanics and the folder-list bookkeeping.
//
// Colours have no IMAP representation at all (Gmail only exposes them through its API), so they are
// the plugin's own data, kept per account in the generic plugin store.
import { Router } from 'express';
import {
  requireAuth, getOwnedAccount, loadOwnedMessage, getMessageCopyFolders, isLabelStoreAccount,
  listUserAccounts, applyLabel, removeLabel, broadcast, storage,
} from '../api.js';

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One row costs two indexed lookups, and a reading pane never asks for more than a conversation.
const MAX_IDS = 50;
const MAX_FOLDER_LEN = 500;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PLUGIN_ID = 'gmail-labels';

// A folder path is only ever a label when it is not one of the provider's own mailboxes. Applying a
// "label" that is really Sent or All Mail would copy mail into a system folder, so refuse them here
// as well as filtering them out of the UI.
function isSystemFolderPath(path) {
  const lower = String(path || '').trim().toLowerCase();
  if (!lower) return true;
  if (lower === 'inbox' || lower === 'sent' || lower === 'drafts' || lower === 'trash'
    || lower === 'junk' || lower === 'spam' || lower === 'archive') return true;
  return lower.startsWith('[gmail]/') || lower === '[gmail]';
}

// The account behind a message, when it is the caller's and can carry labels.
async function labelAccountFor(userId, messageId) {
  if (!UUID_RE.test(String(messageId || ''))) return null;
  const message = await loadOwnedMessage(userId, messageId);
  if (!message) return null;
  const account = await getOwnedAccount(userId, message.account_id);
  if (!account || !isLabelStoreAccount(account)) return null;
  return { message, account };
}

// Which of the user's accounts carry labels (the settings screen offers only those).
router.get('/accounts', async (req, res) => {
  const accounts = await listUserAccounts(req.session.userId);
  const ids = [];
  for (const light of accounts) {
    const account = await getOwnedAccount(req.session.userId, light.id);
    if (account && isLabelStoreAccount(account)) ids.push(account.id);
  }
  res.json({ accounts: ids });
});

// POST /membership { groups: [{ accountId, ids: [rowId], labelFolders: [path] }] }
// → { [rowId]: [path] }
router.post('/membership', async (req, res) => {
  const groups = req.body?.groups;
  if (!Array.isArray(groups) || groups.length === 0) return res.status(400).json({ error: 'groups is required' });

  const out = {};
  for (const group of groups) {
    const accountId = String(group?.accountId || '');
    if (!UUID_RE.test(accountId)) continue;
    const account = await getOwnedAccount(req.session.userId, accountId);
    if (!account || !isLabelStoreAccount(account)) continue;

    const labelFolders = new Set(
      (Array.isArray(group.labelFolders) ? group.labelFolders : [])
        .filter(path => typeof path === 'string' && path.length > 0 && path.length <= MAX_FOLDER_LEN)
    );
    const ids = [...new Set(
      (Array.isArray(group.ids) ? group.ids : []).filter(id => UUID_RE.test(String(id)))
    )].slice(0, MAX_IDS);
    if (!labelFolders.size || !ids.length) continue;

    for (const id of ids) {
      const row = await loadOwnedMessage(req.session.userId, id);
      // A row from another account (or another user) never contributes, and a message with no
      // Message-ID has no sibling copies to resolve.
      if (!row || row.account_id !== accountId || !row.message_id) continue;
      const folders = await getMessageCopyFolders(accountId, row.message_id);
      const labels = folders.filter(folder => labelFolders.has(folder));
      if (labels.length) out[id] = labels;
    }
  }
  res.json(out);
});

// Notify this user's other sessions that a message's labels changed.
function announce(userId, messageId, folder) {
  broadcast({ type: 'gmail_labels_updated', messageIds: [messageId], folder }, userId);
}

// POST /apply { messageId, folder } — copy the message into the label's folder.
router.post('/apply', async (req, res) => {
  const folder = String(req.body?.folder || '').trim();
  if (!folder || folder.length > MAX_FOLDER_LEN || isSystemFolderPath(folder)) {
    return res.status(400).json({ error: 'folder is not a label' });
  }
  const found = await labelAccountFor(req.session.userId, req.body?.messageId);
  if (!found) return res.status(404).json({ error: 'Message not found' });

  try {
    const result = await applyLabel(found.account, found.message, folder);
    announce(req.session.userId, found.message.id, folder);
    res.json({ applied: result.applied, alreadyLabelled: result.reason === 'already-labelled', folder });
  } catch (err) {
    console.error(`gmail-labels: apply ${folder} failed:`, err.message);
    res.status(502).json({ error: 'The label could not be applied' });
  }
});

// POST /remove { messageId, folder, force? } — delete only the label-folder copy.
//
// Removing a label from a message that lives nowhere else would make it vanish from MailFlow
// (Gmail keeps it in All Mail, which MailFlow does not sync), so that case is refused unless the
// caller repeats the request with `force: true` after asking the user.
router.post('/remove', async (req, res) => {
  const folder = String(req.body?.folder || '').trim();
  if (!folder || folder.length > MAX_FOLDER_LEN || isSystemFolderPath(folder)) {
    return res.status(400).json({ error: 'folder is not a label' });
  }
  const found = await labelAccountFor(req.session.userId, req.body?.messageId);
  if (!found) return res.status(404).json({ error: 'Message not found' });

  // A copy that keeps the message visible in MailFlow is any other folder MailFlow syncs — INBOX
  // or another label. Gmail's own view folders ([Gmail]/Todos = All Mail, Starred, Important, Trash,
  // Spam) are not synced as views here, so appearing only in those still means the message would
  // drop off the screens the user actually reads. A message with no RFC Message-ID has no sibling
  // copies to resolve, so it is treated as the only copy rather than guessed at.
  const copies = found.message.message_id
    ? await getMessageCopyFolders(found.message.account_id, found.message.message_id)
    : [];
  const keptElsewhere = copies.some(other => (
    other !== folder && !/^\[gmail\]\//i.test(other)
  ));
  if (!keptElsewhere && req.body?.force !== true) {
    return res.status(409).json({ error: 'last-copy', code: 'last_copy', folder });
  }

  try {
    const result = await removeLabel(found.message, folder);
    if (result.removed) announce(req.session.userId, found.message.id, folder);
    res.json({ removed: result.removed, folder });
  } catch (err) {
    console.error(`gmail-labels: remove ${folder} failed:`, err.message);
    res.status(502).json({ error: 'The label could not be removed' });
  }
});

// Colours: per account, { labelName: '#rrggbb' }. Gmail has no IMAP colour, so this is local data.
const colorsKey = accountId => `label-colors:${accountId}`;

async function readColors(userId, accountId) {
  const row = await storage.getValue(PLUGIN_ID, colorsKey(accountId));
  if (!row || row.owner_id !== userId) return {};
  const value = row.value && typeof row.value === 'object' ? row.value : {};
  const out = {};
  for (const [name, color] of Object.entries(value)) {
    if (typeof color === 'string' && COLOR_RE.test(color)) out[name] = color;
  }
  return out;
}

router.get('/colors', async (req, res) => {
  const accountId = String(req.query.accountId || '');
  const account = await getOwnedAccount(req.session.userId, accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  res.json(await readColors(req.session.userId, account.id));
});

// PUT /colors { accountId, label, color } — one label at a time, merged into the account's map.
router.put('/colors', async (req, res) => {
  const accountId = String(req.body?.accountId || '');
  const label = String(req.body?.label || '').trim();
  const color = String(req.body?.color || '').trim();
  if (!label || label.length > MAX_FOLDER_LEN) return res.status(400).json({ error: 'label is required' });
  if (!COLOR_RE.test(color)) return res.status(400).json({ error: 'color must be #rrggbb' });

  const account = await getOwnedAccount(req.session.userId, accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const colors = await readColors(req.session.userId, account.id);
  colors[label] = color;
  await storage.put(PLUGIN_ID, colorsKey(account.id), { value: colors, ownerId: req.session.userId });
  broadcast({ type: 'gmail_labels_updated', accountId: account.id }, req.session.userId);
  res.json(colors);
});

// DELETE /colors/:label?accountId= — forget a colour when its label is deleted.
router.delete('/colors', async (req, res) => {
  const accountId = String(req.query.accountId || '');
  const label = String(req.query.label || '').trim();
  const account = await getOwnedAccount(req.session.userId, accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const colors = await readColors(req.session.userId, account.id);
  if (label in colors) {
    delete colors[label];
    await storage.put(PLUGIN_ID, colorsKey(account.id), { value: colors, ownerId: req.session.userId });
  }
  res.json(colors);
});

export default router;
