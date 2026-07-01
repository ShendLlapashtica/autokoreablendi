export default function CarMark({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 100 60" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 24c6 4 12 2 16-3 8-9 22-13 38-11 14 2 26 7 32 13-4 1-8 1-12 0"
        stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M10 30c5 2 10 1 14-2 10 8 30 10 44 6 6-2 11-5 14-9"
        stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="28" cy="34" r="9" stroke="#dc2626" strokeWidth="3" />
      <circle cx="74" cy="34" r="9" stroke="#dc2626" strokeWidth="3" />
    </svg>
  );
}

export function Logo({ size = 'text-xl', iconClassName = 'w-7 h-5' }) {
  return (
    <div className="flex items-center gap-1.5 leading-none">
      <CarMark className={iconClassName} />
      <span className={`font-mono font-bold ${size} tracking-tight group-hover:text-red-400 transition-colors`} style={{ color: 'var(--text-1)' }}>
        AUTO <span className="text-red-600">VG</span>
      </span>
    </div>
  );
}
