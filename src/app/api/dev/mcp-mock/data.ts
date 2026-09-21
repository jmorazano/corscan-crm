/**
 * Datos del mcp-mock (016): copia literal de las respuestas REALES del MCP de
 * Altos de Calamuchita capturadas el 21-sep-2026 con credencial
 * (`scratchpad/fixtures/*.json`). Se copian tal cual —descripciones de 1.300 a
 * 2.500 B incluidas— porque el valor del mock es reproducir el TAMAÑO real
 * (hallazgo 8: 19 KB con 5 resultados): si el mock devolviera datos flacos, el
 * render condensado del perfil y el tope de bytes del transporte nunca se
 * ejercitarían.
 *
 * Único dato NO capturado: el precio, la seña y la estadía mínima de AC-003
 * (el fixture `show-property.json` no cotiza). Van marcados abajo.
 *
 * Este módulo es solo-datos: sin imports, sin lógica. La lógica vive en
 * `engine.ts`.
 */

export type McpMockFacility = {
  id: number;
  name: string;
  description: string;
  in_site_filter: boolean;
};

export type McpMockDetail = { name: string; value: string };

export type McpMockProperty = {
  id: string;
  name: string;
  slug: string;
  code: string;
  slogan: string;
  description: string;
  types: string[];
  capacity: number;
  bedrooms: number;
  bathrooms: number;
  square_meters: number;
  city: string;
  neighborhood: string;
  location_reference: string;
  facilities: string[];
  details: McpMockDetail[];
  image: string;
  /** Noches mínimas; null = sin mínimo. */
  minStay: number | null;
  /** Tarifa por noche en ARS (fija por propiedad). */
  pricePerNight: number;
  /** Cargo fijo de servicios por estadía (no por noche). */
  services: number;
  /**
   * Seña como fracción del total. Se guarda como la división literal del
   * fixture para que con 2 noches el resultado sea EXACTAMENTE el real: la
   * seña NO es un porcentaje fijo, varía por propiedad (hallazgo 14).
   */
  depositRate: number;
};

export const MCP_MOCK_SITE_BASE = "https://altosdecalamuchita.com";

export const MCP_MOCK_CURRENCY = "ARS";

