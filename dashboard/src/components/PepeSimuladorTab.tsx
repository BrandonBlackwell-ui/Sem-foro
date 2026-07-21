// PEPE QUEST — Simulador de escenarios 8-bits de Pepe Aguilar.
// El jugador escribe una jugada ("Pepe sube una foto con Emiliano") y el
// oráculo (z-ai/glm-5.2) proyecta escenarios con probabilidad e impacto,
// anclados en los reportes REALES del Supabase dedicado de Pepe.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PepeReport } from '../lib/pepeReports'
import {
  fetchPepeReports,
  initialReputation,
  simulateTurn,
  SIM_MODEL,
  type SceneCharacter,
  type SimEscena,
  type SimHistoryEntry,
  type SimScenario,
  type SimTurn,
} from '../lib/pepeSimulator'

// ── Pixel art helpers (box-shadow sprites) ───────────────────────────────────

function PixelSprite({ grid, palette, px, style }: {
  grid: string[]
  palette: Record<string, string>
  px: number
  style?: React.CSSProperties
}) {
  const shadows: string[] = []
  grid.forEach((row, y) => {
    Array.from(row).forEach((ch, x) => {
      const color = palette[ch]
      if (color) shadows.push(`${x * px}px ${y * px}px 0 0 ${color}`)
    })
  })
  const w = Math.max(...grid.map(r => r.length)) * px
  const h = grid.length * px
  return (
    <div style={{ width: w, height: h, position: 'relative', ...style }} aria-hidden>
      <div style={{ width: px, height: px, boxShadow: shadows.join(','), marginLeft: 0, marginTop: 0 }} />
    </div>
  )
}

// Animación por cuadros (2 frames de pixel art que alternan, como los juegos reales).
function AnimatedSprite({ frames, palette, px, speed = 0.64 }: {
  frames: string[][]
  palette: Record<string, string>
  px: number
  speed?: number
}) {
  const w = Math.max(...frames[0].map(r => r.length)) * px
  const h = frames[0].length * px
  if (frames.length < 2) return <PixelSprite grid={frames[0]} palette={palette} px={px} />
  return (
    <div style={{ position: 'relative', width: w, height: h }} aria-hidden>
      <div className="pq-frame-a" style={{ position: 'absolute', inset: 0, animationDuration: `${speed}s` }}>
        <PixelSprite grid={frames[0]} palette={palette} px={px} />
      </div>
      <div className="pq-frame-b" style={{ position: 'absolute', inset: 0, animationDuration: `${speed}s` }}>
        <PixelSprite grid={frames[1]} palette={palette} px={px} />
      </div>
    </div>
  )
}

// Pepe de mariachi: sombrero charro bordado con ala ancha, bigote, traje
// oscuro con botonadura dorada, moño/fistol al cuello y hebilla de plata.
const PEPE_GRID = [
  '........TTTTTTTT........',
  '.......TTTOTTOTTT.......',
  '.......TTTTTTTTTT.......',
  '.TT....TOTTTTTTOT....TT.',
  '.TTT.ttTTTTTTTTTTtt.TTT.',
  '.TTtttttttttttttttttTTT.',
  '..TTttttttttttttttttTT..',
  '...DDDDDDDDDDDDDDDDDD...',
  '.......SSSSSSSSSS.......',
  '.......SSSSSSSSSS.......',
  '.......SEESSSSEES.......',
  '.......SSSSssSSSS.......',
  '.......MMMMssMMMM.......',
  '.......MMSSSSSSMM.......',
  '........SSSSSSSS........',
  '.......BWWYYYYWWB.......',
  '......BBGYYYYYYGBB......',
  '.....BBBWWYYYYWWBBB.....',
  '....BGBBWWWWWWWWBBGB....',
  '...BBGBBWGGWWGGWBBGBB...',
  '...BBGBBWGWWWWGWBBGBB...',
  '...BBGBBWGWWWWGWBBGBB...',
  '...BBBBBWGGWWGGWBBBBB...',
  '...SSS.BBWWWWWWBB.SSS...',
  '......BLLLLLLLLLLB......',
  '......BLLLPPPPLLLB......',
  '......BBBBB..BBBBB......',
  '......BBBB....BBBB......',
  '......BBBB....BBBB......',
  '.....KKKKK....KKKKK.....',
]
// Frame B: mano al pecho (grito charro), sombrero ladeado un pixel y paso abierto.
const PEPE_GRID_B = [
  '.......TTTTTTTT.........',
  '......TTTOTTOTTT........',
  '......TTTTTTTTTT........',
  '.TT...TOTTTTTTOT.....TT.',
  '.TTT.ttTTTTTTTTTTtt.TTT.',
  '.TTtttttttttttttttttTTT.',
  '..TTttttttttttttttttTT..',
  '...DDDDDDDDDDDDDDDDDD...',
  '.......SSSSSSSSSS.......',
  '.......SSSSSSSSSS.......',
  '.......SEESSSSEES.......',
  '.......SSSSssSSSS.......',
  '.......MMMMssMMMM.......',
  '.......MMSSSSSSMM.......',
  '........SSSSSSSS........',
  '.......BWWYYYYWWB.......',
  '......BBGYYYYYYGBB......',
  '.....BBBWWYYYYWWBBB.....',
  '.SS.BGBBWWWWWWWWBBGB....',
  '...BBGBBWGGWWGGWBBGBB...',
  '...BBGBBWGWWWWGWBBGBB...',
  '...BBGBBWGWWWWGWBBGBB...',
  '...BBBBBWGGWWGGWBBBBB...',
  '.......BBWWWWWWBB.SSS...',
  '......BLLLLLLLLLLB......',
  '......BLLLPPPPLLLB......',
  '......BBBBB..BBBBB......',
  '.....BBBB......BBBB.....',
  '.....BBBB......BBBB.....',
  '....KKKKK......KKKKK....',
]
const PEPE_PALETTE: Record<string, string> = {
  T: '#d9c69c', t: '#c3ab79', O: '#8a6d33', D: '#4a3d2c',
  S: '#e2b48e', s: '#c99672', E: '#1c1c1c', M: '#3b2b21',
  B: '#16211d', G: '#d9a441', W: '#f2efe6', Y: '#c9a03c',
  L: '#0f0c09', P: '#d4d4d4', K: '#2a1d10',
}

// Reportera con cámara (la prensa siempre anda cerca).
const PRESS_GRID = [
  '....RRRRRR....',
  '...RRRRRRRR...',
  '...RSSSSSSR...',
  '...RSESSESR...',
  '....SSssSS....',
  '.....SSSS.....',
  '...TTTTTTTT...',
  '..TTtTTTTtTT..',
  '..TT.CCCC.TT..',
  '..SS.CFCC.SS..',
  '....TTTTTT....',
  '....TtTTtT....',
  '....LLLLLL....',
  '....LL..LL....',
  '....LL..LL....',
  '...KKK..KKK...',
]
// Frame B: sube la cámara a la cara (va a disparar) y da un pasito.
const PRESS_GRID_B = [
  '....RRRRRR....',
  '...RRRRRRRR...',
  '...RSSSSSSR...',
  '...RSESSESR...',
  '....SSssSS....',
  '.....SSSS.....',
  '...TTTTTTTT...',
  '..TTtCCCCtTT..',
  '..TT.CFCC.TT..',
  '..SS.TTTT.SS..',
  '....TTTTTT....',
  '....TtTTtT....',
  '....LLLLLL....',
  '...LL....LL...',
  '...LL....LL...',
  '..KKK....KKK..',
]
const PRESS_PALETTE: Record<string, string> = {
  R: '#6e4227', S: '#e8bd98', s: '#cf9f78', E: '#1d1d1d',
  T: '#4e6178', t: '#5d7590', C: '#26262e', F: '#9fd8ff',
  L: '#2e2e38', K: '#241c14',
}

// Ángela: cabello oscuro con flores, chaqueta charra rosa con dorado y falda.
const ANGELA_GRID = [
  '.....AAAAAAAAAA.....',
  '....AAAAAAAAAAAA....',
  '....AAfAAAAAAfAA....',
  '....AASSSSSSSSAA....',
  '....AASEESSEESAA....',
  '....AASSSSSSSSAA....',
  '....AASSsRRsSSAA....',
  '.....AASSSSSSAA.....',
  '....AA.SSSSSS.AA....',
  '....AA.PWYYWP.AA....',
  '...AAPPPGYYGPPPAA...',
  '...A.PPGPWWPGPP.A...',
  '.....PPGPWWPGPP.....',
  '.....PPGPWWPGPP.....',
  '.....SS.PWWP.SS.....',
  '......LLLLLLLL......',
  '......DDDDDDDD......',
  '.....DDDDDDDDDD.....',
  '....DDDDDDDDDDDD....',
  '...DDDDDDDDDDDDDD...',
  '......SS....SS......',
  '.....KK......KK.....',
]
// Frame B: falda al vuelo, cabello suelto y brazo extendido.
const ANGELA_GRID_B = [
  '.....AAAAAAAAAA.....',
  '....AAAAAAAAAAAA....',
  '....AAfAAAAAAfAA....',
  '....AASSSSSSSSAA....',
  '....AASEESSEESAA....',
  '....AASSSSSSSSAA....',
  '....AASSsRRsSSAA....',
  '.....AASSSSSSAA.....',
  '...AA..SSSSSS..AA...',
  '....AA.PWYYWP.AA....',
  '...AAPPPGYYGPPPAA...',
  '...A.PPGPWWPGPP.A...',
  '.....PPGPWWPGPP.....',
  '.....PPGPWWPGPP.....',
  '..SS....PWWP..SS....',
  '......LLLLLLLL......',
  '.....DDDDDDDDD......',
  '....DDDDDDDDDDD.....',
  '...DDDDDDDDDDDDD....',
  '..DDDDDDDDDDDDDDD...',
  '......SS....SS......',
  '....KK......KK......',
]
const ANGELA_PALETTE: Record<string, string> = {
  A: '#2a1c14', f: '#e07a9a', S: '#edbf9a', E: '#1c1c1c', s: '#d3a276',
  R: '#b04555', P: '#c2607e', G: '#d9a441', W: '#f2efe6', Y: '#c9a03c',
  L: '#0f0c09', D: '#7a2f45', K: '#241a10',
}

// Joven (Emiliano / Leonardo): chamarra y jeans; cambia la paleta por personaje.
const JOVEN_GRID = [
  '....CCCCCCCC....',
  '...CCCCCCCCCC...',
  '...CSSSSSSSSC...',
  '...CSEESSEESC...',
  '....SSSSSSSS....',
  '....SSsSSsSS....',
  '.....SSSSSS.....',
  '....JJJJJJJJ....',
  '...JJJJJJJJJJ...',
  '..JJjJWWWWJjJJ..',
  '..JJ.JWWWWJ.JJ..',
  '..SS.JWWWWJ.SS..',
  '.....JJJJJJ.....',
  '....NNNNNNNN....',
  '....NNN..NNN....',
  '....NN....NN....',
  '....NN....NN....',
  '...KKK....KKK...',
]
// Frame B del joven: paso abierto y brazos sueltos.
const JOVEN_GRID_B = [
  '....CCCCCCCC....',
  '...CCCCCCCCCC...',
  '...CSSSSSSSSC...',
  '...CSEESSEESC...',
  '....SSSSSSSS....',
  '....SSsSSsSS....',
  '.....SSSSSS.....',
  '....JJJJJJJJ....',
  '...JJJJJJJJJJ...',
  '..JJjJWWWWJjJJ..',
  '..JJ.JWWWWJ.JJ..',
  '.SS..JWWWWJ..SS.',
  '.....JJJJJJ.....',
  '....NNNNNNNN....',
  '....NNN..NNN....',
  '...NN......NN...',
  '...NN......NN...',
  '..KKK......KKK..',
]
const EMILIANO_PALETTE: Record<string, string> = {
  C: '#1e1e24', S: '#dfae86', E: '#1c1c1c', s: '#c4906a',
  J: '#3e3e48', j: '#54545e', W: '#e8e4d8', N: '#31435c', K: '#241c14',
}
const LEONARDO_PALETTE: Record<string, string> = {
  C: '#2a1c14', S: '#e2b48e', E: '#1c1c1c', s: '#c99672',
  J: '#274235', j: '#d9a441', W: '#f2efe6', N: '#1d2b25', K: '#2a1d10',
}

