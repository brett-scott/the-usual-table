export function DuckArtwork({ hat }: { hat: number }) {
  return <svg className="duck-art" viewBox="0 0 100 82" aria-hidden="true">
    <ellipse cx="42" cy="73" rx="30" ry="4" fill="#102d27" opacity=".35" />
    <g className="duck-feet" fill="#e68b32"><path d="M38 63l-5 7h12l3-7z"/><path d="M56 63l-2 7h12l2-7z"/></g>
    <path d="M15 42 Q20 65 47 65 Q68 65 73 44 Q62 50 54 39 Q42 29 26 36 L15 31Z" fill="var(--duck-color)" stroke="#816c3d" strokeWidth="2"/>
    <path d="M26 44 Q40 37 52 45 Q45 58 31 54 Q25 51 26 44Z" fill="var(--duck-wing)"/>
    <circle cx="67" cy="32" r="16" fill="var(--duck-color)" stroke="#816c3d" strokeWidth="2"/>
    <path d="M79 33 Q95 31 94 37 Q89 42 79 40Z" fill="#e78630" stroke="#a25b27" strokeWidth="1.5"/>
    <circle cx="73" cy="29" r="2.3" fill="#252822"/>
    {hat === 0 && <g><path d="M56 22l2-17h19l2 17z" fill="#52315a" stroke="#24172c" strokeWidth="2"/><path d="M55 17h23v4H55z" fill="#db6580"/><path d="M52 22h31" stroke="#24172c" strokeWidth="4" strokeLinecap="round"/></g>}
    {hat === 1 && <g><path d="M54 20l-2-13 8 6 7-10 6 10 9-6-3 13z" fill="#f4c54f" stroke="#9e6d28" strokeWidth="2"/><circle cx="67" cy="15" r="2" fill="#dd5b65"/></g>}
    {hat === 2 && <g><path d="M57 20V12h21v8z" fill="#3c365f"/><path d="M49 10l18-8 19 8-19 8z" fill="#4c4473" stroke="#27203f" strokeWidth="2"/><path d="M83 11v10" stroke="#efc85a" strokeWidth="2"/></g>}
    {hat === 3 && <g><path d="M58 19q1-14 5-14 4 5 8 0 5 0 7 14z" fill="#a86a38" stroke="#593a27" strokeWidth="2"/><path d="M50 19q17 8 34 0" fill="#c48a50" stroke="#593a27" strokeWidth="3"/></g>}
  </svg>;
}
