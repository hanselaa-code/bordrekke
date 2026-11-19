import { AlertTriangle, Terminal } from 'lucide-react';
import { missingFirebaseEnvKeys } from '../firebase/config';

export function FirebaseSetupNotice() {
  return (
    <main className="page">
      <div className="container container--narrow">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              BR
            </span>
            <span>Bordrekke</span>
          </div>
          <span className="badge badge--warning">Oppsett mangler</span>
        </header>

        <section className="surface stack-md" aria-labelledby="setup-heading">
          <div className="row">
            <AlertTriangle size={24} color="var(--warning)" aria-hidden="true" />
            <h1 id="setup-heading" style={{ fontSize: '1.5rem' }}>
              Firebase er ikke konfigurert ennå
            </h1>
          </div>

          <p style={{ color: 'var(--ink-secondary)' }}>
            For å bruke sanntidssynkronisering og anonym innlogging må prosjektet ha
            gyldige Firebase-miljøvariabler. Appen mangler for øyeblikket følgende
            nøkler:
          </p>

          <ul className="env-list" aria-label="Manglende miljøvariabler">
            {missingFirebaseEnvKeys.map((key) => (
              <li key={key} className="env-tag">
                {key}
              </li>
            ))}
          </ul>

          <div className="surface--subtle stack-sm">
            <div className="row" style={{ gap: '8px' }}>
              <Terminal size={18} aria-hidden="true" />
              <h2 style={{ fontSize: '1rem' }}>Slik setter du det opp lokalt</h2>
            </div>
            <ol
              style={{
                margin: 0,
                paddingLeft: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                color: 'var(--ink-secondary)',
              }}
            >
              <li>
                Kopier <code>.env.example</code> til <code>.env</code> i rotmappen til
                prosjektet.
              </li>
              <li>
                Lim inn verdiene fra Firebase Console (Project Settings → Web App).
              </li>
              <li>
                Aktiver <strong>Anonymous Sign-in</strong> i Firebase Authentication og
                opprett en <strong>Cloud Firestore</strong>-database.
              </li>
              <li>Start utviklingsserveren på nytt med <code>npm run dev</code>.</li>
            </ol>
          </div>

          <pre className="code-block" data-selectable="true">
{`cp .env.example .env
# Fyll inn VITE_FIREBASE_* i .env
npm run dev`}
          </pre>

          <p style={{ fontSize: '0.875rem', color: 'var(--ink-muted)' }}>
            For publisering til GitHub Pages: legg inn de samme seks{' '}
            <code>VITE_FIREBASE_*</code>-variablene som Repository Secrets under{' '}
            <em>Settings → Secrets and variables → Actions</em>.
          </p>
        </section>
      </div>
    </main>
  );
}
