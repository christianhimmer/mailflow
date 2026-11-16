import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// The plugin may only talk to core through api.js, so the whole surface is mocked here: the tests
// cover the plugin's own rules (which folders count, ownership, the last-copy guard, colours), not
// the label mechanics core already owns.
vi.mock('../api.js', () => ({
  requireAuth: (req, _res, next) => { req.session = { userId: 'u1' }; next(); },
  getOwnedAccount: vi.fn(),
  loadOwnedMessage: vi.fn(),
  getMessageCopyFolders: vi.fn(),
  isLabelStoreAccount: vi.fn(),
  listUserAccounts: vi.fn(),
  applyLabel: vi.fn(),
  removeLabel: vi.fn(),
  broadcast: vi.fn(),
  storage: { getValue: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import express from 'express';
import {
  getOwnedAccount, loadOwnedMessage, getMessageCopyFolders, isLabelStoreAccount,
  listUserAccounts, applyLabel, removeLabel, broadcast, storage,
} from '../api.js';
import routes from './routes.js';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACCOUNT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MSG = '11111111-1111-4111-8111-111111111111';
const HEADER = '<abc@example.com>';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/gmail-labels', routes);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => new Promise((resolve) => server.close(resolve)));

const post = (path, body) => fetch(`${base}/api/gmail-labels${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});
const put = (path, body) => fetch(`${base}/api/gmail-labels${path}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  getOwnedAccount.mockImplementation(async (_userId, id) => (
    id === ACCOUNT ? { id: ACCOUNT, user_id: 'u1', imap_host: 'imap.gmail.com' } : null
  ));
  isLabelStoreAccount.mockReturnValue(true);
  loadOwnedMessage.mockResolvedValue({
    id: MSG, account_id: ACCOUNT, folder: 'INBOX', uid: 12, message_id: HEADER,
  });
  getMessageCopyFolders.mockResolvedValue(['INBOX', 'Test 1', '[Gmail]/Todos']);
  applyLabel.mockResolvedValue({ applied: true, uid: 99 });
  removeLabel.mockResolvedValue({ removed: true });
  listUserAccounts.mockResolvedValue([{ id: ACCOUNT }, { id: OTHER_ACCOUNT }]);
});

describe('POST /membership', () => {
  it('refuses a request without groups', async () => {
    const res = await post('/membership', {});
    expect(res.status).toBe(400);
  });

  it('returns the label folders the message is in', async () => {
    const res = await post('/membership', {
      groups: [{ accountId: ACCOUNT, ids: [MSG], labelFolders: ['Test 1', 'Test 2'] }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ [MSG]: ['Test 1'] });
    // `[Gmail]/Todos` is a system folder, so it is not among the label folders asked for.
    expect(getMessageCopyFolders).toHaveBeenCalledWith(ACCOUNT, HEADER);
  });

  it('skips an account that is not the caller\'s', async () => {
    const res = await post('/membership', {
      groups: [{ accountId: OTHER_ACCOUNT, ids: [MSG], labelFolders: ['Test 1'] }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(loadOwnedMessage).not.toHaveBeenCalled();
  });

  it('skips a message from a different account than the group', async () => {
    loadOwnedMessage.mockResolvedValue({ id: MSG, account_id: OTHER_ACCOUNT, folder: 'INBOX', message_id: HEADER });
    const res = await post('/membership', {
      groups: [{ accountId: ACCOUNT, ids: [MSG], labelFolders: ['Test 1'] }],
    });
    expect(await res.json()).toEqual({});
  });
});

describe('POST /apply', () => {
  it('refuses INBOX and the [Gmail] tree as "labels"', async () => {
    for (const folder of ['INBOX', '[Gmail]', '[Gmail]/Enviados']) {
      const res = await post('/apply', { messageId: MSG, folder });
      expect(res.status).toBe(400);
    }
    expect(applyLabel).not.toHaveBeenCalled();
  });

  it('refuses a message that is not the caller\'s', async () => {
    loadOwnedMessage.mockResolvedValue(null);
    const res = await post('/apply', { messageId: MSG, folder: 'Test 1' });
    expect(res.status).toBe(404);
  });

  it('applies the label and tells the user\'s other sessions', async () => {
    const res = await post('/apply', { messageId: MSG, folder: 'Test 1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: true, folder: 'Test 1' });
    expect(applyLabel).toHaveBeenCalledWith(
      expect.objectContaining({ id: ACCOUNT }), expect.objectContaining({ id: MSG }), 'Test 1',
    );
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gmail_labels_updated', messageIds: [MSG] }), 'u1',
    );
  });
});

describe('POST /remove', () => {
  it('refuses to strip the only copy without force', async () => {
    getMessageCopyFolders.mockResolvedValue(['Test 1']);
    const res = await post('/remove', { messageId: MSG, folder: 'Test 1' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('last_copy');
    expect(removeLabel).not.toHaveBeenCalled();
  });

  it('still asks when All Mail is the only other copy (it is not a view MailFlow syncs)', async () => {
    getMessageCopyFolders.mockResolvedValue(['[Gmail]/Todos', 'Test 1']);
    const res = await post('/remove', { messageId: MSG, folder: 'Test 1' });
    expect(res.status).toBe(409);
    expect(removeLabel).not.toHaveBeenCalled();
  });

  it('removes it when the caller confirms', async () => {
    getMessageCopyFolders.mockResolvedValue(['Test 1']);
    const res = await post('/remove', { messageId: MSG, folder: 'Test 1', force: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true });
    expect(removeLabel).toHaveBeenCalled();
  });

  it('removes it without force when the message is in another folder too', async () => {
    const res = await post('/remove', { messageId: MSG, folder: 'Test 1' });
    expect(res.status).toBe(200);
    expect(removeLabel).toHaveBeenCalled();
  });

  it('refuses a system folder', async () => {
    const res = await post('/remove', { messageId: MSG, folder: 'INBOX' });
    expect(res.status).toBe(400);
  });
});

describe('colours', () => {
  it('saves a colour for one label and returns the account map', async () => {
    storage.getValue.mockResolvedValue({ owner_id: 'u1', value: { 'Test 1': '#e66550' } });
    const res = await put('/colors', { accountId: ACCOUNT, label: 'Test 2', color: '#42d692' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ 'Test 1': '#e66550', 'Test 2': '#42d692' });
    expect(storage.put).toHaveBeenCalledWith('gmail-labels', `label-colors:${ACCOUNT}`, {
      value: { 'Test 1': '#e66550', 'Test 2': '#42d692' }, ownerId: 'u1',
    });
  });

  it('refuses a colour that is not #rrggbb', async () => {
    const res = await put('/colors', { accountId: ACCOUNT, label: 'Test 2', color: 'red' });
    expect(res.status).toBe(400);
  });

  it('does not read another user\'s colours', async () => {
    storage.getValue.mockResolvedValue({ owner_id: 'u2', value: { 'Test 1': '#e66550' } });
    const res = await fetch(`${base}/api/gmail-labels/colors?accountId=${ACCOUNT}`);
    expect(await res.json()).toEqual({});
  });

  it('drops any stored value that is not a colour', async () => {
    storage.getValue.mockResolvedValue({ owner_id: 'u1', value: { 'Test 1': 'javascript:alert(1)' } });
    const res = await fetch(`${base}/api/gmail-labels/colors?accountId=${ACCOUNT}`);
    expect(await res.json()).toEqual({});
  });
});

describe('GET /accounts', () => {
  it('lists only the accounts where a label is a folder', async () => {
    getOwnedAccount.mockImplementation(async (_userId, id) => ({ id, user_id: 'u1' }));
    isLabelStoreAccount.mockImplementation((account) => account.id === ACCOUNT);
    const res = await fetch(`${base}/api/gmail-labels/accounts`);
    expect(await res.json()).toEqual({ accounts: [ACCOUNT] });
  });
});
