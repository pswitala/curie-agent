import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api-context.js';

export interface ProviderInfo {
  name: string;
  model: string;
  url: string;
  configured: boolean;
  model_cost?: string;
  model_context_window?: number;
}

export function useConfig() {
  const { rpc, ws } = useApi();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const fetchConfig = useCallback(() => {
    if (!rpc) return;

    // Fetch providers
    rpc.providerList()
      .then((list: any) => {
        if (Array.isArray(list)) setProviders(list as ProviderInfo[]);
      })
      .catch(() => {});

    // Fetch model, current_provider and theme settings
    Promise.all([
      rpc.configGet('model').catch(() => null),
      rpc.configGet('current_provider').catch(() => null),
      rpc.configGet('theme').catch(() => null),
    ]).then(([model, current_provider, theme]) => {
      setSettings(prev => ({
        ...prev,
        model: model !== null ? model : prev.model,
        current_provider: current_provider !== null ? current_provider : prev.current_provider,
        theme: theme !== null ? theme : prev.theme,
      }));
    }).catch(() => {});
  }, [rpc]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (!ws) return;
    return ws.on('config-changed', () => {
      fetchConfig();
    });
  }, [ws, fetchConfig]);

  const get = useCallback((key: string): unknown => {
    return settings[key];
  }, [settings]);

  const set = useCallback(async (key: string, value: unknown) => {
    if (!rpc) return;
    try {
      await rpc.configSet(key, value);
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch {
      // Silently fail for now
    }
  }, [rpc]);

  return { settings, get, set, providers };
}
