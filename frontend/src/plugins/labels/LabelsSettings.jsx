// Gmail labels settings: the account's labels, their colours, and creating, renaming or deleting
// them.
//
// A label is a folder on the server, so create, rename and delete go through the app's existing
// folder routes (the same ones the folder UI uses) rather than re-implementing IMAP here. Colours
// are the plugin's own data: Gmail keeps them, but only behind its API, which MailFlow does not use.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api.js';
import { useStore } from '../../store/index.js';
import { LABEL_COLORS, labelColor, labelFoldersOf } from './labelData.js';

const btn = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer',
};
const inputStyle = {
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12,
};

export default function LabelsSettings() {
  const { t } = useTranslation();
  const accounts = useStore(s => s.accounts);
  const storeFolders = useStore(s => s.folders);
  const setFolders = useStore(s => s.setFolders);
  const [accountIds, setAccountIds] = useState(null); // null = loading
  const [accountId, setAccountId] = useState(null);
  const [colors, setColors] = useState({});
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null); // { path, name, color }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    api.gmailLabelAccounts()
      .then(found => { if (alive) setAccountIds(Array.isArray(found?.accounts) ? found.accounts : []); })
      .catch(() => { if (alive) setAccountIds([]); });
    return () => { alive = false; };
  }, []);

  const labelAccounts = useMemo(
    () => (accountIds || []).map(id => accounts.find(a => a.id === id)).filter(Boolean),
    [accountIds, accounts],
  );

  useEffect(() => {
    if (accountId && labelAccounts.some(a => a.id === accountId)) return;
    setAccountId(labelAccounts[0]?.id ?? null);
  }, [labelAccounts, accountId]);

  useEffect(() => {
    let alive = true;
    setColors({});
    setEditing(null);
    setMessage(null);
    if (!accountId) return undefined;
    api.gmailLabelColors(accountId)
      .then(found => { if (alive) setColors(found && typeof found === 'object' ? found : {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [accountId]);

  const account = labelAccounts.find(a => a.id === accountId) || null;
  const folders = useMemo(
    () => (accountId ? (storeFolders[accountId] || []) : []),
    [storeFolders, accountId],
  );
  const labels = useMemo(() => labelFoldersOf(folders, account), [folders, account]);

  const reload = async () => {
    if (!accountId) return;
    try {
      const list = await api.getFolders(accountId);
      setFolders(accountId, Array.isArray(list) ? list : []);
    } catch { /* the list stays as it was */ }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || !accountId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.createFolder(accountId, name);
      setNewName('');
      await reload();
      setMessage({ ok: true, text: t('gmailLabels.created', { name }) });
    } catch {
      setMessage({ ok: false, text: t('gmailLabels.createFailed') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (folder) => {
    if (!accountId || busy) return;
    const count = Number(folder.total_count || 0);
    const prompt = count > 0
      ? t('gmailLabels.deleteWithMessages', { name: folder.path, count })
      : t('gmailLabels.deleteEmpty', { name: folder.path });
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteFolder(accountId, folder.path);
      await api.gmailLabelForgetColor(accountId, folder.path).catch(() => {});
      setColors(current => {
        const next = { ...current };
        delete next[folder.path];
        return next;
      });
      await reload();
    } catch {
      setMessage({ ok: false, text: t('gmailLabels.deleteFailed') });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (folder) => {
    setMessage(null);
    setEditing({ path: folder.path, name: folder.name || folder.path, color: labelColor(folder.path, colors) });
  };

  // Rename (only the last path segment, which is what the folder route replaces) and/or recolour.
  const saveEdit = async () => {
    if (!editing || !accountId || busy) return;
    const name = editing.name.trim();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    let path = editing.path;
    try {
      if (name !== editing.path.split('/').pop()) {
        const result = await api.renameFolder(accountId, editing.path, name);
        path = result?.newPath || name;
        // A colour follows the label it belongs to.
        if (colors[editing.path]) {
          await api.gmailLabelSetColor(accountId, path, colors[editing.path]).catch(() => {});
          await api.gmailLabelForgetColor(accountId, editing.path).catch(() => {});
          setColors(current => {
            const next = { ...current };
            next[path] = next[editing.path];
            delete next[editing.path];
            return next;
          });
        }
      }
      if (editing.color && editing.color !== colors[path]) {
        await api.gmailLabelSetColor(accountId, path, editing.color);
        setColors(current => ({ ...current, [path]: editing.color }));
      }
      setEditing(null);
      await reload();
    } catch {
      setMessage({ ok: false, text: t('gmailLabels.editFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', background: 'var(--bg-secondary)', marginTop: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', color: 'var(--text-primary)' }}>
        {t('gmailLabels.title')}
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 12px', lineHeight: 1.5 }}>
        {t('gmailLabels.description')}
      </p>

      {accountIds !== null && labelAccounts.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('gmailLabels.noAccounts')}</div>
      )}

      {labelAccounts.length > 0 && (
        <>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
            {t('gmailLabels.account')}
          </label>
          <select
            value={accountId || ''}
            onChange={e => setAccountId(e.target.value)}
            style={{ marginBottom: 12, ...inputStyle }}
          >
            {labelAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name || a.email_address}</option>
            ))}
          </select>

          {labels.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>{t('gmailLabels.empty')}</div>
          )}

          {labels.map(folder => (
            <div key={folder.path} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => startEdit(folder)}
                  title={t('gmailLabels.color')}
                  aria-label={t('gmailLabels.color')}
                  style={{
                    width: 14, height: 14, borderRadius: 4, cursor: 'pointer', padding: 0,
                    border: '1px solid var(--border)', background: labelColor(folder.path, colors),
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folder.path}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                  {t('gmailLabels.count', { count: Number(folder.total_count || 0) })}
                </span>
                <button type="button" style={btn} disabled={busy} onClick={() => startEdit(folder)}>
                  {t('gmailLabels.edit')}
                </button>
                <button type="button" style={btn} disabled={busy} onClick={() => remove(folder)}>
                  {t('gmailLabels.delete')}
                </button>
              </div>

              {editing?.path === folder.path && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    value={editing.name}
                    onChange={e => setEditing(current => ({ ...current, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                    style={{ ...inputStyle, width: '100%' }}
                    maxLength={80}
                    aria-label={t('gmailLabels.newLabel')}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {LABEL_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setEditing(current => ({ ...current, color }))}
                        title={color}
                        aria-label={color}
                        style={{
                          width: 18, height: 18, borderRadius: 4, cursor: 'pointer', background: color, padding: 0,
                          border: editing.color === color ? '2px solid var(--text-primary)' : '1px solid var(--border)',
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={btn} disabled={busy || !editing.name.trim()} onClick={saveEdit}>
                      {t('common.save')}
                    </button>
                    <button type="button" style={btn} disabled={busy} onClick={() => setEditing(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); }}
              placeholder={t('gmailLabels.newLabel')}
              maxLength={80}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <button type="button" style={btn} disabled={busy || !newName.trim()} onClick={create}>
              {t('gmailLabels.create')}
            </button>
          </div>

          {message && (
            <div style={{ fontSize: 11, marginTop: 8, color: message.ok ? 'var(--text-tertiary)' : 'var(--danger, #d94a4a)' }}>
              {message.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
