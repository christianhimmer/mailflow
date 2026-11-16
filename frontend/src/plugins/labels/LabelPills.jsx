// Gmail label pills for the reading pane, plus a picker to apply and remove them.
//
// A label is a folder membership in Gmail, not a property stored on the message row, so this asks
// the plugin's own route for the message's label folders and renders one pill per label. The folder
// list comes from the store (the sidebar already keeps it current); system folders (Inbox, Sent,
// All Mail, …) and the folders GTD uses for its states are not labels and are filtered out.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api.js';
import { useStore } from '../../store/index.js';
import { labelColor, labelFoldersOf } from './labelData.js';

export default function LabelPills({ message, account }) {
  const { t } = useTranslation();
  const accountId = account?.id;
  const storeFolders = useStore(s => (accountId ? s.folders[accountId] || [] : []));
  const [fetched, setFetched] = useState(null);
  const [labels, setLabels] = useState([]);
  const [colors, setColors] = useState({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(false);

  // The store is populated as the sidebar loads and again on every folder sync. The fallback fetch
  // covers a reading pane opened before that first load finishes.
  useEffect(() => {
    let alive = true;
    if (!accountId || storeFolders.length > 0) { setFetched(null); return undefined; }
    api.getFolders(accountId)
      .then(list => { if (alive) setFetched(Array.isArray(list) ? list : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [accountId, storeFolders.length]);

  useEffect(() => {
    let alive = true;
    setOpen(false);
    setError(false);
    if (!accountId) return undefined;
    api.gmailLabelColors(accountId)
      .then(found => { if (alive) setColors(found && typeof found === 'object' ? found : {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [accountId]);

  const folders = useMemo(
    () => (storeFolders.length > 0 ? storeFolders : (fetched || [])),
    [storeFolders, fetched],
  );
  const labelFolders = useMemo(() => labelFoldersOf(folders, account), [folders, account]);
  const signature = labelFolders.map(f => f.path).join('\u0000');

  const refresh = () => {
    if (!message?.id || !accountId || labelFolders.length === 0) return Promise.resolve();
    return api.gmailLabelMembership([{
      accountId, ids: [message.id], labelFolders: labelFolders.map(f => f.path),
    }]).then(found => setLabels(found?.[message.id] || [])).catch(() => setLabels([]));
  };

  useEffect(() => {
    let alive = true;
    if (!message?.id || !accountId || labelFolders.length === 0) { setLabels([]); return undefined; }
    api.gmailLabelMembership([{ accountId, ids: [message.id], labelFolders: labelFolders.map(f => f.path) }])
      .then((found) => { if (alive) setLabels(found?.[message.id] || []); })
      .catch(() => { if (alive) setLabels([]); });
    return () => { alive = false; };
    // signature covers the paths themselves, so an identical re-created array is not a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, accountId, signature]);

  const toggle = async (label) => {
    if (busy || !message?.id) return;
    const had = labels.includes(label);
    setBusy(label);
    setError(false);
    // Optimistic: the copy is cheap and the response only confirms it.
    setLabels(current => (had ? current.filter(l => l !== label) : [...current, label]));
    try {
      if (had) {
        try {
          await api.gmailLabelRemove(message.id, label);
        } catch (err) {
          // The message lives nowhere else: removing the label would hide it from MailFlow.
          if (err?.code !== 'last_copy' && err?.status !== 409) throw err;
          if (!window.confirm(t('gmailLabels.removeLastCopy', { name: label }))) {
            setLabels(current => (current.includes(label) ? current : [...current, label]));
            return;
          }
          await api.gmailLabelRemove(message.id, label, true);
        }
      } else {
        await api.gmailLabelApply(message.id, label);
      }
    } catch {
      setError(true);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const sorted = [...labels].sort((a, b) => a.localeCompare(b));

  return (
    <div style={{ marginTop: 6, paddingBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {sorted.map((label) => {
          const color = labelColor(label, colors);
          return (
            <span
              key={label}
              title={label}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
                maxWidth: 220, padding: '2px 8px', borderRadius: 999,
                background: `${color}22`, border: `1px solid ${color}59`,
                fontSize: 11, lineHeight: 1.5, color: 'var(--text-primary)',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: color }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          title={t('gmailLabels.add')}
          aria-label={t('gmailLabels.add')}
          aria-expanded={open}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
            fontSize: 11, lineHeight: 1.5, color: 'var(--text-primary)',
          }}
        >
          <span aria-hidden="true">＋</span>
          <span>{t('gmailLabels.add')}</span>
        </button>
      </div>

      {open && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 8,
          border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
          display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto',
        }}>
          {labelFolders.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('gmailLabels.empty')}</span>
          )}
          {labelFolders.map((folder) => {
            const on = labels.includes(folder.path);
            const color = labelColor(folder.path, colors);
            return (
              <button
                key={folder.path}
                type="button"
                onClick={() => toggle(folder.path)}
                disabled={Boolean(busy)}
                aria-pressed={on}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '5px 6px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: 'none', textAlign: 'left',
                  opacity: busy && busy !== folder.path ? 0.5 : 1,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color }} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {folder.path}
                </span>
                <span aria-hidden="true" style={{ fontSize: 12, color: on ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  {on ? '✓' : ''}
                </span>
              </button>
            );
          })}
          {error && (
            <span style={{ fontSize: 11, color: 'var(--danger, #d94a4a)' }}>{t('gmailLabels.applyFailed')}</span>
          )}
        </div>
      )}
    </div>
  );
}
