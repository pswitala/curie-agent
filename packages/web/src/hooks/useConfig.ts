import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api-context.js';

export interface ProviderInfo {
  name: string;
  model: string;
  url: string;
  configured: boolean;
}

export function useConfig() {
  const { rpc } = useApi();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    if (!rpc) return;

    // Fetch providers
    rpc.providerList()
      .then((list: any) => {
        if (Array.isArray(list)) setProviders(list as ProviderInfo[]);
      })
      .catch(() => {});

    // Fetch model
    rpc.configGet('model')
      .then((model: any) => {
        setSettings(prev => ({ ...prev, model }));
      })
      .catch(() => {});
  }, [rpc]);

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