export const MCP_MOCK_PROPERTIES: readonly McpMockProperty[] = [
  {
    id: "467904236771c73cb4059bb022753471",
    name: "Alquiler Temporario Casa Camiare | Potrero de Garay",
    slug: "alquiler-temporario-casa-camiare-potrero-de-garay",
    code: "AC-004",
    slogan: "Camiare // Lavandas & Lago",
    description:
      "Descubrí a Camiare, una exclusiva casa premium de alquiler temporario en Potrero de Garay, ideal para quienes buscan contemplar, desconectar y vivir una experiencia inmersiva frente al Dique Los Molinos, en pleno Valle de Calamuchita. Con impactantes vistas panorámicas 360° al lago y las sierras de Córdoba, esta residencia combina confort, privacidad y paisajes inolvidables.\nSus hermosos campos de lavanda, la piscina con vistas abiertas, el fogonero exterior y una cálida salamandra interior crean el escenario perfecto para compartir momentos memorables en cualquier época del año. Desde su galería, cada amanecer y atardecer se transforma en una experiencia única frente al paisaje serrano.\nAdemás, dentro del mismo entorno privado, un hermoso arroyo serrano a solo 300 metros de la propiedad suma una experiencia única de conexión con la naturaleza.\n\nExperiencia y Servicios Exclusivos:\n• Vista panorámica 360° al Dique Los Molinos: Un escenario privilegiado para contemplar el lago, las sierras y los mejores atardeceres.\n• Campos de lavanda: Un entorno natural único que convierte cada estadía en una experiencia visual y sensorial inolvidable.\n• Piscina con vistas abiertas: Ideal para relajarse contemplando el paisaje serrano.\n• Fogonero exterior | Noches memorables: El espacio perfecto para compartir largas conversaciones bajo las estrellas.\n• Calidez interior todo el año: Salamandra diseñada para disfrutar momentos cálidos y acogedores frente al paisaje.\n• Arroyo serrano dentro del entorno: A solo 300 metros, disfrutá de un hermoso arroyo natural rodeado de tranquilidad.\n• Desconexión exclusiva: Ideal para escapadas de relax, naturaleza y experiencias memorables en las sierras de Córdoba.",
    types: ["Casa"],
    capacity: 8,
    bedrooms: 3,
    bathrooms: 3,
    square_meters: 300,
    city: "Potrero de Garay",
    neighborhood: "Camiare",
    location_reference: "Potrero de Garay",
    facilities: [
      "Quincho con asador",
      "Wifi / Smart tv",
      "Aire Acondicionado / Calefacción",
      "Salamandra a Leña",
      "Piscina",
      "Baño social",
      "Cochera Cubierta",
      "Ropa Blanca",
      "Terraza Panorámica",
      "Lavavajillas",
      "Fogonero",
      "Baño en suite",
      "Baño completo",
      "Sommier 2 plazas y media",
      "Sommier 1 plaza",
      "Tostadora Eléctrica",
      "Pava Eléctrica",
      "Lavarropas",
      "Cocina 4 hornallas",
      "Heladera",
      "Microondas",
      "Vajilla",
      "Secador de cabello",
      "Cafetera eléctrica",
      "Pava",
      "Horno eléctrico",
      "Smart tv 43 pulgadas",
      "Campo de lavandas"
    ],
    details: [
      { name: "Arrollo a 300 metros", value: "Tiene un hermoso arrollo dentro del barrio" },
      { name: "Campo de lavandas", value: "Tiene en el mismo patio de la casa un campo precioso de lavandas" }
    ],
    image: "https://altosdecalamuchita.com/storage/app/uploads/public/6a0/cec/22e/6a0cec22ebd2d962964911.jpg",
    minStay: null,
    pricePerNight: 300000,
    services: 0,
    depositRate: 60000 / 600000,
  },
  {
    id: "c3f57dc0f9379cbb8ede996df7e561c5",
    name: "Alquiler Temporario Casa del Arroyo | Potrero de Garay",
    slug: "alquiler-temporario-casa-del-arroyo-potrero-de-garay",
    code: "AC-014",
    slogan: "Casa del Arroyo // Naturaleza, Deporte & Encuentro",
    description:
      "Alquiler Temporario en Potrero de Garay: Casa del Arroyo para Grupos y Familias\nSi estás buscando el mejor alojamiento en Potrero de Garay para tus próximas vacaciones, la Casa del Arroyo es el refugio definitivo. Su mayor diferencial es la magia de su entorno: a escasos metros de la puerta de la casa fluye un hermoso arroyo de aguas cristalinas. Ubicada dentro del exclusivo barrio privado Villa del Cóndor, esta imponente casa de alquiler temporario en las Sierras de Córdoba te ofrece la experiencia inigualable de despertar cada mañana con el sonido del agua y la naturaleza en su máxima expresión.\nDiseñada como un verdadero complejo vacacional, esta casa para 10 personas en Potrero de Garay cuenta con 4 amplias y luminosas habitaciones, garantizando el máximo confort para múltiples familias o grupos de amigos que desean compartir su estadía sin perder independencia.\nUn Arroyo a tus Pies y Club Deportivo Privado A diferencia de cualquier otra cabaña o casa en Potrero de Garay, la Casa del Arroyo te invita a bajar con el mate y sentarte en la orilla a disfrutar la paz del bosque sin salir de la propiedad. Complementando esta conexión única con el agua, el predio ofrece un complejo deportivo privado de primer nivel, ideal para mantenerte activo durante tus días de descanso. Las instalaciones exclusivas incluyen:\nCancha multideportes (tenis, fútbol y básquet) totalmente perimetrada.\n\nTradicional cancha de bochas integrada al paisaje serrano.\n\nGran pileta con solárium y un inmenso deck panorámico de madera que funciona como mirador hacia el parque.\n\nQuincho, Asador y Entretenimiento Los grandes grupos necesitan grandes espacios de reunión. La propiedad ofrece un espectacular quincho cerrado y vidriado con asador, equipado con mesa de pool y heladera propia para disfrutar de los mejores asados sin importar el clima exterior. Además, la casa principal dispone de una cocina moderna totalmente equipada, un amplio living-comedor climatizado y conexión WiFi estable.\nSeguridad y Ubicación Estratégica Disfrutá de la tranquilidad absoluta de alquilar una casa en un country con seguridad 24 horas. Su ubicación privilegiada te permite vivir el aislamiento, la privacidad y la relajación del arroyo, estando a la vez a muy pocos minutos del lago y de los principales puntos turísticos del Valle de Paravachasca y Calamuchita.\nAsegurá tu estadía en uno de los mejores alquileres vacacionales de Potrero de Garay. ¡El sonido del agua, el deporte y el encuentro perfecto te esperan en la Casa del Arroyo!",
    types: ["Casa"],
    capacity: 10,
    bedrooms: 4,
    bathrooms: 3,
    square_meters: 250,
    city: "Potrero de Garay",
    neighborhood: "Villa del Condor",
    location_reference: "Potrero de Garay",
    facilities: [
      "Wifi Starlink",
      "Piscina",
      "Aire Acondicionado / Calefacción",
      "Quincho con asador",
      "Cancha de Futbol",
      "Cancha de Tenis",
      "Cancha de Basquet",
      "Cancha de Bochas",
      "Baño social",
      "Salamandra a Leña",
      "Parrilla para asado",
      "Cochera Cubierta",
      "Ropa Blanca",
      "Terraza Panorámica",
      "Baño en suite",
      "Baño",
      "Sofá cama para 2 personas",
      "Cafetera eléctrica",
      "Pava",
      "Smart tv 43 pulgadas",
      "Sommier 1 plaza",
      "Tostadora Eléctrica",
      "Pava Eléctrica",
      "Lavarropas",
      "Cocina 4 hornallas",
      "Heladera",
      "Sommier 2 Plazas",
      "Microondas",
      "Vajilla",
      "Secador de cabello"
    ],
    details: [
      { name: "Cancha de Tennis", value: "No se incluyen las raquetas ni pelotas de tennis, cada uno debe llevar" },
      { name: "Cancha de Futbol", value: "Incluye la Pelota" },
      { name: "Cancha de Basquet", value: "Incluye la pelota" },
      { name: "Quincho con asador", value: "En el quincho esta el pool" }
    ],
    image: "https://altosdecalamuchita.com/storage/app/uploads/public/6a6/8bc/e29/6a68bce29059d497245030.jpg",
    minStay: 2,
    pricePerNight: 246510,
    services: 44880,
    depositRate: 242088 / 537900,
  },
  {
    id: "56c1d9797ef88e49953c882890fef759",
    name: "Alquiler Temporario Cabaña Fronda | San Clemente",
    slug: "alquiler-temporario-cabana-de-bosque-fronda-san-clemente",
    code: "AC-011",
    slogan: "Fronda // Vistas & Pinares",
    description:
      "Descubrí a Fronda, una exclusiva cabaña de bosque de alquiler temporario en San Clemente, ubicada dentro de Altitud 1100, un barrio privado inmerso en las sierras del Valle de Calamuchita. Rodeada de un imponente bosque de pinos y con una vista abierta al paisaje serrano, fue diseñada para quienes buscan desconectar del ritmo cotidiano y reconectar con la tranquilidad de la naturaleza.\nDistribuida en dos plantas y con capacidad para 4 personas, Fronda combina madera, paisaje y calma en una experiencia inmersiva difícil de encontrar. Su cálida salamandra a leña transforma cada noche en un momento especial, ideal para disfrutar del silencio, largas conversaciones y la paz de la montaña.\n\nExperiencia y Servicios Exclusivos:\n• Bosque de pinos inmersivo: Una experiencia única rodeada de naturaleza, silencio y vistas abiertas a las sierras.\n• Vista abierta al paisaje serrano: Un escenario privilegiado para contemplar amaneceres, atardeceres y la inmensidad de las montañas.\n• Salamandra a leña | Noches memorables: El espacio perfecto para compartir momentos cálidos en plena naturaleza.\n• Ideal para 4 personas: Distribución en dos plantas, perfecta para escapadas en pareja, familia o amigos.\n• Conectividad sin límites: WiFi Starlink de alta velocidad, ideal para streaming o trabajo remoto.\n• Desconexión exclusiva: Una auténtica experiencia de calma, bosque y naturaleza en las sierras de Córdoba.",
    types: ["Casa", "Cabaña"],
    capacity: 4,
    bedrooms: 2,
    bathrooms: 1,
    square_meters: 135,
    city: "San Clemente",
    neighborhood: "Altitud 1100",
    location_reference: "San Clemente",
    facilities: [
      "Salamandra a Leña",
      "Quincho con asador"
    ],
    details: [
      
    ],
    image: "https://altosdecalamuchita.com/storage/app/uploads/public/6a2/480/61d/6a248061dc80e358947092.jpg",
    minStay: 2,
    pricePerNight: 286000,
    services: 44880,
    depositRate: 245080 / 616880,
  },
  {
    id: "6f3d825529f18e71f891d1275ecf4b27",
    name: "Alquiler Temporario Cabaña Cumbre | San Clemente",
    slug: "alquiler-temporario-cabana-cumbre-san-clemente",
    code: "AC-012",
    slogan: "CUMBRE // Vistas al río & Inmensidad",
    description:
      "Descubrí a Cumbre, una exclusiva cabaña premium de alquiler temporario en San Clemente, ubicada dentro de Altitud 1100, un barrio privado inmerso en las sierras del Valle de Calamuchita. Diseñada para quienes buscan desconectar y vivir una experiencia inmersiva en plena naturaleza, combina tranquilidad, arquitectura de montaña y una impactante vista panorámica al Río San Pedro y las sierras de Córdoba.\nDesarrollada en una sola planta, Cumbre invita a contemplar el paisaje desde una espectacular terraza con vistas abiertas al Río San Pedro, al valle y a las montañas, donde la inmensidad del entorno se convierte en protagonista. Sus dos salamandras interiores a leña crean una atmósfera cálida y memorable, ideal para compartir largas conversaciones y disfrutar momentos únicos en cualquier época del año.\n\nExperiencia y Servicios Exclusivos:\n• Vista panorámica al Río San Pedro y las sierras: Un escenario privilegiado para contemplar amaneceres, atardeceres y la inmensidad del paisaje serrano.\n• Terraza inmersiva | Vista & contemplación: El espacio perfecto para relajarse contemplando el Río San Pedro y disfrutar una de las mejores vistas de San Clemente.\n• Dos salamandras a leña | Calidez todo el año: Una experiencia única de montaña para disfrutar noches acogedoras.\n• Altitud 1100 | Barrio privado en San Clemente: Privacidad, tranquilidad y contacto genuino con la naturaleza.\n• Ideal para familias o amigos: Dos habitaciones pensadas para escapadas memorables en las sierras de Córdoba.\n• Conectividad sin límites: WiFi Starlink de alta velocidad, ideal para streaming o trabajo remoto desde la montaña.\n• Desconexión exclusiva: Una auténtica experiencia de calma, montaña y vistas inolvidables en el Valle de Calamuchita.",
    types: ["Casa", "Cabaña"],
    capacity: 4,
    bedrooms: 2,
    bathrooms: 2,
    square_meters: 200,
    city: "San Clemente",
    neighborhood: "Altitud 1100",
    location_reference: "San Clemente",
    facilities: [
      
    ],
    details: [
      
    ],
    image: "https://altosdecalamuchita.com/storage/app/uploads/public/6a2/ffc/2d8/6a2ffc2d87d6e003880824.jpg",
    minStay: 2,
    pricePerNight: 330000,
    services: 44880,
    depositRate: 275880 / 704880,
  },
  {
    id: "000bd8fe7070e9200d5d652076c119e7",
    name: "Alquiler Temporario Suite La Mansa | San Clemente",
    slug: "alquiler-temporario-suite-de-montana-la-mansa-san-clemente",
    code: "AC-009",
    slogan: "La Mansa // Bajada Exclusiva al Río San Pedro",
    description:
      "Descubrí a La Mansa, una acogedora suite de montaña de alquiler temporario en San Clemente, ubicada dentro de un barrio privado en las sierras del Valle de Calamuchita. Diseñada para quienes buscan desconectar y vivir una experiencia inmersiva en plena naturaleza, combina tranquilidad, montaña y una ubicación privilegiada a pasos del Río San Pedro.\nUbicada a pocos metros del río, La Mansa invita a disfrutar del sonido del agua, el aire puro de montaña y la calma característica de San Clemente. Su cálida salamandra interior crea el ambiente perfecto para compartir momentos memorables luego de un día rodeado de naturaleza.\n\nExperiencia y Servicios Exclusivos:\n• A metros del Río San Pedro: Una ubicación privilegiada para disfrutar del río, relajarse y conectar con uno de los paisajes naturales más lindos de San Clemente.\n• Suite de montaña | Naturaleza & tranquilidad: Un entorno ideal para quienes buscan descanso, calma serrana y desconexión.\n• Salamandra interior | Calidez todo el año: El espacio perfecto para disfrutar noches acogedoras en plena montaña.\n• Barrio privado en San Clemente: Privacidad, tranquilidad y contacto genuino con la naturaleza.\n• Desconexión junto al río: Ideal para escapadas románticas y experiencias inmersivas en las sierras de Córdoba.",
    types: ["Suite de Montaña"],
    capacity: 4,
    bedrooms: 1,
    bathrooms: 1,
    square_meters: 60,
    city: "San Clemente",
    neighborhood: "Altitud 1100",
    location_reference: "San Clemente",
    facilities: [
      
    ],
    details: [
      
    ],
    image: "https://altosdecalamuchita.com/storage/app/uploads/public/6a2/46e/0f5/6a246e0f54e0d344903633.jpg",
    minStay: 2,
    pricePerNight: 146410,
    services: 44880,
    depositRate: 147367 / 337700,
  },
  {
    id: "1ee320a7125d92685fc245400fc8a93a",
    name: "Alquiler Temporario Casa Perla Negra | Potrero de Garay",
    slug: "alquiler-temporario-casa-perla-negra-potrero-de-garay",
    code: "AC-003",
    slogan: "Perla Negra // Paisaje, Calma & Hogar",
    description:
      "Descubrí a Perla Negra, una exclusiva residencia de alquiler temporario inmersa en un country privado de las sierras de Calamuchita. Diseñada meticulosamente para quienes buscan vivir una experiencia de confort, privacidad y contacto con la naturaleza, sin resignar sofisticación.\nDespertá cada mañana con vistas panorámicas abiertas al valle. Su imponente terraza volada, la arquitectura contemporánea y una exclusiva mini piscina integrada a la galería con vistas abiertas a las sierras invitan a contemplar el paisaje desde una perspectiva única, creando el escenario perfecto para compartir momentos memorables en familia o con amigos. Además, dentro del mismo country privado contarás con un hermoso arroyo serrano rodeado de naturaleza autóctona ubicado a tan solo 300 metros de la residencia, suma una experiencia única de conexión con el entorno.\nExperiencia y Servicios Exclusivos:\n• Mini piscina volada con vista a las sierras: Un espacio exclusivo integrado a la galería, ideal para relajarse contemplando el paisaje serrano desde una perspectiva única.\n• Arroyo serrano dentro del country: A solo 300 metros de la residencia, disfrutá de un hermoso arroyo natural ideal para caminar, relajarse y conectar con la tranquilidad de la montaña.\n• Momentos memorables junto al fuego: Salamandra de diseño pensada para compartir noches cálidas, largas conversaciones y experiencias inolvidables.\n• Tranquilidad total: Predio con seguridad las 24 horas para un descanso sin preocupaciones.\n• Confort absoluto: Espacios amplios, equipamiento premium y ambientes climatizados durante todo el año.\n• Conectividad ininterrumpida: Internet satelital Starlink de alta velocidad, ideal para combinar relax y teletrabajo en la montaña.",
    types: ["Casa"],
    capacity: 10,
    bedrooms: 5,
    bathrooms: 3,
    square_meters: 300,
    city: "Potrero de Garay",
    neighborhood: "Villa del Condor",
    location_reference: "Potrero de Garay",
    facilities: [
      "Aire Acondicionado / Calefacción",
      "Wifi Starlink",
      "Cava de vinos",
      "Terraza Panorámica",
      "Salamandra a Leña",
      "Minipiscina",
      "Baño social",
      "Parrilla para asado",
      "Ropa Blanca",
      "Lavavajillas",
      "Baño en suite",
      "Cochera Cubierta",
      "Sommier 2 plazas y media",
      "Smart tv 32 pulgadas",
      "Smart tv 43 pulgadas",
      "Cama marinera para 2 personas",
      "Cafetera eléctrica",
      "Anafe",
      "Pava",
      "Cocina eléctrica",
      "Asador",
      "Sommier 1 plaza",
      "Tostadora Eléctrica",
      "Pava Eléctrica",
      "Cocina 4 hornallas",
      "Heladera",
      "Microondas",
      "Vajilla",
      "Secador de cabello",
      "Plancha",
      "Arroyo en el barrio",
      "Rio en el barrio"
    ],
    details: [
      { name: "Salamandra Interior", value: "Si esta habilitada para el uso" },
      { name: "Minipiscina volada en la terrada", value: "Tiene 3 x 2 metros solo para verano" },
      { name: "Cochera Techada", value: "Si tiene la hicimos nueva" },
      { name: "Aire frio / calor", value: "En todos los ambientes" },
      { name: "Asador", value: "Se encuentra adentro, en la parte de la cocina" }
    ],
    image: "https://altosdecalamuchita.com/storage/app/uploads/public/6a2/5b8/41b/6a25b841b0644698797840.jpg",
    // AC-003: los tres números de abajo (y `minStay`) son DEL MOCK, no del
    // servidor real: `show-property` no cotiza, así que el fixture no los trae.
    minStay: 2,
    pricePerNight: 320000,
    services: 44880,
    depositRate: 0.42,
  },
];