// Fan grabando con el celular en alto.
const FAN_GRID = [
  '.....HHHHHH.....',
  '....HHSSSSHH....',
  '....HSESSESH....',
  '.....SSSSSS.....',
  '.OO..VVVVVV.....',
  '.SS.VVVVVVVV....',
  '..S.VVVVVVVV....',
  '....VVVVVVVV....',
  '....VVVVVVVV....',
  '....NNNNNNNN....',
  '....NN....NN....',
  '....NN....NN....',
  '...KKK....KKK...',
]
// Frame B del fan: agita el celular en alto y brinca.
const FAN_GRID_B = [
  '.OO..HHHHHH.....',
  '.SS.HHSSSSHH....',
  '..S.HSESSESH....',
  '.....SSSSSS.....',
  '.....VVVVVV.....',
  '....VVVVVVVV....',
  '....VVVVVVVV....',
  '....VVVVVVVV....',
  '....VVVVVVVV....',
  '....NNNNNNNN....',
  '...NN......NN...',
  '...NN......NN...',
  '..KKK......KKK..',
]
const FAN_PALETTE: Record<string, string> = {
  H: '#4a2c18', S: '#e8bd98', E: '#1c1c1c', O: '#2b2b33',
  V: '#d9743f', N: '#3a5170', K: '#241c14',
}

// Abogado/manager de traje gris con corbata.
const ABOGADO_GRID = [
  '.....GGGGGG.....',
  '....GSSSSSSG....',
  '....GSESSESG....',
  '.....SSSSSS.....',
  '....UUWTTWUU....',
  '...UUUWTTWUUU...',
  '..UUUUWTTWUUUU..',
  '..UU.UWWWWU.UU..',
  '..SS.UUUUUU.SS..',
  '.....UUUUUU.....',
  '....UUU..UUU....',
  '....UUU..UUU....',
  '...KKK....KKK...',
]
// Frame B del abogado: revisa el reloj y cambia el peso.
const ABOGADO_GRID_B = [
  '.....GGGGGG.....',
  '....GSSSSSSG....',
  '....GSESSESG....',
  '.....SSSSSS.....',
  '....UUWTTWUU....',
  '...UUUWTTWUUU...',
  '..UUUUWTTWUUUU..',
  '..UU.UWWWWU.UU..',
  '..SS.UUUUUU.SS..',
  '.....UUUUUU.....',
  '...UUU....UUU...',
  '...UUU....UUU...',
  '..KKK......KKK..',
]
const ABOGADO_PALETTE: Record<string, string> = {
  G: '#3a3a40', S: '#e0b08c', E: '#1c1c1c', U: '#5a5f6a',
  W: '#f2efe6', T: '#8a2f3a', K: '#1d1d1d',
}

// Nota musical para la animación de canto.
const NOTE_GRID = [
  '...NN',
  '...NN',
  '...NN',
  '...NN',
  '.NNNN',
  'NNNNN',
  '.NNN.',
]

// Conductor/host de podcast o TV: audífonos (banda + earcups), camisa y micrófono.
const CONDUCTOR_GRID = [
  '....HHHHHHHH....',
  '...HHHHHHHHHH...',
  '..PPHHHHHHHHPP..',
  '..PPSSSSSSSSPP..',
  '..PPSEESSEESPP..',
  '..PPSSSSSSSSPP..',
  '....SSsddsSS....',
  '.....SSSSSS.....',
  '....CCCCCCCC....',
  '...CCCCCCCCCC...',
  '..CCjCWWWWCjCC..',
  '..CC.CWWWWC.CC..',
  '..SS.CWWWWC.SM..',
  '.....CCCCCC..M..',
  '....NNNNNNNN....',
  '....NNN..NNN....',
  '....NN....NN....',
  '...KKK....KKK...',
]
const CONDUCTOR_GRID_B = [
  '....HHHHHHHH....',
  '...HHHHHHHHHH...',
  '..PPHHHHHHHHPP..',
  '..PPSSSSSSSSPP..',
  '..PPSEESSEESPP..',
  '..PPSSSSSSSSPP..',
  '....SSsddsSS....',
  '.....SSSSSS.....',
  '....CCCCCCCC....',
  '...CCCCCCCCCC...',
  '..CCjCWWWWCjCC..',
  '..CC.CWWWWC.CC..',
  '..SM.CWWWWC.SS..',
  '..M..CCCCCC.....',
  '....NNNNNNNN....',
  '....NNN..NNN....',
  '...NN......NN...',
  '..KKK......KKK..',
]
const CONDUCTOR_PALETTE: Record<string, string> = {
  H: '#2a2118', P: '#20232b', S: '#e2b48e', s: '#c99672', E: '#1c1c1c',
  d: '#3b2b21', C: '#4a5568', j: '#d9a441', W: '#eef1f5', N: '#2b2f38',
  M: '#c0c0c8', K: '#241c14',
}

const EXTRA_SPRITES: Record<string, { frames: string[][]; palette: Record<string, string>; px: number; tag: string }> = {
  angela: { frames: [ANGELA_GRID, ANGELA_GRID_B], palette: ANGELA_PALETTE, px: 5, tag: 'ÁNGELA' },
  emiliano: { frames: [JOVEN_GRID, JOVEN_GRID_B], palette: EMILIANO_PALETTE, px: 5, tag: 'EMILIANO' },
  leonardo: { frames: [JOVEN_GRID, JOVEN_GRID_B], palette: LEONARDO_PALETTE, px: 5, tag: 'LEONARDO' },
  fan: { frames: [FAN_GRID, FAN_GRID_B], palette: FAN_PALETTE, px: 4, tag: 'FAN' },
  abogado: { frames: [ABOGADO_GRID, ABOGADO_GRID_B], palette: ABOGADO_PALETTE, px: 4, tag: 'LIC.' },
  conductor: { frames: [CONDUCTOR_GRID, CONDUCTOR_GRID_B], palette: CONDUCTOR_PALETTE, px: 5, tag: 'HOST' },
}

// ── Props componibles (el oráculo ensambla la escena con estas piezas) ──────────
// Cada pieza es CSS puro (crisp, sin depender de que un LLM dibuje pixeles).
const PROP_ZONA_LEFT: Record<string, number> = {
  izquierda: 120, centro: 360, derecha: 560, frente: 300, fondo: 380,
}

// Caballo (rancho) — silueta charra de perfil.
const HORSE_GRID = [
  '.............DDD..',
  '............DDDDD.',
  'T..........MDDDD..',
  'TBBBBBBBBBBMMDDO..',
  'TBBBBBBBBBBBBBB...',
  '.BBBBBBBBBBBBBB...',
  '.BBBBBBBBBBBBBB...',
  '.K..K......K..K...',
  '.K..K......K..K...',
  '.H..H......H..H...',
]
const HORSE_PALETTE: Record<string, string> = {
  B: '#6e4a2e', D: '#5d3f27', M: '#2e1f12', T: '#2e1f12', O: '#1d1409', K: '#5a3c24', H: '#1d1409',
}

function ScenePropPiece({ pieza, zona }: { pieza: string; zona: string }) {
  // audifonos se dibuja sobre Pepe (se maneja aparte); aquí no se renderiza.
  if (pieza === 'audifonos') return null
  const left = PROP_ZONA_LEFT[zona] ?? 360
  const at = (bottom: number, z: number, dx = 0): React.CSSProperties =>
    ({ position: 'absolute', left: left + dx, bottom, zIndex: z })
  switch (pieza) {
    // Frente (z4): quedan delante de Pepe → look de "sentado a la mesa/micrófono".
    case 'mesa':
      return <div className="pq-prop pq-prop-mesa" style={at(92, 4)} />
    case 'microfono':
      return <div className="pq-prop pq-prop-mic" style={at(112, 4, 20)}><i /><b /></div>
    case 'laptop':
      return <div className="pq-prop pq-prop-laptop" style={at(120, 4, -6)}><i /></div>
    // Objetos a los lados (z2).
    case 'camara':
      return <div className="pq-prop pq-prop-camara" style={at(90, 3)}><i /><b /></div>
    case 'planta':
      return <div className="pq-prop pq-prop-planta" style={at(90, 2)}><i /><b /></div>
    case 'bocina':
      return <div className="pq-prop pq-prop-bocina" style={at(88, 2)}><i /><i /></div>
    // Fondo/pared (z1): detrás de los actores.
    case 'on_air':
      return <div className="pq-prop pq-prop-onair" style={at(248, 1, 40)}>ON AIR</div>
    case 'monitor':
      return <div className="pq-prop pq-prop-monitor" style={at(150, 1)}><i /></div>
    case 'sofa':
      return <div className="pq-prop pq-prop-sofa" style={at(90, 1)} />
    case 'tarima':
      return <div className="pq-prop pq-prop-tarima" style={{ position: 'absolute', left: 190, bottom: 82, zIndex: 1 }} />
    case 'alfombra':
      return <div className="pq-prop pq-prop-alfombra" style={{ position: 'absolute', left: 0, right: 0, bottom: 46, zIndex: 1 }} />
    case 'backdrop_logos':
      return <div className="pq-prop pq-prop-backdrop" style={{ position: 'absolute', left: Math.max(0, left - 60), bottom: 150, zIndex: 1 }}><span>PEPE FEST</span><span>PEPE FEST</span><span>PEPE FEST</span><span>PEPE FEST</span><span>PEPE FEST</span><span>PEPE FEST</span></div>
    case 'reflector':
      return <div className="pq-prop pq-prop-reflector" style={at(250, 2)}><i /></div>
    case 'caballo':
      return <div className="pq-prop" style={at(88, 2)}><PixelSprite grid={HORSE_GRID} palette={HORSE_PALETTE} px={5} /></div>
    case 'consola':
      return <div className="pq-prop pq-prop-consola" style={at(92, 4)}>{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</div>
    case 'guitarra':
      return <div className="pq-prop pq-prop-guitarra" style={at(96, 3)}><i /><b /></div>
    case 'podio':
      return <div className="pq-prop pq-prop-podio" style={at(88, 4)}><span /><i /><b /></div>
    case 'maleta':
      return <div className="pq-prop pq-prop-maleta" style={at(88, 2)}><i /></div>
    case 'plato':
      return <div className="pq-prop pq-prop-plato" style={at(116, 4)}><i /></div>
    case 'bandera':
      return <div className="pq-prop pq-prop-bandera" style={at(88, 1)}><i /><b /></div>
    case 'cama':
      return <div className="pq-prop pq-prop-cama" style={at(88, 1)}><i /><b /></div>
    default:
      return null
  }
}

// Coche estacionado (vida urbana de fondo).
const CAR_GRID = [
  '......CCCCCCC.......',
  '.....CcWWcWWcC......',
  '....CCcWWcWWcCC.....',
  '..CCCCCCCCCCCCCCC...',
  '.CCCCCCCCCCCCCCCCC..',
  '.CcCCCCCCCCCCCCCcC..',
  '..C.KK.CCCCC.KK.C...',
  '....KKKK...KKKK.....',
]
const CAR_PALETTE: Record<string, string> = {
  C: '#c96f52', c: '#a85841', W: '#bfe3ea', K: '#1d1d1d',
}

// Corazón pixel (HUD de reputación).
const HEART_GRID = [
  '.RR.RR.',
  'RRRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
]

function PixelHeart({ fill, px = 4 }: { fill: 'full' | 'half' | 'empty'; px?: number }) {
  const color = fill === 'empty' ? '#3a3140' : '#e0314b'
  const heart = <PixelSprite grid={HEART_GRID} palette={{ R: color }} px={px} />
  if (fill !== 'half') return heart
  return (
    <div style={{ position: 'relative' }}>
      <PixelSprite grid={HEART_GRID} palette={{ R: '#3a3140' }} px={px} />
      <div style={{ position: 'absolute', inset: 0, width: (7 * px) / 2, overflow: 'hidden' }}>
        <PixelSprite grid={HEART_GRID} palette={{ R: '#e0314b' }} px={px} />
      </div>
    </div>
  )
}

function HeartsBar({ hearts }: { hearts: number }) {
  const cells: ('full' | 'half' | 'empty')[] = []
  for (let i = 1; i <= 10; i++) {
    if (hearts >= i) cells.push('full')
    else if (hearts >= i - 0.5) cells.push('half')
    else cells.push('empty')
  }
  return (
    <div style={{ display: 'flex', gap: 3 }} title={`Reputación: ${hearts}/10`}>
      {cells.map((f, i) => <PixelHeart key={i} fill={f} />)}
    </div>
  )
}

// ── Escena 8-bits ─────────────────────────────────────────────────────────────

function BuildingWindows({ rows, cols, lit }: { rows: number; cols: number; lit?: number[] }) {
  return (
    <div className="pq-bldg-windows" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: rows * cols }, (_, i) => (
        <div key={i} className={`pq-window${lit?.includes(i) ? ' pq-window-lit' : ''}`} />
      ))}
    </div>
  )
}

