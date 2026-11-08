import type { GameId } from '@casual/protocol';

/** Local vector illustrations for the game gallery; no external artwork or fonts. */
export function GameArtwork({ gameId }: { gameId: GameId }) {
  return <svg viewBox="0 0 300 210" fill="none" aria-hidden="true" focusable="false">
    {gameId==='blackjack'?<>
      <ellipse cx="152" cy="180" rx="100" ry="10" fill="currentColor" opacity=".09"/>
      <g transform="translate(69 25) rotate(-12 60 85)"><rect width="102" height="143" rx="9" fill="#f7f0dc" stroke="#243c2e" strokeWidth="2"/><text x="13" y="29" fill="#243c2e" fontSize="22" fontFamily="Georgia">A</text><text x="51" y="93" fill="#243c2e" fontSize="60" textAnchor="middle">♠</text></g>
      <g transform="translate(143 39) rotate(11 50 65)"><rect width="102" height="143" rx="9" fill="#f7f0dc" stroke="#243c2e" strokeWidth="2"/><text x="11" y="28" fill="#a44b46" fontSize="21" fontFamily="Georgia">K</text><path d="M30 70L51 46L72 70L51 96Z" fill="#a44b46"/><path d="M39 117h25" stroke="#a44b46" strokeWidth="2"/></g>
    </>:gameId==='baccarat'?<>
      <ellipse cx="148" cy="177" rx="100" ry="9" fill="currentColor" opacity=".09"/>
      <g transform="translate(55 37) rotate(-8 47 60)"><rect width="90" height="127" rx="8" fill="#f9efdf" stroke="#874c4b" strokeWidth="2"/><text x="11" y="25" fill="#984c49" fontFamily="Georgia" fontSize="21">8</text><path d="M23 59L44 32L65 59L44 86Z" fill="#b65c58"/></g>
      <g transform="translate(155 36) rotate(9 47 60)"><rect width="90" height="127" rx="8" fill="#f9efdf" stroke="#874c4b" strokeWidth="2"/><text x="11" y="25" fill="#984c49" fontFamily="Georgia" fontSize="21">A</text><path d="M23 67L44 40L65 67L44 94Z" fill="#b65c58"/></g><path d="M145 18v170" stroke="#895756" strokeDasharray="3 5" opacity=".35"/>
    </>:gameId==='roulette'?<>
      <circle cx="150" cy="103" r="83" fill="#b89752"/><circle cx="150" cy="103" r="76" fill="#253d30" stroke="#f0d399" strokeWidth="2"/><circle cx="150" cy="103" r="65" fill="#9d4e46"/>
      {Array.from({length:20},(_,i)=><path key={i} d={`M150 103L${150+65*Math.cos(i*Math.PI/10)} ${103+65*Math.sin(i*Math.PI/10)}`} stroke="#f6dfb1" strokeWidth="1.2"/>)}
      <circle cx="150" cy="103" r="42" fill="#314f3a" stroke="#dfc38b" strokeWidth="3"/><circle cx="150" cy="103" r="14" fill="#d7b977"/><path d="M150 74v58M121 103h58" stroke="#ead9b4" strokeWidth="5"/><circle cx="192" cy="43" r="5" fill="#fff9e8"/>
    </>:gameId==='keno'?<>
      <rect x="61" y="20" width="178" height="167" rx="13" fill="#f4edda" stroke="#486344" strokeWidth="2"/>
      {Array.from({length:20},(_,i)=><g key={i} transform={`translate(${82+i%5*33} ${45+Math.floor(i/5)*39})`}><circle r="12" fill={[2,7,11,18].includes(i)?'#486344':'#d1d9bf'}/><text y="4" textAnchor="middle" fontFamily="Georgia" fontSize="12" fill={[2,7,11,18].includes(i)?'#fff1cb':'#486344'}>{i+1}</text></g>)}
      <circle cx="228" cy="153" r="24" fill="#dfc18b" stroke="#486344" strokeWidth="2"/><text x="228" y="161" textAnchor="middle" fontFamily="Georgia" fontSize="24" fill="#304f38">7</text>
    </>:gameId==='duck-race'?<>
      <path d="M29 154q30-15 60 0t60 0t60 0t60 0M29 170q30-15 60 0t60 0t60 0t60 0" stroke="#276473" opacity=".35" strokeWidth="2"/><path d="M91 120c-29-20-26-47-5-45 7 1 14 7 20 13 3-24 18-48 39-48 26 0 41 21 36 42l27 8-29 11c-4 34-22 49-54 49-19 0-33-10-34-30Z" fill="#efd29a" stroke="#3a6261" strokeWidth="2"/><path d="M113 109q28-15 39 12-24 20-39-12Z" fill="#d6ad6c"/><circle cx="158" cy="63" r="4" fill="#173a3d"/><path d="M179 79l26 10-27 7" fill="#cb8254"/><path d="M228 37v88m0-85h31v24h-31" stroke="#3a6261" strokeWidth="2"/><path d="M229 41h9v8h-9m18-8h9v8h-9m-9 0h9v8h-9m-9 0h9v8h-9m18-8h9v8h-9" fill="#3a6261"/>
    </>:gameId==='crash'?<>
      <path d="M43 33v134h214" stroke="#65517a" strokeWidth="1.5" opacity=".5"/><path d="M43 129h214M43 91h214M43 53h214" stroke="#65517a" opacity=".14"/><path d="M46 155C96 155 121 143 145 123S189 76 237 35" stroke="#6a507f" strokeWidth="5" strokeLinecap="round"/><path d="M46 155C96 155 121 143 145 123S189 76 237 35V166H46Z" fill="#6a507f" opacity=".09"/><circle cx="237" cy="35" r="7" fill="#f1e6d0" stroke="#6a507f" strokeWidth="3"/><path d="M230 56l7-21-22 6" stroke="#6a507f" strokeWidth="3" strokeLinecap="round"/><text x="65" y="75" fill="#6a507f" fontFamily="Georgia" fontSize="35">×</text>
    </>:<><circle cx="150" cy="105" r="65" stroke="currentColor" strokeWidth="2"/><text x="150" y="125" fill="currentColor" fontSize="60" textAnchor="middle">♣</text></>}
  </svg>;
}
