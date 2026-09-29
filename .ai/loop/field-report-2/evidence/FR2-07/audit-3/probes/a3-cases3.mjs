// audit-3 follow-up: SVG <title>/<desc> (very common in accessible icons) and <metadata>.
export const CASES3 = [
  { id: 'svg3-title-in-icon', label: 'excluded', html: (t) => `<svg width="40" height="40"><title>${t}</title><rect width="40" height="40" fill="#0a0"/></svg>` },
  { id: 'svg3-desc-in-icon', label: 'excluded', html: (t) => `<svg width="40" height="40"><desc>${t}</desc><rect width="40" height="40" fill="#0a0"/></svg>` },
  { id: 'svg3-metadata', label: 'excluded', html: (t) => `<svg width="40" height="40"><metadata>${t}</metadata><rect width="40" height="40" fill="#0a0"/></svg>` },
  { id: 'svg3-title-in-sprite-symbol', label: 'excluded', html: (t) => `<svg width="0" height="0" style="position:absolute"><symbol id="ic" viewBox="0 0 10 10"><title>${t}</title><path d="M0 0h10v10z"/></symbol></svg><svg width="40" height="40"><use href="#ic"/></svg>` },
];
