import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_COLORS, labelColor, isLabelFolder, labelFoldersOf } from './labelData.js';

test('system folders are not labels', () => {
  assert.equal(isLabelFolder({ path: 'INBOX', special_use: '\\Inbox' }, null), false);
  assert.equal(isLabelFolder({ path: 'INBOX' }, null), false);
  // Gmail's namespace container is not a mailbox, and must never be offered for deletion.
  assert.equal(isLabelFolder({ path: '[Gmail]' }, null), false);
  assert.equal(isLabelFolder({ path: '[Gmail]/Enviados', special_use: '\\Sent' }, null), false);
  assert.equal(isLabelFolder({ path: '[Gmail]/Todos', special_use: '\\All' }, null), false);
  assert.equal(isLabelFolder({ path: 'Papelera', special_use: '\\Trash' }, null), false);
});

test('a normal folder is a label', () => {
  assert.equal(isLabelFolder({ path: 'Test 1' }, null), true);
  assert.equal(isLabelFolder({ path: 'Perfomance Creativo/Tráfico' }, null), true);
});

test('GTD state folders are hidden only while GTD is enabled for the account', () => {
  const folder = { path: 'Watch' };
  assert.equal(isLabelFolder(folder, { gtd_enabled: false }), true);
  assert.equal(isLabelFolder(folder, { gtd_enabled: true }), false);
  // The account's overrides win over the defaults.
  assert.equal(isLabelFolder({ path: 'GTD/Watch' }, { gtd_enabled: true, gtd_folders: { watch: 'GTD/Watch' } }), false);
  assert.equal(isLabelFolder({ path: 'Watch' }, { gtd_enabled: true, gtd_folders: { watch: 'GTD/Watch' } }), true);
});

test('a label keeps the colour picked for it and falls back to the palette', () => {
  assert.equal(labelColor('Test 1', { 'Test 1': '#e66550' }), '#e66550');
  // A stored value that is not a colour is ignored rather than rendered.
  assert.equal(LABEL_COLORS.includes(labelColor('Test 1', { 'Test 1': 'red' })), true);
  assert.equal(labelColor('Test 1'), labelColor('Test 1'));
  assert.equal(LABEL_COLORS.includes(labelColor('Test 1')), true);
});

test('labelFoldersOf filters and sorts', () => {
  const folders = [
    { path: 'Test 2' },
    { path: 'INBOX', special_use: '\\Inbox' },
    { path: 'Test 1' },
    { path: '[Gmail]' },
    { path: 'Todo' },
  ];
  assert.deepEqual(
    labelFoldersOf(folders, { gtd_enabled: true }).map(f => f.path),
    ['Test 1', 'Test 2'],
  );
});
