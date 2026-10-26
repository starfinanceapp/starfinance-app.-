import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App.jsx';
import './styles.css';

const appId = import.meta.env.VITE_PRIVY_APP_ID;

function MissingConfig() {
  return (
    <main className="shell">
      <section className="panel">
        <h1>Privy App ID is missing</h1>
        <p className="muted">
          Set <code>VITE_PRIVY_APP_ID</code> in the Vercel project settings, then deploy again.
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {appId ? (
      <PrivyProvider
        appId={appId}
        config={{
          loginMethods: ['email', 'google', 'twitter', 'wallet'],
          appearance: { theme: 'dark', accentColor: '#d7dbe2' },
          embeddedWallets: {
            ethereum: { createOnLogin: 'users-without-wallets' },
            solana: { createOnLogin: 'users-without-wallets' },
          },
        }}
      >
        <App />
      </PrivyProvider>
    ) : (
      <MissingConfig />
    )}
  </React.StrictMode>
);