// Escena por defecto mientras el jugador decide (mundo vivo, no estático).
const IDLE_ESCENA: SimEscena = {
  fondo: 'calle',
  personajes: [],
  props: [],
  animacion: 'idle',
  ambiente: 'dia',
  dialogos: [
    { quien: 'pepe', texto: '¿Qué jugada hacemos hoy, compa?' },
    { quien: 'prensa', texto: '*la prensa te está observando*' },
  ],
}

const CONFETTI_COLORS = ['#e0314b', '#d9a441', '#57a943', '#7d5a9e', '#4a83c6', '#e07a9a']

function GameScene({ thinking, escena }: { thinking: boolean; escena?: SimEscena | null }) {
  const esc = escena ?? IDLE_ESCENA
  const anim = thinking ? 'idle' : esc.animacion
  const singing = anim === 'cantar'

  // Ciclo de diálogos: cada línea se muestra unos segundos y rota.
  const [dlgIdx, setDlgIdx] = useState(0)
  useEffect(() => {
    setDlgIdx(0)
    if (!esc.dialogos.length) return
    const iv = setInterval(() => setDlgIdx(i => (i + 1) % esc.dialogos.length), 3200)
    return () => clearInterval(iv)
  }, [esc])

  const dlg = !thinking && esc.dialogos.length ? esc.dialogos[dlgIdx] : null

  // Posiciones en banqueta: Pepe fijo, extras en slots, prensa al fondo.
  const extraSlots = [340, 452, 556]
  const bubbleAnchor = (quien: string): { left: number; bottom: number } | null => {
    if (quien === 'pepe') return { left: 170, bottom: 268 }
    if (quien === 'prensa') return { left: anim === 'entrevista' ? 330 : 640, bottom: 180 }
    const i = esc.personajes.indexOf(quien as SceneCharacter)
    if (i === -1) return null
    return { left: extraSlots[i] - 24, bottom: 230 }
  }
  const anchor = dlg ? bubbleAnchor(dlg.quien) : null

  const ambiente = esc.ambiente ?? 'dia'
  const fondo = esc.fondo ?? 'calle'
  const props = thinking ? [] : (esc.props ?? [])
  const wearsHeadphones = !thinking && props.some(p => p.pieza === 'audifonos')
  const stage = anim === 'cantar' || fondo === 'escenario'

  return (
    <div className={`pq-scene pq-amb-${ambiente} pq-fondo-${fondo}${anim === 'crisis' ? ' pq-scene-crisis' : ''}${anim === 'silencio' ? ' pq-scene-dim' : ''}`}>
      {/* Decorado por locación: cada fondo (≠ calle) tapa el mundo con su propio set */}
      {fondo === 'estudio' && (
        <div className="pq-set pq-set-estudio">
          <div className="pq-set-wall" /><div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'foro_tv' && (
        <div className="pq-set pq-set-tv">
          <div className="pq-set-wall" />
          <div className="pq-tv-strip"><span>EN VIVO</span></div>
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'evento' && (
        <div className="pq-set pq-set-evento">
          <div className="pq-evento-backdrop">
            {Array.from({ length: 12 }, (_, i) => <span key={i}>PEPE</span>)}
          </div>
          <div className="pq-evento-carpet" />
          <div className="pq-evento-rope pq-evento-rope-l" />
          <div className="pq-evento-rope pq-evento-rope-r" />
        </div>
      )}
      {fondo === 'escenario' && (
        <div className="pq-set pq-set-escenario">
          <div className="pq-venue" />
          <div className="pq-crowd">{Array.from({ length: 22 }, (_, i) => <i key={i} />)}</div>
        </div>
      )}
      {fondo === 'rancho' && (
        <div className="pq-set pq-set-rancho">
          <div className="pq-rancho-sky" />
          <div className="pq-rancho-mtn" />
          <div className="pq-rancho-field" />
          <div className="pq-agave pq-agave-a" /><div className="pq-agave pq-agave-b" /><div className="pq-agave pq-agave-c" />
          <div className="pq-rancho-fence" />
        </div>
      )}
      {fondo === 'grabacion' && (
        <div className="pq-set pq-set-grabacion">
          <div className="pq-set-wall" />
          <div className="pq-grab-glass" />
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'casa' && (
        <div className="pq-set pq-set-casa">
          <div className="pq-set-wall" />
          <div className="pq-casa-window" />
          <div className="pq-casa-frame pq-casa-frame-a" /><div className="pq-casa-frame pq-casa-frame-b" />
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'conferencia' && (
        <div className="pq-set pq-set-conf">
          <div className="pq-set-wall" />
          <div className="pq-conf-backdrop">{Array.from({ length: 8 }, (_, i) => <span key={i}>PEPE</span>)}</div>
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'aeropuerto' && (
        <div className="pq-set pq-set-aeropuerto">
          <div className="pq-set-wall" />
          <div className="pq-airport-window"><div className="pq-airport-plane" /></div>
          <div className="pq-airport-board"><span>PEPE</span><span>ABORDANDO</span></div>
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'restaurante' && (
        <div className="pq-set pq-set-restaurante">
          <div className="pq-set-wall" />
          <div className="pq-resto-window" />
          <div className="pq-resto-lamp" />
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'juzgado' && (
        <div className="pq-set pq-set-juzgado">
          <div className="pq-set-wall" />
          <div className="pq-court-col pq-court-col-a" /><div className="pq-court-col pq-court-col-b" />
          <div className="pq-court-seal" />
          <div className="pq-court-bench" />
          <div className="pq-set-floor" />
        </div>
      )}
      {fondo === 'hospital' && (
        <div className="pq-set pq-set-hospital">
          <div className="pq-set-wall" />
          <div className="pq-hosp-cross" />
          <div className="pq-hosp-window" />
          <div className="pq-set-floor" />
        </div>
      )}
      {/* Noche: estrellas y luna */}
      {ambiente === 'noche' && (<><div className="pq-stars" /><div className="pq-moon" /></>)}
      {ambiente === 'atardecer' && <div className="pq-sun" />}
      {/* Cielo con nubes en dos tonos */}
      <div className="pq-cloud pq-cloud-a"><i /><i /><i /></div>
      <div className="pq-cloud pq-cloud-b"><i /><i /><i /></div>
      <div className="pq-cloud pq-cloud-c"><i /><i /><i /></div>

      {/* Skyline lejano (bruma) */}
      <div className="pq-skyline pq-skyline-far">
        {[90, 150, 70, 180, 120, 60, 160, 100, 140, 80, 170, 110].map((h, i) => (
          <div key={i} className="pq-tower-far" style={{ height: h }}>
            {i % 3 === 0 && <span className="pq-antenna" />}
          </div>
        ))}
      </div>
      {/* Skyline medio (con ventanas encendidas) */}
      <div className="pq-skyline pq-skyline-mid">
        {[70, 120, 95, 140, 80, 115, 90, 130].map((h, i) => (
          <div key={i} className="pq-tower-mid" style={{ height: h }} />
        ))}
      </div>

      {/* Edificio izquierdo: ladrillo, ventanas y toldo de tienda */}
      <div className="pq-bldg pq-bldg-left">
        <div className="pq-cornice" />
        <BuildingWindows rows={3} cols={3} lit={[1, 5]} />
        <div className="pq-awning" />
        <div className="pq-storefront"><div className="pq-door" /></div>
      </div>
      {/* Edificio derecho: fachada rojiza con letrero */}
      <div className="pq-bldg pq-bldg-right">
        <div className="pq-cornice" />
        <BuildingWindows rows={3} cols={3} lit={[4]} />
        <div className="pq-sign">BAR</div>
        <div className="pq-storefront pq-storefront-r" />
      </div>

      {/* Árboles frondosos */}
      <div className="pq-tree pq-tree-a">
        <div className="pq-foliage" />
        <div className="pq-trunk" />
      </div>
      <div className="pq-tree pq-tree-b">
        <div className="pq-foliage" />
        <div className="pq-trunk" />
      </div>

      {/* Farol */}
      <div className="pq-lamp"><div className="pq-lamp-arm" /><div className="pq-lamp-head" /></div>

      {/* Coche estacionado */}
      <div className="pq-car"><PixelSprite grid={CAR_GRID} palette={CAR_PALETTE} px={4} /></div>

      {/* Tarima y reflectores cuando hay canto o el fondo es escenario */}
      {stage && (
        <>
          <div className="pq-spot pq-spot-a" /><div className="pq-spot pq-spot-b" />
          <div className="pq-stage" />
        </>
      )}

      {/* Personajes en la banqueta */}
      <div className={`pq-actor pq-pepe${thinking ? ' pq-bounce' : singing ? ' pq-sing' : ''}`}>
        {singing && (
          <div className="pq-notes">
            <PixelSprite grid={NOTE_GRID} palette={{ N: '#f2efe6' }} px={3} style={{ position: 'absolute' }} />
          </div>
        )}
        <AnimatedSprite frames={[PEPE_GRID, PEPE_GRID_B]} palette={PEPE_PALETTE} px={5} speed={singing ? 0.4 : 0.9} />
        {wearsHeadphones && <div className="pq-headphones" />}
        <div className="pq-actor-tag">PEPE</div>
      </div>

      {/* Invitados de la escena (Ángela, Emiliano, fan…) */}
      {esc.personajes.map((p, i) => {
        const sp = EXTRA_SPRITES[p]
        if (!sp || thinking) return null
        return (
          <div key={p} className={`pq-actor pq-extra${singing && i === 0 ? ' pq-sing pq-sing-off' : ''}`}
            style={{ left: extraSlots[i] }}>
            {singing && i === 0 && (
              <div className="pq-notes pq-notes-b">
                <PixelSprite grid={NOTE_GRID} palette={{ N: '#f2efe6' }} px={3} style={{ position: 'absolute' }} />
              </div>
            )}
            <AnimatedSprite frames={sp.frames} palette={sp.palette} px={sp.px} speed={singing && i === 0 ? 0.4 : 0.8 + i * 0.15} />
            <div className="pq-actor-tag">{sp.tag}</div>
          </div>
        )
      })}

      <div className={`pq-actor pq-press${anim === 'entrevista' ? ' pq-press-close' : anim === 'foto' ? '' : ' pq-pace'}`}>
        <AnimatedSprite frames={[PRESS_GRID, PRESS_GRID_B]} palette={PRESS_PALETTE} px={4} speed={anim === 'foto' ? 0.35 : 1.1} />
        <div className="pq-actor-tag">PRENSA</div>
      </div>

      {/* Props ensamblados por el oráculo (mesa, mic, ON AIR, sofá, cámara…) */}
      {props.map((p, i) => <ScenePropPiece key={`${p.pieza}-${i}`} pieza={p.pieza} zona={p.zona} />)}

      {/* Efectos según la animación */}
      {anim === 'foto' && <div className="pq-flash" />}
      {anim === 'fiesta' && (
        <div className="pq-confetti">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{
              left: `${(i * 53) % 96 + 2}%`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              animationDelay: `${(i % 6) * 0.45}s`,
              animationDuration: `${2.2 + (i % 4) * 0.5}s`,
            }} />
          ))}
        </div>
      )}
      {anim === 'crisis' && <div className="pq-vignette" />}

      {/* Burbuja de diálogo */}
      {dlg && anchor && (
        <div key={`${dlgIdx}-${dlg.quien}`} className="pq-bubble" style={{ left: anchor.left, bottom: anchor.bottom }}>
          {dlg.texto}
          <span className="pq-bubble-tail" />
        </div>
      )}

      {/* Banqueta y calle */}
      <div className="pq-sidewalk"><div className="pq-curb" /></div>
      <div className="pq-road"><div className="pq-road-line" /></div>
    </div>
  )
}

// ── Cartas de escenario ───────────────────────────────────────────────────────

const RISK_COLORS: Record<SimScenario['riesgo'], string> = {
  bajo: '#57a943', medio: '#d9a441', alto: '#e07b39', critico: '#e0314b',
}

function ProbBar({ pct }: { pct: number }) {
  const filled = Math.round(pct / 10)
  return (
    <div className="pq-probbar">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="pq-probseg" style={{ background: i < filled ? '#57a943' : '#2c2634' }} />
      ))}
    </div>
  )
}

