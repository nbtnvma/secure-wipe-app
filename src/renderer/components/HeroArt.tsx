/** Original SecureWipe illustration: a monitor whose screen is wiped clean, with a shield emblem. */
export function HeroArt({ active, className }: { active: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 400 330" className={`drop-shadow-[0_18px_28px_rgba(15,23,42,0.22)] ${className ?? ""}`} role="img" aria-label="SecureWipe">
      <defs>
        <linearGradient id="sw-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.55" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="sw-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="sw-stand" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#cbd5e1" />
          <stop offset="0.5" stopColor="#f1f5f9" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id="sw-blade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1e3a5f" />
          <stop offset="1" stopColor="#0f2740" />
        </linearGradient>
        <clipPath id="sw-clip">
          <rect x="34" y="34" width="332" height="182" rx="6" />
        </clipPath>
      </defs>

      {/* stand */}
      <path d="M168 238 h64 l10 44 h-84 z" fill="url(#sw-stand)" />
      <rect x="104" y="278" width="192" height="16" rx="8" fill="url(#sw-stand)" />

      {/* monitor */}
      <g>
        <rect x="20" y="20" width="360" height="226" rx="16" fill="url(#sw-bezel)" />
      </g>
      <rect x="34" y="34" width="332" height="182" rx="6" fill="url(#sw-screen)" />
      <circle cx="200" cy="231" r="4" fill="#94a3b8" />

      <g clipPath="url(#sw-clip)">
        {/* soft reflection */}
        <path d="M34 34 h170 c-40 40 -90 90 -170 120 z" fill="#ffffff" opacity="0.18" />
        {/* dust that gets wiped away */}
        <g opacity={active ? 0.0 : 0.35} style={{ transition: 'opacity 1.2s ease' }}>
          <circle cx="90" cy="170" r="10" fill="#0f172a" opacity="0.18" />
          <circle cx="300" cy="80" r="14" fill="#0f172a" opacity="0.14" />
          <circle cx="320" cy="180" r="7" fill="#0f172a" opacity="0.2" />
          <circle cx="130" cy="70" r="6" fill="#0f172a" opacity="0.16" />
        </g>
        {/* shield emblem */}
        <g transform="translate(200 122)">
          <path d="M0 -50 L40 -36 V-6 C40 22 22 42 0 52 C-22 42 -40 22 -40 -6 V-36 Z" fill="#ffffff" opacity="0.95" />
          <path d="M-17 2 L-5 15 L19 -12" fill="none" stroke="#2563eb" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* sparkles */}
        <g fill="#ffffff">
          <path d="M268 64 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 z" opacity="0.9" />
          <path d="M120 150 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" opacity="0.75" />
          <path d="M300 150 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" opacity="0.7" />
        </g>
      </g>

      {/* wiper */}
      <g className={active ? 'wiper-arm' : 'wiper-arm idle'}>
        <line x1="200" y1="52" x2="200" y2="196" stroke="#0f2740" strokeWidth="5" strokeLinecap="round" />
        <rect x="193" y="70" width="14" height="132" rx="7" fill="url(#sw-blade)" />
        <circle cx="200" cy="52" r="9" fill="#0f2740" />
        <circle cx="200" cy="52" r="3.5" fill="#64748b" />
      </g>
    </svg>
  );
}
