import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('ServiceWorker registration successful with scope: ', reg.scope);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (installing) {
            (window as any)._pendingUpdateWorker = installing;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed') {
                (window as any)._hasPendingUpdate = true;
                window.dispatchEvent(new CustomEvent('pwa-update-available'));
              }
            });
          }
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.dispatchEvent(new CustomEvent('pwa-controller-updated'));
        });
      })
      .catch((err) => console.error('ServiceWorker registration failed: ', err));
  });
}
