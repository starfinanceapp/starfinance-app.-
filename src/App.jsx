import { useEffect, useRef, useState } from 'react';
import { usePrivy, useLoginWithEmail } from '@privy-io/react-auth';

const short = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <button className="ghost" onClick={copy}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function EmailLogin() {
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const fromLanding = useRef(new URLSearchParams(window.location.search).get('email') || '').current;
  const [email, setEmail] = useState(fromLanding);
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const auto = useRef(false);

  const validEmail = (v) => /^\S+@\S+\.\S+$/.test(v.trim());
  const busy = state.status === 'sending-code' || state.status === 'submitting-code';
  const codeStage =
    (state.status === 'awaiting-code-input' || state.status === 'submitting-code') && !editing;

  const send = async (addr) => {
    setError('');
    try {
      await sendCode({ email: addr.trim() });
      setEditing(false);
      setCode('');
    } catch {
      setError('Could not send the code. Check the email address and try again.');
    }
  };

  // Arrived from the landing page with ?email=... : send the code right away.
  useEffect(() => {
    if (fromLanding && !auto.current && validEmail(fromLanding)) {
      auto.current = true;
      window.history.replaceState({}, '', window.location.pathname);
      send(fromLanding);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await loginWithCode({ code: code.trim() });
    } catch {
      setError('That code is incorrect or has expired. Check it or send a new code.');
    }
  };

  if (codeStage) {
    return (
      <form onSubmit={verify} className="stack">
        <p className="muted">
          We sent a 6-digit code to <strong className="fg">{email}</strong>.
        </p>
        <input
          className="field"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="Enter code"
          aria-label="Verification code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        {error && <p className="err" role="alert">{error}</p>}
        <button className="primary" disabled={busy || code.trim().length < 4}>
          {state.status === 'submitting-code' ? 'Verifying…' : 'Verify and sign in'}
        </button>
        <div className="links">
          <button type="button" className="link" onClick={() => send(email)} disabled={busy}>
            Send a new code
          </button>
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Change email
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (validEmail(email)) send(email);
        else setError('Enter a valid email address.');
      }}
      className="stack"
    >
      <input
        className="field"
        type="email"
        autoComplete="email"
        placeholder="you@email.com"
        aria-label="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <p className="err" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>
        {state.status === 'sending-code' ? 'Sending code…' : 'Continue with email'}
      </button>
    </form>
  );
}

function SignedOut({ login }) {
  return (
    <main className="shell">
      <img
        className="mark"
        src="/logo.png"
        alt="StarFinance"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
      <section className="panel">
        <h1>Sign in to StarFinance</h1>
        <p className="muted">
          Log in or sign up with your email. We send a 6-digit code, no password needed. A wallet is created
          for you the first time you sign in.
        </p>
        <EmailLogin />
        <div className="alt">
          <span className="muted">Prefer something else?</span>
          <button className="ghost" onClick={login}>Google, X or wallet</button>
        </div>
      </section>
    </main>
  );
}

function SignedIn({ user, logout }) {
  const identities = [];
  if (user.email?.address) identities.push(['Email', user.email.address]);
  if (user.google?.email) identities.push(['Google', user.google.email]);
  if (user.twitter?.username) identities.push(['X', `@${user.twitter.username}`]);

  const wallets = (user.linkedAccounts || []).filter((a) => a.type === 'wallet');

  return (
    <main className="shell top">
      <header className="bar">
        <strong>StarFinance</strong>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <section className="panel wide">
        <h1>Your account</h1>

        <h2>Sign-in methods</h2>
        {identities.length === 0 && <p className="muted">Signed in with a wallet only.</p>}
        {identities.map(([k, v]) => (
          <div className="row" key={k}>
            <span className="muted">{k}</span>
            <span>{v}</span>
          </div>
        ))}

        <h2>Wallets</h2>
        {wallets.length === 0 && (
          <p className="muted">No wallet yet. Sign out and sign in again to create one.</p>
        )}
        {wallets.map((w) => (
          <div className="row" key={w.address}>
            <span className="muted">
              {w.chainType === 'solana' ? 'Solana' : 'EVM'}
              {w.walletClientType === 'privy' ? ' · created for you' : ' · external'}
            </span>
            <span className="addr">
              <code title={w.address}>{short(w.address)}</code>
              <CopyButton text={w.address} />
            </span>
          </div>
        ))}
      </section>
    </main>
  );
}

export default function App() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  if (!ready) return <main className="shell"><p className="muted">Loading…</p></main>;
  return authenticated && user ? <SignedIn user={user} logout={logout} /> : <SignedOut login={login} />;
                  }
