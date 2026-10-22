import { useEffect, useState } from 'react';
import { desktop, type UpdateStatus } from '../desktop';
import { useMediaVersion } from '../engine/media';
import { runCommand } from './shortcuts';
import { openProjectPath } from './projectActions';

/** Desktop-only glue: app menu commands, file-open events, update banner and conversion progress. */
export function DesktopUI() {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const busy = useMediaVersion((s) => s.busy);

  useEffect(() => {
    if (!desktop) return;
    const offs = [
      desktop.on('menu', (cmd) => runCommand(cmd)),
      desktop.on('project:openPath', (p) => openProjectPath(p)),
      desktop.on('update:status', setUpdate),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  return (
    <>
      {busy && (
        <div className="banner">
          <span>{busy.label}…</span>
          <div className="progress" style={{ width: 160 }}>
            <div style={{ width: `${(busy.frac * 100).toFixed(0)}%` }} />
          </div>
          <span className="meta">{(busy.frac * 100).toFixed(0)}%</span>
        </div>
      )}
      {update?.state === 'downloading' && (
        <div className="banner">
          <span>Downloading update… {update.percent.toFixed(0)}%</span>
        </div>
      )}
      {update?.state === 'ready' && (
        <div className="banner">
          <span>
            F.S. Editor <b>{update.version}</b> is ready to install.
          </span>
          <button className="btn primary sm" onClick={() => desktop?.installUpdate()}>
            Restart & update
          </button>
          <button className="btn ghost sm" onClick={() => setUpdate(null)}>
            Later
          </button>
        </div>
      )}
    </>
  );
}
