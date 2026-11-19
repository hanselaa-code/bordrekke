import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, PlusCircle, QrCode, Smartphone, Sparkles } from 'lucide-react';
import { ensureAnonymousUser } from '../firebase/auth';
import { createRoom } from '../engine/roomService';

export function HomeView() {
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateRoom() {
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const user = await ensureAnonymousUser();
      const newRoomId = await createRoom(user.uid);
      navigate(`/host/${newRoomId}`);
    } catch (err) {
      console.error('Kunne ikke opprette rom:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Kunne ikke opprette spillrom. Sjekk Firebase-oppsettet og prøv igjen.'
      );
      setCreating(false);
    }
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) {
      setError('Skriv inn en gyldig romkode først.');
      return;
    }
    setError(null);
    navigate(`/play/${cleaned}`);
  }

  return (
    <main className="page">
      <div className="container">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              BR
            </span>
            <span>Bordrekke</span>
          </div>
          <span className="badge badge--accent">Sanntids partyspill</span>
        </header>

        <section className="hero">
          <h1 className="hero-title">
            Legg mobilene på bordet. Sorter dere i riktig rekkefølge.
          </h1>
          <p className="hero-lead">
            Hver spiller skanner én QR-kode og får sitt eget kort på skjermen — uten
            innlogging, uten brukernavn. Diskuter rundt bordet, trykk dere inn i
            rekkefølge, og se hvem som treffer når fasiten avsløres.
          </p>
        </section>

        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
          </div>
        )}

        <section className="home-grid" aria-label="Start eller bli med i spill">
          <div className="surface stack-md" style={{ justifyContent: 'space-between' }}>
            <div className="stack-sm">
              <div className="row">
                <span className="badge badge--dark">Vert / Storskjerm</span>
              </div>
              <h2 style={{ fontSize: '1.5rem' }}>Start et nytt spillrom</h2>
              <p style={{ color: 'var(--ink-secondary)' }}>
                Åpne på nettbrett, PC eller én mobil som styrer spillet. Viser QR-kode,
                live låsestatus og fasit for hele bordet.
              </p>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--lg btn--full"
              onClick={handleCreateRoom}
              disabled={creating}
            >
              <PlusCircle size={22} aria-hidden="true" />
              <span>{creating ? 'Oppretter spillrom…' : 'Opprett spillrom (Host)'}</span>
            </button>
          </div>

          <div className="surface stack-md" style={{ justifyContent: 'space-between' }}>
            <div className="stack-sm">
              <div className="row">
                <span className="badge">Spiller / Mobilkort</span>
              </div>
              <h2 style={{ fontSize: '1.5rem' }}>Bli med med romkode</h2>
              <p style={{ color: 'var(--ink-secondary)' }}>
                Har du ikke kamera tilgjengelig, eller tester i ny fane? Skriv inn
                romkoden fra vertens skjerm.
              </p>
            </div>

            <form className="code-form" onSubmit={handleJoinSubmit} noValidate>
              <label htmlFor="room-code-input" className="sr-only" style={{ display: 'none' }}>
                Romkode
              </label>
              <input
                id="room-code-input"
                type="text"
                className="code-input"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="F.EKS. K7M4P"
                maxLength={8}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Romkode"
              />
              <button type="submit" className="btn btn--dark">
                <span>Bli med</span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </form>
          </div>
        </section>

        <section className="stack-sm" aria-labelledby="how-it-works">
          <h2 id="how-it-works" style={{ fontSize: '1.125rem', color: 'var(--ink-secondary)' }}>
            Slik fungerer det
          </h2>
          <div className="steps-grid">
            <article className="step-card">
              <div className="row-between">
                <span className="step-num">1</span>
                <QrCode size={18} color="var(--ink-muted)" aria-hidden="true" />
              </div>
              <h3 style={{ fontSize: '1.0625rem' }}>Skann QR-koden</h3>
              <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)' }}>
                Alle rundt bordet skanner koden på vertens skjerm og kommer rett inn i
                lobbyen som et fysisk spillkort.
              </p>
            </article>

            <article className="step-card">
              <div className="row-between">
                <span className="step-num">2</span>
                <Smartphone size={18} color="var(--ink-muted)" aria-hidden="true" />
              </div>
              <h3 style={{ fontSize: '1.0625rem' }}>Lås plass i rekkefølge</h3>
              <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)' }}>
                Diskuter rekkefølgen fra lavest til høyest, og trykk på mobilene én etter
                én for å låse Plass 1, Plass 2, osv.
              </p>
            </article>

            <article className="step-card">
              <div className="row-between">
                <span className="step-num">3</span>
                <Sparkles size={18} color="var(--ink-muted)" aria-hidden="true" />
              </div>
              <h3 style={{ fontSize: '1.0625rem' }}>Avslør fasiten</h3>
              <p style={{ fontSize: '0.9375rem', color: 'var(--ink-secondary)' }}>
                Når verten trykker «Vis fasit», lyser hver mobil opp i grønt eller rødt
                samtidig som verdiene avsløres.
              </p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
