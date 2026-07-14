import { MapPin, Phone, MessageCircle, Mail, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BRAND, waLink } from '../lib/brand.js';

export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border-lo)', marginTop: '2rem', background: 'var(--bg-card2)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg,#7A0606,#B50909,#D34F4F,#B50909,#7A0606)' }} />

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1fr] gap-10">

          {/* Brand */}
          <div>
            <img src={BRAND.logoPath} alt={BRAND.name} className="h-12 w-auto" />
            <p className="text-sm mt-4 leading-relaxed max-w-xs" style={{ color: 'var(--text-3)' }}>
              {BRAND.tagline}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mt-5">
              <a href={waLink()} target="_blank" rel="noopener noreferrer"
                 className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-white text-sm transition-all hover:brightness-110">
                <MessageCircle className="w-4 h-4" style={{ color: '#25d366' }} />
                WhatsApp
              </a>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-3)' }}>
              Kontakt
            </h3>
            <div className="space-y-3 text-sm">
              <a href={`tel:${BRAND.phone.primary.replace(/\s+/g, '')}`}
                 className="flex items-center gap-2.5 transition-colors hover:text-red-400" style={{ color: 'var(--text-2)' }}>
                <Phone className="w-4 h-4 flex-shrink-0 text-red-500" />
                🇽🇰 {BRAND.phone.primaryDisp}
              </a>
              <a href={`tel:${BRAND.phone.secondary.replace(/\s+/g, '')}`}
                 className="flex items-center gap-2.5 transition-colors hover:text-red-400" style={{ color: 'var(--text-2)' }}>
                <Phone className="w-4 h-4 flex-shrink-0 text-red-500" />
                🇩🇪 {BRAND.phone.secondary}
              </a>
              <a href={`mailto:${BRAND.email}`}
                 className="flex items-center gap-2.5 transition-colors hover:text-red-400 break-all" style={{ color: 'var(--text-2)' }}>
                <Mail className="w-4 h-4 flex-shrink-0 text-red-500" />
                {BRAND.email}
              </a>
            </div>
          </div>

          {/* Location */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-3)' }}>
              Lokacioni
            </h3>
            <div className="flex gap-2.5 text-sm">
              <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
              <p style={{ color: 'var(--text-2)' }}>{BRAND.address.full}</p>
            </div>
            <a
              href={BRAND.address.mapsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm mt-3 font-medium text-red-500 hover:text-red-400 transition-colors"
            >
              Hap në Google Maps <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <div className="rounded-lg overflow-hidden glass-card mt-4" style={{ height: '160px' }}>
              <iframe
                title={`${BRAND.name} — ${BRAND.address.line}`}
                src={BRAND.address.mapsEmbed}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-10 pt-6"
             style={{ borderTop: '1px solid var(--border-lo)' }}>
          <p className="text-xs" style={{ color: 'var(--text-4)' }}>© 2026 {BRAND.name}. Të gjitha të drejtat e rezervuara.</p>
          <Link to="/" className="text-xs font-medium transition-colors hover:text-red-400" style={{ color: 'var(--text-4)' }}>
            Kthehu tek fillimi
          </Link>
        </div>
      </div>
    </footer>
  );
}
