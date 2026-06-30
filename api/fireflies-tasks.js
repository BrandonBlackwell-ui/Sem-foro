const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY || '';

const MOCK_MEETINGS = [
  {
    id: 'ff-1',
    title: 'Alineación Editorial Semanal Blackwell',
    date: '2026-06-29T10:00:00Z',
    duration: 2700, // 45 mins
    summary: 'Reunión semanal de coordinación del equipo Blackwell. Se definieron las prioridades de contenido para los clientes principales, centrándose en el reporte de sostenibilidad de TIP México y la respuesta digital ante las menciones críticas a los contratos de Grupo Andrade.',
    action_items: [
      'Sandra Cortés: Redactar boletín de prensa sobre la flota híbrida y eléctrica de TIP México para envío a El Economista.',
      'Humberto Herrera: Revisar y autorizar la propuesta de diagnóstico fiscal y arrendamiento puro para el cliente Dalinde.',
      'Orwell: Coordinar la junta de seguimiento operativo con el director general de Apollo el próximo viernes.',
      'Fabiola: Actualizar el cronograma del equipo en Monday para reflejar el soporte al evento de Expo Mecánico de Turbofin.'
    ]
  },
  {
    id: 'ff-2',
    title: 'Planificación de Campaña B2B Mundial 2026',
    date: '2026-06-25T14:30:00Z',
    duration: 3600, // 60 mins
    summary: 'Sesión de lluvia de ideas y definición de tácticas para el lanzamiento de la campaña "Detrás de cada gran evento" de Turbofin orientada al Mundial de Fútbol 2026. Se discutió la distribución de presupuestos y canales de difusión.',
    action_items: [
      'Daniel Padilla: Diseñar mockups visuales para los carruseles informativos y publicaciones de Instagram para Turbofin.',
      'Angel: Configurar la campaña de anuncios pagados en LinkedIn dirigida a directores de movilidad y operaciones.',
      'Luis Pacheco: Redactar el guion del video institucional de 30 segundos sobre el impacto ciudadano del arrendamiento puro.'
    ]
  },
  {
    id: 'ff-3',
    title: 'Sesión Extraordinaria - Gestión de Riesgo Grupo Andrade',
    date: '2026-06-23T09:00:00Z',
    duration: 1800, // 30 mins
    summary: 'Reunión de emergencia para evaluar el impacto reputacional derivado de las columnas políticas que cuestionan licitaciones públicas de Grupo Andrade. Se acordó la postura oficial y los mensajes clave para medios.',
    action_items: [
      'Orwell: Redactar documento confidencial de posturas clave y argumentario (Q&A) ante cuestionamientos de prensa.',
      'Sol Guerrero: Monitorear en tiempo real la evolución de las menciones a Grupo Andrade en X y Facebook.'
    ]
  },
  {
    id: 'ff-4',
    title: 'Revisión y Ajuste - CIMA & AZVI Onboarding',
    date: '2026-06-18T11:00:00Z',
    duration: 2400, // 40 mins
    summary: 'Junta de seguimiento para el proceso de onboarding de los nuevos clientes CIMA y AZVI. Se revisaron los accesos a datos y la asignación de analistas líderes para cada cuenta.',
    action_items: [
      'Uriel: Validar la integración del webhook de Supabase y Monday para la cuenta de CIMA.',
      'Elena Crespo: Enviar documentación de contacto operativa y lista de voceros autorizados del lado de AZVI.'
    ]
  }
];

async function fetchFromFireflies() {
  const query = `
    query {
      transcripts(limit: 20) {
        id
        title
        dateString
        duration
        summary {
          short_summary
          action_items
        }
      }
    }
  `;

  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIREFLIES_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Fireflies API HTTP error: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Fireflies GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const list = json.data?.transcripts || [];
  return list.map(item => ({
    id: item.id,
    title: item.title,
    date: item.dateString || new Date().toISOString(),
    duration: item.duration || 0,
    summary: item.summary?.short_summary || 'Sin resumen disponible.',
    action_items: item.summary?.action_items || []
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (!FIREFLIES_API_KEY) {
    console.log('[fireflies-tasks] No API key configured. Serving mock data.');
    return res.status(200).json(MOCK_MEETINGS);
  }

  try {
    const data = await fetchFromFireflies();
    return res.status(200).json(data);
  } catch (err) {
    console.error('[fireflies-tasks] Error fetching from API, falling back to mock data:', err);
    // Even if API fails, return mock data to prevent blocking the frontend dashboard
    return res.status(200).json(MOCK_MEETINGS);
  }
}
