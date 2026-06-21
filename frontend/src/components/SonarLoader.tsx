import './SonarLoader.css';

interface SonarLoaderProps {
  /** 0 → 1 dwell progress. Renders nothing at 0 (loader hidden until dwell). */
  progress: number;
}

/**
 * Dwell loader: a circular fill that sweeps around as the dwell progresses
 * (conic-gradient driven by `progress`). Hidden at 0, a full blue circle at 1.
 */
export default function SonarLoader({ progress }: SonarLoaderProps) {
  if (progress <= 0) return null;
  const angle = `${Math.min(1, progress) * 360}deg`;
  return (
    <div className="dwell-loader" aria-hidden="true">
      <span className="dwell-loader__ring" style={{ ['--angle' as string]: angle }} />
    </div>
  );
}
