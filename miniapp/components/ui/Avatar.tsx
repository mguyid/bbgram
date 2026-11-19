export function Avatar({ src, name, size = 40 }: { src?: string | null; name: string; size?: 32 | 40 | 56 }) {
  const initial = (name.replace(/^@/, "").trim()[0] || "?").toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" /> : <span aria-hidden>{initial}</span>}
    </div>
  );
}
