import { registerSlot, registerPluginMeta } from '../registry.js';
import LabelPills from './LabelPills.jsx';
import LabelsSettings from './LabelsSettings.jsx';

// Under the recipients line of the open message: the account's Gmail labels for that message,
// with a picker to apply or remove them. ctx: { message, account }.
registerSlot('message-recipient-meta', {
  pluginId: 'gmail-labels',
  render: ctx => <LabelPills message={ctx.message} account={ctx.account} />,
});

// Per-account settings live with the other account/plugin settings, under Categories. The block
// renders only while the plugin is activated (the registry gates it).
registerSlot('settings-categories', {
  pluginId: 'gmail-labels',
  render: () => <LabelsSettings />,
});

registerPluginMeta('gmail-labels', {
  settingsLocation: { tab: 'categories', labelKey: 'admin.tabs.categories' },
});