function ScenarioCard({ sc, onPick, disabled }: { sc: SimScenario; onPick: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const impactStr = `${sc.impacto_reputacion > 0 ? '+' : ''}${sc.impacto_reputacion}`
  return (
    <div className="pq-card" style={{ borderColor: RISK_COLORS[sc.riesgo] }}>
      <div className="pq-card-head">
        <span className="pq-card-prob">{sc.probabilidad}%</span>
        <span className="pq-card-title">{sc.titulo}</span>
        <span className="pq-chip" style={{ background: RISK_COLORS[sc.riesgo] }}>{sc.riesgo.toUpperCase()}</span>
      </div>
      <ProbBar pct={sc.probabilidad} />
      <div className="pq-card-meta">
        <span>⏱ {sc.horizonte}</span>
        <span style={{ color: sc.impacto_reputacion >= 0 ? '#57a943' : '#e0314b' }}>
          {sc.impacto_reputacion >= 0 ? '▲' : '▼'} REP {impactStr}
        </span>
      </div>
      <p className="pq-card-why">{sc.por_que}</p>
      {open && (
        <div className="pq-card-detail">
          {sc.senales.length > 0 && (
            <div>
              <div className="pq-detail-label">SEÑALES DEL MONITOREO</div>
              <ul>{sc.senales.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {sc.reaccion_redes && (
            <div>
              <div className="pq-detail-label">EN LAS REDES</div>
              <p>{sc.reaccion_redes}</p>
            </div>
          )}
        </div>
      )}
      <div className="pq-card-actions">
        <button className="pq-btn pq-btn-ghost" onClick={() => setOpen(o => !o)}>
          {open ? '− MENOS' : '+ DETALLE'}
        </button>
        <button className="pq-btn" disabled={disabled} onClick={onPick}>ESTO PASÓ ▶</button>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

const EXAMPLES = [
  'Pepe sube una foto con su hijo Emiliano',
  'Pepe lanza una canción con Ángela',
  'Pepe da una entrevista sobre la polémica',
  'Pepe se queda en silencio una semana',
]

type Phase = 'title' | 'input' | 'thinking' | 'results' | 'gameover' | 'victory'

export function PepeSimuladorTab() {
  const [reports, setReports] = useState<PepeReport[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('title')
  const [hearts, setHearts] = useState(5)
  const [day, setDay] = useState(1)
  const [action, setAction] = useState('')
  const [turn, setTurn] = useState<SimTurn | null>(null)
  const [history, setHistory] = useState<SimHistoryEntry[]>([])
  const [simError, setSimError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetchPepeReports()
      .then(rows => { if (alive) setReports(rows) })
      .catch(e => { if (alive) setLoadError(String(e?.message ?? e)) })
    return () => { alive = false }
  }, [])

  const baseRep = useMemo(() => reports ? initialReputation(reports) : null, [reports])

  function startGame() {
    setHearts(baseRep?.hearts ?? 5)
    setDay(1)
    setHistory([])
    setTurn(null)
    setSimError(null)
    setAction('')
    setPhase('input')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function runTurn(a: string) {
    if (!reports || !a.trim()) return
    setPhase('thinking')
    setSimError(null)
    try {
      const t = await simulateTurn(reports, history, a.trim())
      setTurn(t)
      setPhase('results')
    } catch (e) {
      setSimError(String((e as Error)?.message ?? e))
      setPhase('input')
    }
  }

  function pickScenario(sc: SimScenario) {
    const deltaHearts = sc.impacto_reputacion / 2
    const next = Math.max(0, Math.min(10, Math.round((hearts + deltaHearts) * 2) / 2))
    setHistory(h => [...h, { accion: action.trim(), escenario_ocurrido: sc.titulo, impacto: sc.impacto_reputacion }])
    setHearts(next)
    setDay(d => d + 1)
    setTurn(null)
    setAction('')
    if (next <= 0) setPhase('gameover')
    else if (next >= 10) setPhase('victory')
    else {
      setPhase('input')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const thinking = phase === 'thinking'

  return (
    <div className="pq-root">
      <style>{PQ_CSS}</style>

      <div className="pq-frame">
        {/* HUD */}
        <div className="pq-hud">
          <div className="pq-hud-left">
            <span className="pq-hud-label">REP</span>
            <HeartsBar hearts={hearts} />
          </div>
          <div className="pq-hud-right">
            <span className="pq-hud-pill">DÍA {day}</span>
            {baseRep && <span className="pq-hud-pill" style={{ background: '#4a2f3a' }}>RIESGO {baseRep.riesgo.toUpperCase()}</span>}
            <span className="pq-hud-pill" style={{ background: '#2f3a4a' }} title={`Modelo: ${SIM_MODEL}`}>🔮 {SIM_MODEL.split('/')[1]}</span>
          </div>
        </div>

        <GameScene thinking={thinking} escena={phase === 'results' ? turn?.escena : null} />

        {/* Pantalla título */}
        {phase === 'title' && (
          <div className="pq-overlay">
            <div className="pq-title">PEPE QUEST</div>
            <div className="pq-subtitle">SIMULADOR DE ESCENARIOS</div>
            <PixelHeart fill="full" px={7} />
            {loadError ? (
              <div className="pq-error">No cargaron los reportes: {loadError}</div>
            ) : !reports ? (
              <div className="pq-blink" style={{ marginTop: 18 }}>CARGANDO MONITOREO…</div>
            ) : (
              <>
                <div className="pq-loaded">✓ {reports.length} reportes reales cargados</div>
                <button className="pq-btn pq-btn-start pq-blink" onClick={startGame}>PRESS START</button>
              </>
            )}
          </div>
        )}

        {/* Diálogo de acción */}
        {phase === 'input' && (
          <div className="pq-dialog">
            <div className="pq-dialog-label">▼ ¿QUÉ HACE PEPE?</div>
            {simError && <div className="pq-error">⚠ {simError}</div>}
            <form onSubmit={e => { e.preventDefault(); runTurn(action) }} className="pq-dialog-row">
              <input
                ref={inputRef}
                className="pq-input"
                value={action}
                maxLength={300}
                placeholder='Ej. "Pepe sube una foto con su hijo Emiliano"'
                onChange={e => setAction(e.target.value)}
              />
              <button className="pq-btn" type="submit" disabled={!action.trim() || !reports}>GO ▶</button>
            </form>
            <div className="pq-examples">
              {EXAMPLES.map(ex => (
                <button key={ex} className="pq-example" onClick={() => { setAction(ex); inputRef.current?.focus() }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'thinking' && (
          <div className="pq-dialog">
            <div className="pq-dialog-label pq-blink">🔮 EL ORÁCULO CONSULTA LOS REPORTES…</div>
            <div className="pq-thinking-sub">jugada: “{action.trim()}”</div>
          </div>
        )}

        {phase === 'gameover' && (
          <div className="pq-overlay pq-overlay-dark">
            <div className="pq-title" style={{ color: '#e0314b' }}>GAME OVER</div>
            <div className="pq-subtitle">La reputación se desplomó</div>
            <button className="pq-btn pq-btn-start" onClick={startGame}>NEW GAME</button>
          </div>
        )}
        {phase === 'victory' && (
          <div className="pq-overlay">
            <div className="pq-title" style={{ color: '#d9a441' }}>¡LEYENDA!</div>
            <div className="pq-subtitle">Reputación al máximo</div>
            <button className="pq-btn pq-btn-start" onClick={startGame}>NEW GAME</button>
          </div>
        )}
      </div>

      {/* Resultados del turno */}
      {phase === 'results' && turn && (
        <div className="pq-results">
          <div className="pq-narrator">
            <span className="pq-narrator-badge">NARRADOR</span> {turn.lectura}
          </div>
          <div className="pq-cards">
            {turn.escenarios.map((sc, i) => (
              <ScenarioCard key={i} sc={sc} disabled={false} onPick={() => pickScenario(sc)} />
            ))}
          </div>
          <div className="pq-reco">
            <span className="pq-narrator-badge" style={{ background: '#2f3a4a' }}>ESTRATEGA</span> {turn.recomendacion}
          </div>
          <div className="pq-results-actions">
            <button className="pq-btn pq-btn-ghost" onClick={() => { setTurn(null); setPhase('input'); setTimeout(() => inputRef.current?.focus(), 50) }}>
              ↺ PROBAR OTRA JUGADA
            </button>
            <span className="pq-hint">…o elige "ESTO PASÓ" en un escenario para avanzar al día {day + 1}</span>
          </div>
        </div>
      )}

      {/* Bitácora */}
      {history.length > 0 && (
        <div className="pq-log">
          <div className="pq-log-title">📜 BITÁCORA DE LA PARTIDA</div>
          {history.map((h, i) => (
            <div key={i} className="pq-log-row">
              <span className="pq-log-day">DÍA {i + 1}</span>
              <span className="pq-log-action">{h.accion}</span>
              <span>→ {h.escenario_ocurrido}</span>
              <span style={{ color: h.impacto >= 0 ? '#57a943' : '#e0314b', fontWeight: 700 }}>
                {h.impacto >= 0 ? '▲' : '▼'}{Math.abs(h.impacto)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="pq-footnote">
        Basado en los {reports?.length ?? '…'} reportes reales del monitoreo de Pepe (Supabase dedicado, solo lectura) · Motor: {SIM_MODEL} · Las probabilidades son proyecciones de IA, no garantías.
      </div>
    </div>
  )
}

// ── CSS del juego ─────────────────────────────────────────────────────────────

const PQ_CSS = `
.pq-root { margin-top: 16px; font-family: 'Press Start 2P', 'Libre Franklin', monospace; }
.pq-frame {
  position: relative; border: 4px solid #22222a; border-radius: 6px; overflow: hidden;
  background: linear-gradient(#3d6fb0 0%, #4a83c6 34%, #5b95d6 60%, #6ba5e0 100%);
  box-shadow: 0 6px 0 #191920, 0 10px 24px rgba(0,0,0,.25);
  image-rendering: pixelated;
}
.pq-hud {
  position: relative; z-index: 5; display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: #191920; border-bottom: 4px solid #22222a;
}
.pq-hud-left { display: flex; align-items: center; gap: 10px; }
.pq-hud-label { color: #f5f2e8; font-size: 10px; }
.pq-hud-right { display: flex; gap: 8px; }
.pq-hud-pill { font-size: 8px; color: #f5f2e8; background: #3a3140; padding: 6px 8px; border-radius: 3px; letter-spacing: .5px; }

.pq-scene { position: relative; height: 340px; overflow: hidden;
  background: linear-gradient(#8fb6cc 0%, #a9c9d8 38%, #c6dde6 62%, #dde9ed 100%); }

/* ── Ambientes (los decide el oráculo según la situación) ── */
.pq-amb-atardecer { background: linear-gradient(#c96a5c 0%, #dd9273 38%, #eec49e 66%, #f6e0c2 100%); }
.pq-amb-atardecer::before { content: ''; position: absolute; inset: 0; z-index: 4; pointer-events: none;
  background: rgba(224, 122, 80, .14); }
.pq-amb-atardecer .pq-cloud { filter: sepia(.5) hue-rotate(-24deg) saturate(1.5) brightness(1.02); }
.pq-amb-atardecer .pq-skyline-far { filter: sepia(.4) hue-rotate(-18deg) brightness(.95); }
.pq-amb-atardecer .pq-skyline-mid { filter: sepia(.35) hue-rotate(-16deg) brightness(.82); }
.pq-sun { position: absolute; top: 44px; left: 47%; width: 64px; height: 64px; background: #f6d287;
  box-shadow: 0 0 0 8px rgba(246, 210, 135, .35), 0 0 48px 18px rgba(240, 160, 90, .5); border-radius: 50%; }

.pq-amb-noche { background: linear-gradient(#141c33 0%, #22304e 42%, #34466a 72%, #41536e 100%); }
.pq-amb-noche::before { content: ''; position: absolute; inset: 0; z-index: 4; pointer-events: none;
  background: rgba(10, 15, 40, .26); }
.pq-amb-noche .pq-cloud { opacity: .45; filter: brightness(.55) saturate(.6); }
.pq-amb-noche .pq-skyline-far { filter: brightness(.45); }
.pq-amb-noche .pq-skyline-mid { filter: brightness(.6); }
.pq-amb-noche .pq-bldg, .pq-amb-noche .pq-tree, .pq-amb-noche .pq-car { filter: brightness(.72); }
.pq-amb-noche .pq-window { background: linear-gradient(#e8c86a 55%, #c9a03c 55%); box-shadow: 0 0 14px rgba(232, 200, 106, .55); }
.pq-amb-noche .pq-lamp-head { box-shadow: 0 3px 0 #2c3038, 0 0 26px 10px rgba(232, 200, 106, .45); }
.pq-amb-noche .pq-sidewalk { filter: brightness(.7); }
.pq-amb-noche .pq-road { filter: brightness(.8); }
.pq-stars { position: absolute; inset: 0 0 40% 0;
  background-image: radial-gradient(#fff 1px, transparent 1.6px), radial-gradient(rgba(255,255,255,.7) 1px, transparent 1.6px);
  background-size: 130px 80px, 70px 120px; background-position: 24px 12px, 58px 44px; }
.pq-moon { position: absolute; top: 34px; left: 46%; width: 60px; height: 60px; background: #f2eedc; border-radius: 50%;
  box-shadow: inset -12px -8px 0 #d8d2ba, 0 0 30px 8px rgba(242, 238, 220, .3); }

/* Nubes pixel en dos tonos (con deriva lenta) */
.pq-cloud { position: absolute; animation: pq-drift 46s steps(60) infinite alternate; }
@keyframes pq-drift { from { margin-left: 0; } to { margin-left: 46px; } }
.pq-cloud i { position: absolute; background: #f6fafc; box-shadow: inset 0 -6px 0 #d7e6ec; }
.pq-cloud i:nth-child(1) { width: 84px; height: 22px; left: 0; top: 12px; }
.pq-cloud i:nth-child(2) { width: 44px; height: 20px; left: 16px; top: 0; background: #ffffff; }
.pq-cloud i:nth-child(3) { width: 34px; height: 14px; left: 66px; top: 4px; }
.pq-cloud-a { top: 26px; left: 24%; } .pq-cloud-b { top: 8px; right: 26%; transform: scale(1.3); }
.pq-cloud-c { top: 58px; left: 46%; transform: scale(.85); opacity: .92; }

/* Skyline en capas */
.pq-skyline { position: absolute; left: 0; right: 0; display: flex; align-items: flex-end; }
.pq-skyline-far { bottom: 132px; gap: 4px; padding: 0 4px; opacity: .8; }
.pq-tower-far { flex: 1; background: #b3c8d3; position: relative; }
.pq-antenna { position: absolute; top: -18px; left: 45%; width: 3px; height: 18px; background: #b3c8d3; }
.pq-skyline-mid { bottom: 132px; gap: 8px; padding: 0 30px; }
.pq-tower-mid { flex: 1; background: #7d97a6; box-shadow: inset -5px 0 0 #6b8494, inset 0 6px 0 #8ba4b2;
  background-image: radial-gradient(#dcebf1 1.5px, transparent 1.6px); background-size: 9px 12px; background-position: 3px 10px; }

/* Edificios de primer plano (ladrillo con ventanas reales) */
.pq-bldg { position: absolute; bottom: 132px; width: 168px; }
.pq-bldg-left { left: -8px; height: 208px; background: #8a5644;
  background-image: linear-gradient(rgba(0,0,0,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.10) 1px, transparent 1px);
  background-size: 100% 9px, 15px 9px; box-shadow: inset -8px 0 0 rgba(0,0,0,.18), inset 0 4px 0 rgba(255,255,255,.08); }
.pq-bldg-right { right: -8px; height: 188px; background: #a06048;
  background-image: linear-gradient(rgba(0,0,0,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.10) 1px, transparent 1px);
  background-size: 100% 9px, 15px 9px; box-shadow: inset 8px 0 0 rgba(0,0,0,.18), inset 0 4px 0 rgba(255,255,255,.08); }
.pq-cornice { position: absolute; top: 0; left: -4px; right: -4px; height: 8px; background: #6e4436; box-shadow: 0 3px 0 rgba(0,0,0,.2); }
.pq-bldg-windows { position: absolute; top: 20px; left: 14px; right: 14px; display: grid; gap: 12px 14px; }
.pq-window { height: 26px; background: linear-gradient(#33404e 55%, #55707f 55%); border: 3px solid #5d4033;
  box-shadow: inset 0 3px 0 rgba(255,255,255,.18); }
.pq-window-lit { background: linear-gradient(#e8c86a 55%, #c9a03c 55%); }
.pq-awning { position: absolute; bottom: 44px; left: 6px; right: 26px; height: 18px;
  background: repeating-linear-gradient(90deg, #7d5a9e 0 12px, #ece6f2 12px 24px);
  box-shadow: 0 4px 0 rgba(0,0,0,.22); }
.pq-storefront { position: absolute; bottom: 0; left: 6px; right: 26px; height: 44px; background: #4a3a30;
  box-shadow: inset 0 4px 0 rgba(255,255,255,.06); }
.pq-storefront-r { left: 20px; right: 8px; background: #3d4a42; }
.pq-door { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 26px; height: 34px;
  background: #26303a; box-shadow: inset 0 3px 0 #55707f; }
.pq-sign { position: absolute; bottom: 78px; left: -2px; width: 26px; padding: 6px 2px; background: #e8e0ce;
  color: #b04038; font-family: 'Press Start 2P', monospace; font-size: 9px; text-align: center; line-height: 1.4;
  writing-mode: vertical-rl; text-orientation: upright; box-shadow: 3px 3px 0 rgba(0,0,0,.25); }

/* Árboles frondosos (copa en 3 tonos) */
.pq-tree { position: absolute; bottom: 132px; width: 96px; height: 140px; }
.pq-tree-a { left: 172px; } .pq-tree-b { right: 178px; transform: scale(.88); transform-origin: bottom; }
.pq-foliage { position: absolute; top: 0; left: 10px; width: 76px; height: 84px; background: #5f8f62;
  box-shadow:
    -10px 20px 0 0 #4d7a52, 14px 16px 0 0 #729f74, 2px -8px 0 0 #7fae80,
    26px 30px 0 0 #4d7a52, -18px 38px 0 0 #5f8f62, 20px -4px 0 0 #6a9a6c,
    inset 0 -14px 0 rgba(0,0,0,.14); }
.pq-trunk { position: absolute; bottom: 0; left: 42px; width: 14px; height: 62px; background: #5d4430;
  box-shadow: inset -4px 0 0 #47331f, -8px -6px 0 0 #5d4430, 10px -10px 0 0 #47331f; }

/* Farol */
.pq-lamp { position: absolute; bottom: 84px; left: 46%; width: 6px; height: 130px; background: #2c3038;
  box-shadow: inset -2px 0 0 #1b1e24; }
.pq-lamp-arm { position: absolute; top: 0; left: 6px; width: 34px; height: 6px; background: #2c3038; }
.pq-lamp-head { position: absolute; top: 6px; left: 32px; width: 14px; height: 10px; background: #e8c86a;
  box-shadow: 0 3px 0 #2c3038, inset 0 -3px 0 #c9a03c; }

/* Coche estacionado en la calle */
.pq-car { position: absolute; bottom: 22px; right: 220px; }

/* Personajes */
.pq-actor { position: absolute; bottom: 88px; display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 3; }
.pq-pepe { left: 218px; }
.pq-press { left: 640px; opacity: .97; transition: left .8s steps(8); }
.pq-press-close { left: 330px; }
.pq-extra { z-index: 3; }
.pq-actor-tag { font-size: 7px; color: #f5f2e8; background: rgba(20,20,26,.78); padding: 3px 5px; border-radius: 2px; }
.pq-bounce { animation: pq-bounce .5s infinite alternate; }
@keyframes pq-bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
/* Animación por cuadros: dos frames de pixel art que alternan */
.pq-frame-a { animation: pq-frame-a 1s steps(1) infinite; }
.pq-frame-b { animation: pq-frame-b 1s steps(1) infinite; }
@keyframes pq-frame-a { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes pq-frame-b { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }
.pq-sing { animation: pq-sing .48s steps(2, end) infinite alternate; }
.pq-sing-off { animation-delay: .24s; }
@keyframes pq-sing { from { transform: translateY(0); } to { transform: translateY(-6px); } }
/* La prensa se pasea por la banqueta */
.pq-pace { animation: pq-pace 9s steps(52) infinite alternate; }
@keyframes pq-pace { from { margin-left: 0; } to { margin-left: -70px; } }

/* Notas musicales flotando */
.pq-notes { position: absolute; top: -8px; right: -14px; width: 20px; height: 40px; }
.pq-notes-b { right: auto; left: -14px; }
.pq-notes > div { animation: pq-note-rise 1.6s steps(6) infinite; }
@keyframes pq-note-rise {
  0% { transform: translateY(10px); opacity: 0; }
  25% { opacity: 1; }
  100% { transform: translateY(-34px); opacity: 0; }
}

/* Tarima de concierto y reflectores */
.pq-stage { position: absolute; bottom: 82px; left: 190px; width: 330px; height: 12px; z-index: 2;
  background: #6d4a2b; box-shadow: inset 0 3px 0 #8a6238, inset 0 -4px 0 #47331f, 0 4px 0 rgba(0,0,0,.25); }
.pq-spot { position: absolute; top: 0; width: 130px; height: 260px; z-index: 2; opacity: .8;
  background: linear-gradient(rgba(255,238,170,.0), rgba(255,238,170,.28)); }
.pq-spot-a { left: 200px; clip-path: polygon(42% 0, 58% 0, 100% 100%, 0 100%); }
.pq-spot-b { left: 370px; clip-path: polygon(42% 0, 58% 0, 100% 100%, 0 100%); }

/* Flash de cámaras */
.pq-flash { position: absolute; inset: 0; z-index: 6; background: #fff; pointer-events: none;
  animation: pq-flash 2.6s steps(1) infinite; }
@keyframes pq-flash { 0% { opacity: .75; } 4% { opacity: 0; } 38% { opacity: 0; } 40% { opacity: .55; } 44% { opacity: 0; } 100% { opacity: 0; } }

/* Confetti de fiesta */
.pq-confetti { position: absolute; inset: 0; z-index: 6; pointer-events: none; overflow: hidden; }
.pq-confetti i { position: absolute; top: -12px; width: 8px; height: 8px;
  animation: pq-conf-fall 2.8s steps(14) infinite; }
@keyframes pq-conf-fall {
  0% { transform: translateY(0) rotate(0deg); opacity: 1; }
  100% { transform: translateY(330px) rotate(340deg); opacity: .7; }
}

/* Crisis: temblor + viñeta roja. Silencio: escena apagada */
.pq-scene-crisis { animation: pq-shake .45s steps(2) infinite; }
@keyframes pq-shake { 0% { transform: translate(0,0); } 25% { transform: translate(-3px,1px); } 50% { transform: translate(3px,-1px); } 75% { transform: translate(-2px,-2px); } 100% { transform: translate(0,0); } }
.pq-vignette { position: absolute; inset: 0; z-index: 5; pointer-events: none;
  box-shadow: inset 0 0 80px rgba(200, 30, 45, .55); }
.pq-scene-dim::after { content: ''; position: absolute; inset: 0; z-index: 5; background: rgba(20, 22, 40, .38); pointer-events: none; }

/* Burbuja de diálogo */
.pq-bubble { position: absolute; z-index: 7; max-width: 210px; background: #fdfcf4; color: #191920;
  border: 3px solid #191920; border-radius: 4px; padding: 8px 10px;
  font-family: 'Press Start 2P', monospace; font-size: 8px; line-height: 1.7;
  box-shadow: 3px 3px 0 rgba(0,0,0,.3); animation: pq-bubble-in .18s steps(3); }
.pq-bubble-tail { position: absolute; bottom: -9px; left: 18px; width: 10px; height: 10px;
  background: #fdfcf4; border-right: 3px solid #191920; border-bottom: 3px solid #191920;
  transform: rotate(45deg); }
@keyframes pq-bubble-in { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* Banqueta y calle */
.pq-sidewalk { position: absolute; bottom: 46px; left: 0; right: 0; height: 42px; background: #c3c3ba;
  background-image: linear-gradient(90deg, rgba(0,0,0,.14) 2px, transparent 2px), linear-gradient(rgba(255,255,255,.25) 2px, transparent 2px);
  background-size: 34px 100%, 100% 21px; }
.pq-curb { position: absolute; bottom: 0; left: 0; right: 0; height: 7px; background: #9a9a90; box-shadow: inset 0 3px 0 rgba(255,255,255,.3); }
.pq-road { position: absolute; bottom: 0; left: 0; right: 0; height: 46px; background: #3d4148;
  box-shadow: inset 0 4px 0 #34383e; }
.pq-road-line { position: absolute; top: 20px; left: 0; right: 0; height: 5px;
  background: repeating-linear-gradient(90deg, #d8d5c8 0 26px, transparent 26px 52px); }

.pq-overlay { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  background: rgba(24, 22, 34, .55); backdrop-filter: blur(1px); text-align: center; padding: 20px; }
.pq-overlay-dark { background: rgba(12, 10, 18, .82); }
.pq-title { font-size: 34px; color: #f5f2e8; text-shadow: 4px 4px 0 #191920; letter-spacing: 2px; }
.pq-subtitle { font-size: 11px; color: #ffd9e2; text-shadow: 2px 2px 0 #191920; }
.pq-loaded { font-size: 9px; color: #a6e59b; text-shadow: 1px 1px 0 #191920; }
.pq-blink { animation: pq-blink 1s steps(2) infinite; }
@keyframes pq-blink { 50% { opacity: .25; } }

.pq-btn {
  font-family: inherit; font-size: 10px; color: #f5f2e8; background: #d9503f; border: 3px solid #191920;
  border-radius: 4px; padding: 10px 14px; cursor: pointer; box-shadow: 0 4px 0 #191920; letter-spacing: 1px;
}
.pq-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 5px 0 #191920; }
.pq-btn:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 2px 0 #191920; }
.pq-btn:disabled { opacity: .45; cursor: not-allowed; }
.pq-btn-start { font-size: 13px; padding: 14px 22px; background: #d9503f; }
.pq-btn-ghost { background: #3a3140; }

.pq-dialog { position: relative; z-index: 5; background: #191920; border-top: 4px solid #22222a; padding: 14px; }
.pq-dialog-label { font-size: 10px; color: #ffd9e2; margin-bottom: 10px; }
.pq-dialog-row { display: flex; gap: 10px; }
.pq-input {
  flex: 1; font-family: 'Libre Franklin', sans-serif; font-size: 14px; color: #f5f2e8; background: #22222a;
  border: 3px solid #3a3140; border-radius: 4px; padding: 10px 12px; outline: none;
}
.pq-input:focus { border-color: #d9a441; }
.pq-examples { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.pq-example {
  font-family: 'Libre Franklin', sans-serif; font-size: 12px; color: #cfc8d8; background: transparent;
  border: 2px dashed #3a3140; border-radius: 999px; padding: 5px 10px; cursor: pointer;
}
.pq-example:hover { color: #f5f2e8; border-color: #d9a441; }
.pq-thinking-sub { font-family: 'Libre Franklin', sans-serif; font-size: 12px; color: #8f8a99; }
.pq-error { font-family: 'Libre Franklin', sans-serif; font-size: 12px; color: #ff9d8f; background: #3a2026; border: 2px solid #e0314b; border-radius: 4px; padding: 8px 10px; margin-bottom: 10px; }

.pq-results { margin-top: 16px; }
.pq-narrator, .pq-reco {
  font-family: 'Libre Franklin', sans-serif; font-size: 14px; color: #2b2320; background: #fdf6d8;
  border: 3px solid #191920; border-radius: 6px; padding: 12px 14px; box-shadow: 0 4px 0 #191920; margin-bottom: 14px;
}
.pq-reco { background: #ddeaf6; margin-top: 14px; margin-bottom: 0; }
.pq-narrator-badge { font-family: 'Press Start 2P', monospace; font-size: 8px; color: #f5f2e8; background: #d9503f; padding: 4px 6px; border-radius: 3px; margin-right: 8px; vertical-align: 2px; }
.pq-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.pq-card { background: #191920; border: 3px solid; border-radius: 6px; padding: 14px; box-shadow: 0 4px 0 #0e0e13; display: flex; flex-direction: column; gap: 10px; }
.pq-card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pq-card-prob { font-size: 20px; color: #f5f2e8; text-shadow: 2px 2px 0 #0e0e13; }
.pq-card-title { font-family: 'Libre Franklin', sans-serif; font-weight: 700; font-size: 15px; color: #f5f2e8; flex: 1; min-width: 120px; }
.pq-chip { font-size: 7px; color: #191920; padding: 4px 6px; border-radius: 3px; font-weight: 700; }
.pq-probbar { display: flex; gap: 3px; }
.pq-probseg { flex: 1; height: 10px; border-radius: 1px; }
.pq-card-meta { display: flex; justify-content: space-between; font-size: 9px; color: #cfc8d8; }
.pq-card-why { font-family: 'Libre Franklin', sans-serif; font-size: 13px; line-height: 1.5; color: #d8d3e0; margin: 0; }
.pq-card-detail { font-family: 'Libre Franklin', sans-serif; font-size: 12px; color: #b9b3c4; background: #22222a; border-radius: 4px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.pq-card-detail ul { margin: 4px 0 0; padding-left: 18px; } .pq-card-detail p { margin: 4px 0 0; }
.pq-detail-label { font-family: 'Press Start 2P', monospace; font-size: 7px; color: #d9a441; }
.pq-card-actions { display: flex; justify-content: space-between; gap: 10px; margin-top: auto; }
.pq-results-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.pq-hint { font-family: 'Libre Franklin', sans-serif; font-size: 12px; color: #8f8a99; }

.pq-log { margin-top: 18px; background: #fdf6d8; border: 3px solid #191920; border-radius: 6px; padding: 12px 14px; box-shadow: 0 4px 0 #191920; }
.pq-log-title { font-size: 9px; color: #2b2320; margin-bottom: 10px; }
.pq-log-row { font-family: 'Libre Franklin', sans-serif; font-size: 13px; color: #2b2320; display: flex; gap: 10px; flex-wrap: wrap; padding: 6px 0; border-top: 1px dashed #c9bd93; align-items: baseline; }
.pq-log-day { font-family: 'Press Start 2P', monospace; font-size: 8px; color: #d9503f; }
.pq-log-action { font-weight: 600; }
.pq-footnote { font-family: 'Libre Franklin', sans-serif; font-size: 11px; color: #8f8a99; margin-top: 14px; }

/* ── Decorados por locación (cada fondo ≠ calle tapa el mundo) ── */
.pq-set { position: absolute; inset: 0; z-index: 1; }
.pq-set-wall { position: absolute; left: 0; right: 0; top: 0; height: 252px; }
.pq-set-floor { position: absolute; left: 0; right: 0; bottom: 0; height: 88px; background: #6a4a34;
  box-shadow: inset 0 6px 0 rgba(255,255,255,.06);
  background-image: linear-gradient(90deg, rgba(0,0,0,.12) 2px, transparent 2px); background-size: 42px 100%; }

/* Estudio de podcast: pared con paneles acústicos en cuña */
.pq-set-estudio .pq-set-wall { background: #2a2431; background-image:
  repeating-linear-gradient(45deg, rgba(255,255,255,.05) 0 9px, transparent 9px 18px),
  repeating-linear-gradient(-45deg, rgba(0,0,0,.20) 0 9px, transparent 9px 18px);
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.28); }

/* Foro de TV: pared con puntos + franja EN VIVO + piso de foro */
.pq-set-tv .pq-set-wall { background-color: #2b5080;
  background-image: radial-gradient(rgba(255,255,255,.08) 2px, transparent 3px), linear-gradient(#243b66, #37639e);
  background-size: 26px 26px, 100% 100%; background-repeat: repeat, no-repeat;
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.3); }
.pq-set-tv .pq-set-floor { background: #33373f; background-image: linear-gradient(90deg, rgba(255,255,255,.05) 2px, transparent 2px); background-size: 48px 100%; }
.pq-tv-strip { position: absolute; top: 14px; left: 24px; z-index: 2; background: #b3202a; border: 3px solid #14141a;
  padding: 5px 9px; box-shadow: 0 0 12px 2px rgba(224,49,75,.5); }
.pq-tv-strip span { font-family: 'Press Start 2P', monospace; font-size: 8px; color: #fff; letter-spacing: 1px; }

/* Alfombra roja / premiere: backdrop step-and-repeat + tapete + cordones */
.pq-set-evento { background: #14141a; }
.pq-evento-backdrop { position: absolute; top: 18px; left: 40px; right: 40px; height: 206px; background: #1c1230;
  border: 4px solid #0e0e13; display: grid; grid-template-columns: repeat(4, 1fr); align-content: center; gap: 20px 8px; padding: 16px; overflow: hidden; }
.pq-evento-backdrop span { font-family: 'Press Start 2P', monospace; font-size: 9px; color: #d9a441; opacity: .8; text-align: center; }
.pq-evento-carpet { position: absolute; left: 0; right: 0; bottom: 0; height: 108px; background: #9a1f2a;
  box-shadow: inset 0 6px 0 rgba(255,255,255,.12), inset 0 0 0 8px #7a1420; }
.pq-evento-rope { position: absolute; bottom: 96px; width: 7px; height: 34px; background: #14141a; z-index: 2; }
.pq-evento-rope::before { content: ''; position: absolute; top: -8px; left: -5px; width: 17px; height: 11px; background: #d9a441; border-radius: 3px; }
.pq-evento-rope-l { left: 118px; } .pq-evento-rope-r { right: 118px; }

/* Palenque / concierto: venue oscuro + público en silueta */
.pq-set-escenario { background: linear-gradient(#0b0a14, #1b1830 60%, #241f38); }
.pq-venue { position: absolute; inset: 0; box-shadow: inset 0 0 120px rgba(0,0,0,.6);
  background-image: radial-gradient(rgba(120,90,180,.18) 1px, transparent 2px); background-size: 60px 60px; }
.pq-crowd { position: absolute; left: 0; right: 0; bottom: 46px; height: 60px; display: flex; align-items: flex-end; justify-content: center; gap: 6px; z-index: 2; }
.pq-crowd i { width: 16px; height: 34px; background: #0c0b12; border-radius: 8px 8px 0 0; box-shadow: 0 0 0 2px rgba(120,90,180,.12);
  animation: pq-sway 1.6s steps(2) infinite alternate; }
.pq-crowd i:nth-child(even) { height: 42px; animation-duration: 1.9s; }
.pq-crowd i:nth-child(3n) { height: 30px; animation-duration: 2.2s; }
@keyframes pq-sway { to { transform: translateY(-3px); } }

/* Reposicionar actores según la locación */
.pq-fondo-estudio .pq-pepe, .pq-fondo-foro_tv .pq-pepe,
.pq-fondo-grabacion .pq-pepe, .pq-fondo-casa .pq-pepe, .pq-fondo-conferencia .pq-pepe,
.pq-fondo-aeropuerto .pq-pepe, .pq-fondo-restaurante .pq-pepe, .pq-fondo-juzgado .pq-pepe, .pq-fondo-hospital .pq-pepe { left: 250px; }
.pq-fondo-estudio .pq-press, .pq-fondo-foro_tv .pq-press,
.pq-fondo-grabacion .pq-press, .pq-fondo-casa .pq-press,
.pq-fondo-restaurante .pq-press, .pq-fondo-hospital .pq-press { opacity: .5; }
.pq-fondo-escenario .pq-press { opacity: .55; }

/* ── Sets extra: aeropuerto, restaurante, juzgado, hospital ── */
.pq-set-aeropuerto .pq-set-wall { background-color: #cfd8e0; background-image: linear-gradient(#dbe3ea, #c2ccd6); box-shadow: inset 0 -12px 0 rgba(0,0,0,.12); }
.pq-set-aeropuerto .pq-set-floor { background: #9aa4ad; background-image: linear-gradient(90deg, rgba(0,0,0,.10) 2px, transparent 2px), linear-gradient(rgba(255,255,255,.3) 2px, transparent 2px); background-size: 44px 100%, 100% 22px; }
.pq-airport-window { position: absolute; top: 44px; left: 40px; right: 40px; height: 150px; z-index: 1; background: linear-gradient(#bfe3ea 60%, #dfeef2); border: 6px solid #8a95a0; box-shadow: inset 0 0 0 2px rgba(255,255,255,.4);
  background-image: linear-gradient(90deg, transparent 0 24%, #8a95a0 24% 26%, transparent 26% 74%, #8a95a0 74% 76%, transparent 76%); }
.pq-airport-plane { position: absolute; bottom: 26px; left: 40%; width: 130px; height: 24px; background: #eef1f5; border-radius: 40% 12px 12px 40%; box-shadow: -2px 0 0 #cfd8e0; }
.pq-airport-plane::before { content: ''; position: absolute; top: -13px; left: 52px; width: 38px; height: 16px; background: #eef1f5; transform: skewX(-38deg); }
.pq-airport-plane::after { content: ''; position: absolute; top: 8px; left: 40px; width: 44px; height: 9px; background: #4a83c6; }
.pq-airport-board { position: absolute; top: 16px; right: 26px; z-index: 2; background: #14141a; border: 3px solid #0e0e13; padding: 5px 8px; display: flex; flex-direction: column; gap: 3px; }
.pq-airport-board span { font-family: 'Press Start 2P', monospace; font-size: 6px; color: #57a943; }

.pq-set-restaurante .pq-set-wall { background-color: #5a3a30; background-image: linear-gradient(#6a4436, #4a3026);
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.25); }
.pq-set-restaurante .pq-set-floor { background: #3a2620; background-image: repeating-linear-gradient(90deg, rgba(0,0,0,.14) 0 2px, transparent 2px 46px); }
.pq-resto-window { position: absolute; top: 50px; left: 54px; width: 120px; height: 90px; z-index: 1; background: linear-gradient(#26304a, #1a2236); border: 8px solid #3a2414; box-shadow: inset 0 0 20px rgba(255,238,170,.15);
  background-image: radial-gradient(rgba(232,200,106,.5) 1px, transparent 2px); background-size: 20px 20px; }
.pq-resto-lamp { position: absolute; top: 0; right: 150px; width: 4px; height: 70px; background: #2c2118; z-index: 1; }
.pq-resto-lamp::after { content: ''; position: absolute; bottom: -22px; left: -20px; width: 44px; height: 26px; background: #d9a441; border-radius: 0 0 40% 40%; box-shadow: 0 8px 30px 6px rgba(232,200,106,.45); }

.pq-set-juzgado .pq-set-wall { background-color: #6a4a30; background-image: linear-gradient(#7a5638, #5a3f28);
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.28); }
.pq-set-juzgado .pq-set-floor { background: #4a3320; }
.pq-court-col { position: absolute; top: 0; width: 34px; height: 210px; z-index: 1; background: linear-gradient(90deg, #d9cdb6, #f0e8d6 40%, #d9cdb6);
  box-shadow: inset -6px 0 0 rgba(0,0,0,.12); background-image: repeating-linear-gradient(90deg, rgba(0,0,0,.06) 0 6px, transparent 6px 10px); }
.pq-court-col-a { left: 60px; } .pq-court-col-b { right: 60px; }
.pq-court-seal { position: absolute; top: 40px; left: 50%; transform: translateX(-50%); width: 74px; height: 74px; z-index: 1; border-radius: 50%; background: #3a2b16; box-shadow: inset 0 0 0 5px #d9a441, 0 0 0 3px #2a2010; }
.pq-court-seal::after { content: '★'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 30px; color: #d9a441; }
.pq-court-bench { position: absolute; bottom: 88px; left: 50%; transform: translateX(-50%); width: 260px; height: 40px; z-index: 1; background: #3a2414; box-shadow: inset 0 4px 0 #5a3418, 0 4px 0 rgba(0,0,0,.3); }

.pq-set-hospital .pq-set-wall { background-color: #cfe0e0; background-image: linear-gradient(#dbeaea, #bcd2d2); box-shadow: inset 0 -12px 0 rgba(0,0,0,.10); }
.pq-set-hospital .pq-set-floor { background: #aebcc0; background-image: linear-gradient(90deg, rgba(0,0,0,.08) 2px, transparent 2px); background-size: 44px 100%; }
.pq-hosp-cross { position: absolute; top: 30px; left: 60px; width: 46px; height: 46px; z-index: 1; }
.pq-hosp-cross::before, .pq-hosp-cross::after { content: ''; position: absolute; background: #d94f4f; }
.pq-hosp-cross::before { top: 0; left: 17px; width: 12px; height: 46px; } .pq-hosp-cross::after { top: 17px; left: 0; width: 46px; height: 12px; }
.pq-hosp-window { position: absolute; top: 44px; right: 50px; width: 110px; height: 92px; z-index: 1; background: linear-gradient(#bfe3ea, #9fc9d4); border: 6px solid #9aabab; box-shadow: inset 0 0 0 2px rgba(255,255,255,.4);
  background-image: linear-gradient(90deg, transparent 47%, #9aabab 47% 53%, transparent 53%); }

/* ── Props extra ── */
.pq-prop-maleta { width: 38px; height: 44px; }
.pq-prop-maleta i { position: absolute; bottom: 0; left: 0; width: 38px; height: 34px; background: #4a5568; border: 3px solid #20232b; border-radius: 4px; box-shadow: inset 0 0 0 2px rgba(255,255,255,.06); }
.pq-prop-maleta i::after { content: ''; position: absolute; top: -9px; left: 11px; width: 16px; height: 10px; border: 3px solid #20232b; border-bottom: none; border-radius: 6px 6px 0 0; }
.pq-prop-plato i { display: block; width: 34px; height: 12px; background: #eef1f5; border-radius: 50%; box-shadow: 0 3px 0 #c2ccd6, inset 0 0 0 5px rgba(180,120,80,.5); }
.pq-prop-bandera { width: 46px; height: 150px; }
.pq-prop-bandera b { position: absolute; bottom: 0; left: 4px; width: 5px; height: 150px; background: #6e5a2e; }
.pq-prop-bandera i { position: absolute; top: 0; left: 9px; width: 42px; height: 30px; background: linear-gradient(90deg, #4e7a4a 33%, #f0e8d6 33% 66%, #b04555 66%); box-shadow: 0 2px 0 rgba(0,0,0,.2); }
.pq-prop-cama { width: 130px; height: 44px; }
.pq-prop-cama i { position: absolute; bottom: 0; left: 0; width: 130px; height: 24px; background: #cdd8dd; border: 3px solid #8a95a0; border-radius: 3px; }
.pq-prop-cama b { position: absolute; bottom: 20px; left: 0; width: 40px; height: 20px; background: #eef1f5; border: 3px solid #8a95a0; border-radius: 4px 4px 0 0; }

/* Audífonos sobre Pepe (podcast) */
.pq-headphones { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); width: 56px; height: 26px;
  border: 6px solid #20232b; border-bottom: none; border-radius: 28px 28px 0 0; z-index: 4; }
.pq-headphones::before, .pq-headphones::after { content: ''; position: absolute; bottom: -7px; width: 11px; height: 18px; background: #20232b; border-radius: 3px; }
.pq-headphones::before { left: -6px; } .pq-headphones::after { right: -6px; }

/* ── Props componibles (CSS crisp) ── */
.pq-prop { position: absolute; image-rendering: pixelated; }
.pq-prop-mesa { width: 250px; height: 46px; margin-left: -70px; background: #3a2e26; border: 4px solid #20232b; border-radius: 4px;
  box-shadow: inset 0 6px 0 rgba(255,255,255,.06), 0 4px 0 #14100c; }
.pq-prop-mic { width: 14px; height: 54px; }
.pq-prop-mic b { position: absolute; bottom: 0; left: 5px; width: 4px; height: 34px; background: #16171c; }
.pq-prop-mic i { position: absolute; bottom: 30px; left: 0; width: 14px; height: 20px; background: #2b2b33; border: 2px solid #14141a; border-radius: 6px;
  background-image: repeating-linear-gradient(#4a4a55 0 2px, #2b2b33 2px 4px); }
.pq-prop-onair { font-family: 'Press Start 2P', monospace; font-size: 10px; color: #fff; background: #b3202a;
  border: 3px solid #14141a; border-radius: 4px; padding: 6px 8px; box-shadow: 0 0 14px 3px rgba(224,49,75,.6); letter-spacing: 1px; }
.pq-prop-planta { width: 30px; height: 54px; }
.pq-prop-planta i { position: absolute; bottom: 18px; left: 0; width: 30px; height: 34px; background: #4d7a52; border-radius: 50% 50% 40% 40%;
  box-shadow: -8px 6px 0 -2px #5f8f62, 8px 4px 0 -2px #729f74; }
.pq-prop-planta b { position: absolute; bottom: 0; left: 6px; width: 18px; height: 20px; background: #9a5a34; border: 2px solid #6e4436; }
.pq-prop-laptop i { display: block; width: 42px; height: 26px; background: #20232b; border: 2px solid #14141a; border-radius: 2px;
  box-shadow: 0 14px 0 -2px #3a3f4a; }
.pq-prop-camara { width: 40px; height: 60px; }
.pq-prop-camara i { position: absolute; bottom: 34px; left: 0; width: 40px; height: 26px; background: #26262e; border: 3px solid #14141a; border-radius: 3px; }
.pq-prop-camara i::after { content: ''; position: absolute; top: 6px; right: -8px; width: 10px; height: 10px; border-radius: 50%; background: #4a83c6; box-shadow: 0 0 0 3px #26262e; }
.pq-prop-camara b { position: absolute; bottom: 0; left: 14px; width: 10px; height: 34px; background: #16171c; }
.pq-prop-sofa { width: 120px; height: 40px; background: #6d3550; border: 4px solid #20232b; border-radius: 10px 10px 4px 4px;
  box-shadow: inset 0 -10px 0 rgba(0,0,0,.2); }
.pq-prop-reflector i { display: block; width: 30px; height: 18px; background: #d9a441; border: 3px solid #14141a; border-radius: 3px;
  box-shadow: 0 44px 70px 34px rgba(255,238,170,.16); }
.pq-prop-bocina { width: 34px; height: 56px; background: #1c1c22; border: 3px solid #14141a; border-radius: 3px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center; }
.pq-prop-bocina i { width: 22px; height: 22px; border-radius: 50%; background: #33333d; box-shadow: inset 0 0 0 3px #14141a; }
.pq-prop-monitor i { display: block; width: 96px; height: 58px; background: #0e0e13; border: 4px solid #20232b; border-radius: 3px;
  background-image: linear-gradient(135deg, #1f3a5c, #2b5080); }
.pq-prop-tarima { width: 340px; height: 12px; background: #6d4a2b; box-shadow: inset 0 3px 0 #8a6238, inset 0 -4px 0 #47331f, 0 4px 0 rgba(0,0,0,.25); }
.pq-prop-alfombra { height: 30px; background: #9a1f2a; box-shadow: inset 0 4px 0 rgba(255,255,255,.12), inset 0 0 0 4px #7a1420; }
.pq-prop-backdrop { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 10px; width: 170px; height: 92px; padding: 10px; background: #14141a; border: 3px solid #0e0e13; align-content: center; }
.pq-prop-backdrop span { font-family: 'Press Start 2P', monospace; font-size: 6px; color: #d9a441; opacity: .85; }

/* ── Sets nuevos ── */
/* Rancho charro */
.pq-set-rancho { background: #cfe3ec; }
.pq-rancho-sky { position: absolute; inset: 0 0 40% 0; background: linear-gradient(#8fc0d8, #cfe3ec); }
.pq-rancho-mtn { position: absolute; left: 0; right: 0; bottom: 128px; height: 90px;
  background:
    radial-gradient(120px 90px at 20% 100%, #7a8a6b 0 99%, transparent 100%),
    radial-gradient(160px 110px at 55% 100%, #6b7d5c 0 99%, transparent 100%),
    radial-gradient(130px 95px at 85% 100%, #7a8a6b 0 99%, transparent 100%); }
.pq-rancho-field { position: absolute; left: 0; right: 0; bottom: 0; height: 132px;
  background: linear-gradient(#9aae54, #7e8f42); box-shadow: inset 0 8px 0 rgba(255,255,255,.08); }
.pq-rancho-fence { position: absolute; left: 0; right: 0; bottom: 118px; height: 24px;
  background: linear-gradient(transparent 5px, #8a6238 5px 9px, transparent 9px 16px, #8a6238 16px 20px, transparent 20px); }
.pq-rancho-fence::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 46px, #7a5230 46px 52px); }
.pq-agave { position: absolute; bottom: 94px; width: 40px; height: 40px; z-index: 1; }
.pq-agave::before, .pq-agave::after { content: ''; position: absolute; bottom: 0; left: 16px; width: 8px; height: 34px; background: #4e7a4a; border-radius: 4px; transform-origin: bottom; box-shadow: 0 0 0 1px #3c6139; }
.pq-agave::before { transform: rotate(-30deg); } .pq-agave::after { transform: rotate(30deg); }
.pq-agave-a { left: 60px; } .pq-agave-b { left: 150px; transform: scale(.85); } .pq-agave-c { right: 90px; transform: scale(1.1); }

/* Estudio de grabación */
.pq-set-grabacion .pq-set-wall { background-color: #241f2b; background-image: linear-gradient(#2c2636, #1c1826);
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.3); }
.pq-set-grabacion .pq-set-floor { background: #3a3340; }
.pq-grab-glass { position: absolute; top: 40px; left: 44px; right: 44px; height: 150px; z-index: 1;
  background: linear-gradient(120deg, rgba(120,160,200,.16), rgba(120,160,200,.04));
  border: 4px solid #3a4a5a; box-shadow: inset 0 0 0 2px rgba(255,255,255,.05);
  background-image: repeating-linear-gradient(115deg, rgba(255,255,255,.06) 0 2px, transparent 2px 28px); }

/* Casa / sala familiar */
.pq-set-casa .pq-set-wall { background-color: #b98a5e; background-image: linear-gradient(#c39668, #a97c50);
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.16); }
.pq-set-casa .pq-set-floor { background: #7a4f2e; background-image: repeating-linear-gradient(90deg, rgba(0,0,0,.10) 0 2px, transparent 2px 40px); }
.pq-casa-window { position: absolute; top: 46px; left: 56px; width: 118px; height: 96px; z-index: 1;
  background: linear-gradient(#bfe3ea, #8fc0d8); border: 8px solid #6e4a2e; box-shadow: inset 0 0 0 2px #5a3c24; }
.pq-casa-window::before { content: ''; position: absolute; inset: 0; background:
  linear-gradient(90deg, transparent 47%, #6e4a2e 47% 53%, transparent 53%),
  linear-gradient(transparent 47%, #6e4a2e 47% 53%, transparent 53%); }
.pq-casa-frame { position: absolute; width: 44px; height: 54px; z-index: 1; background: #d9c69c; border: 5px solid #8a6238; box-shadow: 0 3px 0 rgba(0,0,0,.2); }
.pq-casa-frame::before { content: ''; position: absolute; inset: 6px; background: linear-gradient(135deg, #b04555, #d9a441); }
.pq-casa-frame-a { top: 66px; right: 150px; } .pq-casa-frame-b { top: 98px; right: 82px; transform: scale(.82); }

/* Conferencia de prensa */
.pq-set-conf .pq-set-wall { background-color: #223047; background-image: linear-gradient(#28374f, #1b2740);
  box-shadow: inset 0 -12px 0 rgba(0,0,0,.3); }
.pq-set-conf .pq-set-floor { background: #2b2f38; }
.pq-conf-backdrop { position: absolute; top: 26px; left: 60px; right: 60px; height: 150px; z-index: 1; background: #16305a; border: 4px solid #0e1a30;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 8px; align-content: center; padding: 14px; overflow: hidden; }
.pq-conf-backdrop span { font-family: 'Press Start 2P', monospace; font-size: 8px; color: #cdd8ee; opacity: .7; text-align: center; }

/* ── Props nuevos ── */
.pq-prop-consola { width: 150px; height: 30px; margin-left: -50px; background: #1c1c24; border: 3px solid #14141a; border-radius: 3px;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 5px; }
.pq-prop-consola i { background: #33333d; border-radius: 1px; box-shadow: inset 0 0 0 1px #4a4a55; }
.pq-prop-consola i:nth-child(3n) { background: #57a943; } .pq-prop-consola i:nth-child(4n) { background: #d9a441; }
.pq-prop-guitarra { width: 20px; height: 68px; }
.pq-prop-guitarra i { position: absolute; bottom: 0; left: 0; width: 20px; height: 26px; background: #9a5a2e; border: 2px solid #5a3418; border-radius: 50% 50% 45% 45%; }
.pq-prop-guitarra b { position: absolute; bottom: 22px; left: 8px; width: 5px; height: 44px; background: #3a2414; }
.pq-prop-podio { width: 46px; height: 60px; }
.pq-prop-podio span { position: absolute; bottom: 0; left: 4px; width: 38px; height: 44px; background: #4a5568; border: 3px solid #20232b; clip-path: polygon(14% 0, 86% 0, 100% 100%, 0 100%); }
.pq-prop-podio i { position: absolute; bottom: 44px; left: 20px; width: 4px; height: 16px; background: #16171c; }
.pq-prop-podio b { position: absolute; bottom: 56px; left: 14px; width: 14px; height: 8px; background: #2b2b33; border: 2px solid #14141a; border-radius: 6px; }
`