export const MCP_MOCK_PROPERTY_TYPES: readonly string[] = [
  "Cabaña", "Casa", "Casa con viñedo", "Departamento", "Suite de Montaña",
];

export const MCP_MOCK_CITIES: readonly string[] = [
  "Potrero de Garay", "San Clemente",
];

export const MCP_MOCK_FACILITIES: readonly McpMockFacility[] = [
  { id: 1, name: "Aire Acondicionado / Calefacción", description: "Aire Acondicionado / Calefacción", in_site_filter: false },
  { id: 23, name: "Anafe", description: "Anafe", in_site_filter: false },
  { id: 83, name: "Arroyo en el barrio", description: "Arroyo en el barrio", in_site_filter: false },
  { id: 39, name: "Asador", description: "Asador", in_site_filter: false },
  { id: 10, name: "Balcón", description: "Balcón", in_site_filter: false },
  { id: 11, name: "Balcón con asador", description: "Balcón con asador", in_site_filter: false },
  { id: 54, name: "Balcón con vista panorámica", description: "Balcon", in_site_filter: false },
  { id: 42, name: "Balcón Panorámico", description: "Balcón Panorámico", in_site_filter: false },
  { id: 57, name: "Baño", description: "Baño", in_site_filter: false },
  { id: 15, name: "Baño completo", description: "Baño completo", in_site_filter: false },
  { id: 56, name: "Baño en suite", description: "Baño en suite", in_site_filter: false },
  { id: 58, name: "Baño social", description: "Baño social", in_site_filter: false },
  { id: 22, name: "Cafetera eléctrica", description: "Cafetera eléctrica", in_site_filter: false },
  { id: 67, name: "Cama Cucheta", description: "Cama Cucheta", in_site_filter: false },
  { id: 45, name: "Cama marinera para 2 personas", description: "Cama marinera para 2 personas", in_site_filter: false },
  { id: 77, name: "Campo de lavandas", description: "Campo de lavandas", in_site_filter: false },
  { id: 81, name: "Cancha de Basquet", description: "Cancha de Basquet", in_site_filter: false },
  { id: 82, name: "Cancha de Bochas", description: "Cancha de Bochas", in_site_filter: false },
  { id: 79, name: "Cancha de Futbol", description: "Cancha de Futbol", in_site_filter: false },
  { id: 80, name: "Cancha de Tenis", description: "Cancha de Tenis", in_site_filter: false },
  { id: 68, name: "Cava de vinos", description: "Cava de vinos", in_site_filter: false },
  { id: 38, name: "Cochera", description: "Cochera", in_site_filter: false },
  { id: 41, name: "Cochera (no apta para camionetas)", description: "Cochera (no apta para camionetas)", in_site_filter: false },
  { id: 25, name: "Cochera con descuento", description: "Cochera con descuento", in_site_filter: false },
  { id: 62, name: "Cochera Cubierta", description: "Cochera Cubierta", in_site_filter: true },
  { id: 47, name: "Cochera Opcional ( No apta Camionetas )", description: "Cochera Opcional ( No apta Camionetas )", in_site_filter: false },
  { id: 30, name: "Cochera opcional (no apta camionetas)", description: "Cochera opcional (no apta camionetas)", in_site_filter: false },
  { id: 8, name: "Cocina 4 hornallas", description: "Cocina 4 hornallas", in_site_filter: false },
  { id: 32, name: "Cocina eléctrica", description: "Cocina eléctrica", in_site_filter: false },
  { id: 36, name: "Exprimidora", description: "Exprimidora", in_site_filter: false },
  { id: 72, name: "Fogonero", description: "Fogonero", in_site_filter: false },
  { id: 34, name: "Gimnasio", description: "Gimnasio", in_site_filter: false },
  { id: 9, name: "Heladera", description: "Heladera", in_site_filter: false },
  { id: 74, name: "Horno Chileno", description: "Horno Chileno", in_site_filter: false },
  { id: 40, name: "Horno eléctrico", description: "Horno eléctrico", in_site_filter: false },
  { id: 65, name: "Jacuzzi Exterior Climatizado a 40°C", description: "Jacuzzi Climatizado", in_site_filter: false },
  { id: 29, name: "Juguera", description: "Juguera", in_site_filter: false },
  { id: 7, name: "Lavarropas", description: "Lavarropas", in_site_filter: false },
  { id: 71, name: "Lavavajillas", description: "Lavavajillas", in_site_filter: false },
  { id: 33, name: "Lcd de 32´", description: "Lcd de 32´", in_site_filter: false },
  { id: 18, name: "Led 32´ con cable", description: "Led 32´ con cable", in_site_filter: false },
  { id: 46, name: "Led 43 pugaldas", description: "Led 43 pugaldas", in_site_filter: false },
  { id: 26, name: "Led 48' con cable", description: "Led 48' con cable", in_site_filter: false },
  { id: 48, name: "Led de 24´ con cable", description: "Led de 24´ con cable", in_site_filter: false },
  { id: 13, name: "Microondas", description: "Microondas", in_site_filter: false },
  { id: 69, name: "Minipiscina", description: "Minipiscina", in_site_filter: false },
  { id: 60, name: "Parrilla para asado", description: "Parrilla", in_site_filter: true },
  { id: 35, name: "Patio propio", description: "Patio propio", in_site_filter: false },
  { id: 53, name: "Patio propio con asador", description: "Patio propio con asador", in_site_filter: false },
  { id: 24, name: "Pava", description: "Pava", in_site_filter: false },
  { id: 4, name: "Pava Eléctrica", description: "Pava Eléctrica", in_site_filter: false },
  { id: 31, name: "Piscina", description: "Piscina", in_site_filter: false },
  { id: 20, name: "Plancha", description: "Plancha", in_site_filter: false },
  { id: 64, name: "Producción de Vino Propio ( Juana Urbana )", description: "Producción de Vino Propio ( Juana Urbana )", in_site_filter: false },
  { id: 75, name: "Proyector de Cine", description: "Proyector de Cine", in_site_filter: false },
  { id: 73, name: "Quincho con asador", description: "Quincho con asador", in_site_filter: false },
  { id: 84, name: "Rio en el barrio", description: "Rio en el barrio", in_site_filter: false },
  { id: 63, name: "Ropa Blanca", description: "Ropa Blanca", in_site_filter: false },
  { id: 59, name: "Salamandra a Leña", description: "Salamandra a leña en living", in_site_filter: true },
  { id: 76, name: "Salamandra digital", description: "Salamandra digital", in_site_filter: false },
  { id: 78, name: "Sauna", description: "Sauna", in_site_filter: false },
  { id: 17, name: "Secador de cabello", description: "Secador de cabello", in_site_filter: false },
  { id: 3, name: "Servicio de Ropa Blanca ( Opcional )", description: "Servicio de Ropa Blanca ( Opcional )", in_site_filter: false },
  { id: 50, name: "Smart tv 32 pulgadas", description: "Smart", in_site_filter: false },
  { id: 51, name: "Smart tv 43 pulgadas", description: "Smatr 43", in_site_filter: false },
  { id: 44, name: "Smart TV 49 Pulgadas", description: "Smart TV 49 Pulgadas", in_site_filter: false },
  { id: 43, name: "Sofá cama para 1 persona", description: "Sofá cama para 1 persona", in_site_filter: false },
  { id: 21, name: "Sofá cama para 2 personas", description: "Sofá cama para 2 personas", in_site_filter: false },
  { id: 19, name: "Sommier 1 plaza", description: "Sommier 1 plaza", in_site_filter: false },
  { id: 12, name: "Sommier 2 Plazas", description: "Sommier 2 Plazas", in_site_filter: false },
  { id: 55, name: "Sommier 2 plazas y media", description: "2 plazas y media", in_site_filter: false },
  { id: 70, name: "Terraza Panorámica", description: "Terraza Panorámica", in_site_filter: false },
  { id: 37, name: "Terraza propia", description: "Terraza propia", in_site_filter: false },
  { id: 6, name: "Terraza Propia con Asador", description: "Terraza Propia con Asador", in_site_filter: false },
  { id: 52, name: "Terraza Propia Panorámica", description: "Terraza Propia Panorámica", in_site_filter: false },
  { id: 16, name: "Toilette", description: "Toilette", in_site_filter: false },
  { id: 2, name: "Tostadora Eléctrica", description: "Tostadora Eléctrica", in_site_filter: false },
  { id: 49, name: "Tv Led con cable", description: "Tv Led con cable", in_site_filter: false },
  { id: 14, name: "Vajilla", description: "Vajilla", in_site_filter: false },
  { id: 66, name: "Viñedo Privado", description: "Viñedo Privado", in_site_filter: false },
  { id: 5, name: "Wifi / Smart tv", description: "Wifi / Smart tv", in_site_filter: false },
  { id: 61, name: "Wifi Starlink", description: "Wifi Starlink", in_site_filter: true },
];

