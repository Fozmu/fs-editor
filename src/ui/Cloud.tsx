import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { cloudEnabled } from '../cloud/config';
import { resetPassword, signIn, signOut, signUp, useAuth } from '../cloud/auth';
import { cloudUsage, deleteCloudProject, downloadProject, formatBytes, listCloudProjects, uploadProject, type CloudProjectInfo } from '../cloud/sync';
import { openProject } from './projectActions';
import { saveProject } from '../engine/storage';
import { Icon } from './Icon';
import { Modal } from './common';

const toast = (t: string, kind?: 'error') => useStore.getState().toast(t, kind);
const errText = (e: unknown) => (e as Error).message || String(e);

/** Uploads the open project (and its media) to the signed-in account. */
export async function syncCurrentProject() {
  if (!useAuth.getState().session) {
    useStore.setState({ dialog: 'account' });
    return;
  }
  const p = useStore.getState().project;
  try {
    await saveProject(p);
    const r = await uploadProject(p);
    toast(
      `"${p.name}" saved to cloud` +
        (r.uploaded ? ` (${r.uploaded} media file${r.uploaded > 1 ? 's' : ''} uploaded)` : '') +
        (r.missing.length ? ` — skipped offline media: ${r.missing.slice(0, 3).join(', ')}${r.missing.length > 3 ? '…' : ''}` : ''),
    );
  } catch (e) {
    toast('Cloud upload failed: ' + errText(e), 'error');
  }
}

/* ---------------- top bar ---------------- */

export function CloudButtons() {
  const session = useAuth((s) => s.session);
  if (!cloudEnabled) return null;
  return (
    <>
      {session && (
        <button className="btn ghost" onClick={syncCurrentProject} title="Save this project and its media to your account">
          <Icon name="cloud" size={14} /> Sync
        </button>
      )}
      <button className="btn ghost" onClick={() => useStore.setState({ dialog: 'account' })} title={session ? `Signed in as ${session.email}` : 'Sign in'}>
        <Icon name="user" size={14} /> {session ? session.email.split('@')[0] : 'Sign in'}
      </button>
    </>
  );
}

/* ---------------- account ---------------- */

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const session = useAuth((s) => s.session);
  return <Modal title={session ? 'Account' : 'Sign in to F.S. Editor'} onClose={onClose}>{session ? <SignedIn /> : <SignInForm />}</Modal>;
}

