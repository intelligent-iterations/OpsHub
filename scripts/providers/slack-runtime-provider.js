function resolveRuntimeProvider() {
  if (globalThis?.openclaw?.slack?.listMessages) {
    return globalThis.openclaw.slack;
  }

  const adapterPath = process.env.OPSHUB_SLACK_PROVIDER_ADAPTER;
  if (!adapterPath) return null;

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const loaded = require(adapterPath);
  if (typeof loaded === 'function') return { listMessages: loaded };
  if (typeof loaded?.listMessages === 'function') return loaded;
  return null;
}

async function listMessages({ channel, limit = 50 } = {}) {
  const provider = resolveRuntimeProvider();
  if (!provider?.listMessages) {
    throw new Error('runtime_slack_provider_unavailable');
  }

  const result = await provider.listMessages({ channel, limit });
  return Array.isArray(result) ? result : (Array.isArray(result?.messages) ? result.messages : []);
}

module.exports = {
  listMessages,
  resolveRuntimeProvider,
};