export const MCP_MOCK_SEARCH_LINK = {
  base: "https://altosdecalamuchita.com/buscar",
  example: "https://altosdecalamuchita.com/buscar?in=2026-09-25&out=2026-09-27&c=2&s[0]=60",
  params: {
    "in": "Fecha de ingreso (AAAA-MM-DD). Obligatoria: sin ella el sitio redirige a la portada.",
    "out": "Fecha de salida (AAAA-MM-DD). Obligatoria.",
    "c": "Cantidad de huéspedes (mínimo requerido).",
    "g": "Cochera del complejo: 1 muestra solo propiedades con cochera disponible para las fechas; 0 u omitido no filtra.",
    "pt": "Id del tipo de alojamiento.",
    "ct": "Nombre de la localidad.",
    "r": "Cantidad de habitaciones EXACTA (no es mínimo: r=2 no muestra las de 3).",
    "s[]": "Ids de características de este catálogo, uno por índice (s[0]=60&s[1]=62). El sitio exige TODAS a la vez.",
  },
  notes: "Preferir el search_url que devuelve check-availability, que ya viene armado y verificado. Al armar un enlace a mano: s[] exige todas las características juntas, así que una palabra que corresponde a varias entradas del catálogo (cochera, asador, pileta) no se traduce a varios s[] — en ese caso enviar el enlace individual de cada propiedad. El buscador no tiene filtro de baños, y su filtro de habitaciones (r) es exacto, no mínimo.",
};

export const MCP_MOCK_NOTES = "Los tipos, localidades y características no distinguen mayúsculas, plurales ni acentos. Las consultas fuera de la ventana se rechazan.";

export const MCP_MOCK_CRITERIA_NOTES = "bedrooms y bathrooms son el mínimo requerido: pedir 2 también devuelve las de 3 o más. Las características se piden con facilities (la propiedad debe tenerlas todas) o con facilities_any (le alcanza con una de la lista). Una palabra del interesado suele corresponder a varias entradas de este catálogo —\"cochera\", \"asador\", \"pileta\", \"hoguera\"—: en ese caso van todas juntas en facilities_any, porque exigirlas todas a la vez no devolvería ninguna propiedad.";