function SignedIn() {
  const session = useAuth((s) => s.session)!;
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    cloudUsage().then(setUsage, (e) => setErr(errText(e)));
  }, []);
  return (
    <div className="cloud-acct">
      <div>
        Signed in as <b>{session.email}</b>
      </div>
      {usage && (
        <div>
          <div className="meta">
            Cloud storage: {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)}
          </div>
          <div className="progress" style={{ marginTop: 6 }}>
            <div style={{ width: `${Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100).toFixed(1)}%` }} />
          </div>
        </div>
      )}
      {err && <div className="cloud-err">{err}</div>}
      <div className="note">
        Click <b>Sync</b> in the top bar to save the open project and its media to your account. Open it on any other PC from{' '}
        <b>Projects → Cloud</b>.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => useStore.setState({ dialog: 'projects' })}>
          <Icon name="folder" size={14} /> Cloud projects
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn danger" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function SignInForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'in') await signIn(email.trim(), pw);
      else if (!(await signUp(email.trim(), pw))) setMsg({ text: 'Check your email to confirm your account, then sign in.' });
    } catch (e) {
      setMsg({ text: errText(e), err: true });
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    if (!email.trim()) return setMsg({ text: 'Enter your email first.', err: true });
    try {
      await resetPassword(email.trim());
      setMsg({ text: 'Password reset email sent.' });
    } catch (e) {
      setMsg({ text: errText(e), err: true });
    }
  };

  return (
    <form className="cloud-acct" onSubmit={submit}>
      <div className="note">An account keeps your projects and their videos in the cloud, so you can open them on any PC.</div>
      <label className="cloud-field">
        Email
        <input className="txt" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="cloud-field">
        Password
        <input
          className="txt"
          type="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          minLength={6}
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
      </label>
      {msg && <div className={msg.err ? 'cloud-err' : 'note'}>{msg.text}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        {mode === 'in' && (
          <button className="btn ghost sm" type="button" onClick={forgot}>
            Forgot password?
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" type="button" onClick={() => (setMode(mode === 'in' ? 'up' : 'in'), setMsg(null))}>
          {mode === 'in' ? 'New here? Create account' : 'Have an account? Sign in'}
        </button>
      </div>
    </form>
  );
}

/* ---------------- projects dialog: cloud section ---------------- */

export function CloudProjects({ localIds, onOpened }: { localIds: Set<string>; onOpened: () => void }) {
  const session = useAuth((s) => s.session);
  const cur = useStore((s) => s.project);
  const [list, setList] = useState<CloudProjectInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setErr('');
    listCloudProjects().then(setList, (e) => setErr(errText(e)));
  };
  const userId = session?.userId;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listCloudProjects().then(
      (l) => alive && setList(l),
      (e) => alive && setErr(errText(e)),
    );
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!cloudEnabled) return null;
  if (!session)
    return (
      <div className="cloud-box">
        <Icon name="cloud" size={18} />
        <span className="grow">Sign in to keep projects and videos in the cloud and open them on other devices.</span>
        <button className="btn sm primary" onClick={() => useStore.setState({ dialog: 'account' })}>
          Sign in
        </button>
      </div>
    );

  const open = async (c: CloudProjectInfo) => {
    if (c.id === cur.id && !confirm(`Replace the open copy of "${c.name}" with the cloud version?`)) return;
    setBusy(true);
    try {
      const p = await downloadProject(c.id);
      await openProject(p);
      toast(`Opened "${p.name}" from cloud`);
      onOpened();
    } catch (e) {
      toast('Could not open from cloud: ' + errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const del = async (c: CloudProjectInfo) => {
    if (!confirm(`Delete "${c.name}" from the cloud? Copies on your devices stay.`)) return;
    try {
      await deleteCloudProject(c.id);
      refresh();
    } catch (e) {
      toast('Delete failed: ' + errText(e), 'error');
    }
  };
  const sync = async () => {
    setBusy(true);
    await syncCurrentProject();
    setBusy(false);
    refresh();
  };

  return (
    <div className="cloud-sec">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Icon name="cloud" size={16} />
        <b>Cloud</b>
        <span className="meta">{session.email}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" disabled={busy} onClick={sync} title="Upload the open project and its media">
          <Icon name="upload" size={13} /> Upload current project
        </button>
      </div>
      <div className="proj-list">
        {err && <div className="cloud-err">{err}</div>}
        {!err && list === null && <div className="note">Loading…</div>}
        {list?.length === 0 && <div className="note">Nothing in the cloud yet. Upload a project to open it on your other devices.</div>}
        {list?.map((c) => (
          <div key={c.id} className={'proj-row' + (c.id === cur.id ? ' cur' : '')}>
            <Icon name="cloud" size={20} />
            <div className="grow">
              <div style={{ fontWeight: 700 }}>
                {c.name} {localIds.has(c.id) && <span className="meta">· on this device</span>}
              </div>
              <div className="meta">
                {c.width}×{c.height} · {c.fps} fps · {c.clips} clips · {c.media} media ({formatBytes(c.mediaBytes)}) · synced{' '}
                {new Date(c.updatedAt).toLocaleString()}
              </div>
            </div>
            <button className="btn sm" disabled={busy} onClick={() => open(c)} title="Download and open">
              <Icon name="download" size={13} /> Open
            </button>
            <button className="btn sm danger" onClick={() => del(c)} title="Delete from cloud">
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
