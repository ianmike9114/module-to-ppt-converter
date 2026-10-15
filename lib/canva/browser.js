// Client-side helpers for the "Open in Canva" button.

export function connectCanvaPopup() {
  return new Promise((resolve) => {
    const popup = window.open('/api/canva/connect', 'canva-auth', 'width=600,height=760');
    if (!popup) return resolve(false);

    let done = false;
    let timer;
    const finish = (ok) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      resolve(ok);
    };
    const onMessage = (e) => {
      if (e.origin === window.location.origin && e.data?.type === 'canva-auth') finish(Boolean(e.data.ok));
    };
    // If the popup closes without a message (or the message raced the close),
    // ask the server whether the session cookie landed.
    timer = setInterval(async () => {
      if (!popup.closed) return;
      clearInterval(timer);
      const res = await fetch('/api/canva/status').then((r) => r.json()).catch(() => ({}));
      finish(Boolean(res.connected));
    }, 500);
    window.addEventListener('message', onMessage);
  });
}

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 45; // ~90s

export async function importDeckToCanva(blob, title, onStatus) {
  onStatus('Uploading your deck to Canva...');
  const res = await fetch(`/api/canva/import?title=${encodeURIComponent(title)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(res.status === 413
      ? 'This deck is too large to send to Canva from here. Upload the downloaded file at canva.com instead.'
      : json.error || 'Canva import failed.');
    err.needsConnect = Boolean(json.needsConnect);
    throw err;
  }

  onStatus('Canva is converting your deck...');
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(`/api/canva/import/${encodeURIComponent(json.jobId)}`);
    const job = await poll.json().catch(() => ({}));
    if (!poll.ok) {
      const err = new Error(job.error || 'Could not check the Canva import.');
      err.needsConnect = Boolean(job.needsConnect);
      throw err;
    }
    if (job.status === 'success' && job.editUrl) return job.editUrl;
    if (job.status === 'failed') throw new Error(job.error || 'Canva could not import this deck.');
  }
  throw new Error('Canva is taking too long. Check "Recent designs" in Canva in a minute.');
}
