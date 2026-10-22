import { useEffect } from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';

/** Bump when there is a new announcement; each id is shown once per device. */
const SEEN_KEY = 'fs-whatsnew-keyframes-pip';

export function shouldShowWhatsNew() {
  try {
    return !localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable — card may show again next time */
  }
}

export function WhatsNew() {
  const open = useStore((s) => s.dialog === 'whatsnew');
  const close = () => {
    markSeen();
    useStore.setState({ dialog: null });
  };

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  if (!open) return null;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="tour-dim" onClick={close} />
      <div className="tour-card whatsnew">
        <div className="wn-tag">New</div>
        <div className="tour-title">Introducing Keyframes and PiP for videos</div>
        <div className="wn-feature">
          <span className="wn-ico">
            <Icon name="keyframe" size={18} />
          </span>
          <div>
            <b>Keyframes</b>
            <p>
              Select a clip, press the <b>◆</b> button under the viewer (or <kbd>P</kbd>), move the playhead and drag, scale or fade the clip. It animates between
              keyframes. Drag the diamonds on the timeline to retime, right-click for easing.
            </p>
          </div>
        </div>
        <div className="wn-feature">
          <span className="wn-ico">
            <Icon name="pip" size={18} />
          </span>
          <div>
            <b>Picture in Picture</b>
            <p>
              Pick a video or image in Project Media and hit <b>PiP</b>. It lands over your video in the corner. Choose position, size, a circle, heart or star
              shape and a border under <b>Picture in Picture</b> in Effect Controls.
            </p>
          </div>
        </div>
        <div className="tour-foot">
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn primary sm" onClick={close} autoFocus>
            Try it
          </button>
        </div>
      </div>
    </div>
  );
}
