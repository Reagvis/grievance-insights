import type { CaseStatus, Dataset, GrievanceRecord, RecordLanguage } from '../domain/grievance';

/**
 * SYNTHETIC DEMONSTRATION DATA.
 *
 * Every record below is hand-written sample content for the prototype. None of it is
 * real CM Helpline data: case IDs, departments, districts ("District A" …), dates and
 * statuses are invented for demonstration and contain no personal information.
 *
 * Coverage of edge cases: missing response, response without declared outcome,
 * explicitly resolved / pending / in progress, mixed Telugu-English, English-only,
 * missing dates, missing category & department, a very long multi-paragraph complaint,
 * and an unusually long department name.
 */

type Seed = {
  n: number;
  category: string | null;
  issueType: string | null;
  department: string | null;
  district: string | null;
  submittedAt: string | null;
  respondedAt: string | null;
  status: CaseStatus;
  language?: RecordLanguage;
  complaint: string;
  response: string | null;
};

const SEEDS: Seed[] = [
  // ── Healthcare ───────────────────────────────────────────────
  {
    n: 101,
    category: 'Healthcare',
    issueType: 'Medicine shortage',
    department: 'Health Department',
    district: 'District A',
    submittedAt: '2026-07-04',
    respondedAt: '2026-07-09',
    status: 'in_progress',
    complaint:
      'మా మండల ప్రాథమిక ఆరోగ్య కేంద్రంలో గత రెండు వారాలుగా మధుమేహం, రక్తపోటు మందులు అందుబాటులో లేవు. వృద్ధులు ప్రతి నెలా ఇక్కడికే వచ్చి మందులు తీసుకుంటారు. ఇప్పుడు బయట మెడికల్ షాపుల్లో కొనుక్కోవలసి వస్తోంది, అది చాలా కుటుంబాలకు భారంగా ఉంది. దయచేసి వెంటనే మందుల సరఫరా పునరుద్ధరించాలని కోరుతున్నాము.',
    response:
      'ఫిర్యాదును జిల్లా వైద్య ఆరోగ్య అధికారి కార్యాలయానికి పంపించాము. ఆరోగ్య కేంద్రానికి మందుల సరఫరా స్థితిని పరిశీలిస్తున్నారు.',
  },
  {
    n: 102,
    category: 'Healthcare',
    issueType: 'Doctor availability',
    department: 'Health Department',
    district: 'District B',
    submittedAt: '2026-07-11',
    respondedAt: '2026-07-15',
    status: 'unknown',
    complaint:
      'ప్రభుత్వ ఆసుపత్రిలో రాత్రి వేళల్లో డ్యూటీ డాక్టర్ అందుబాటులో ఉండటం లేదు. అత్యవసర పరిస్థితిలో వచ్చిన రోగులను నర్సులు మాత్రమే చూస్తున్నారు. గత వారం ఒక ప్రమాద బాధితుడిని దూర ప్రాంతంలోని ఆసుపత్రికి తరలించాల్సి వచ్చింది.',
    response:
      'రాత్రి డ్యూటీ షెడ్యూల్‌ను సమీక్షించమని ఆసుపత్రి సూపరింటెండెంట్‌కు సూచనలు జారీ చేయబడ్డాయి.',
  },
  {
    n: 103,
    category: 'Healthcare',
    issueType: 'Medicine shortage',
    department: 'Health Department',
    district: null,
    submittedAt: null,
    respondedAt: null,
    status: 'unknown',
    complaint: 'ప్రభుత్వ ఆసుపత్రిలో మందులు అందుబాటులో లేవు.',
    response: 'ఆసుపత్రి అధికారులకు వివరాలు పంపించబడ్డాయి. సరఫరా స్థితిని పరిశీలిస్తున్నారు.',
  },
  {
    n: 104,
    category: 'Healthcare',
    issueType: 'Ambulance delay',
    department: 'Health Department',
    district: 'District C',
    submittedAt: '2026-08-02',
    respondedAt: '2026-08-06',
    status: 'resolved',
    complaint:
      'అంబులెన్స్‌కు ఫోన్ చేసిన తర్వాత దాదాపు గంటన్నర వరకు వాహనం రాలేదు. గర్భిణీ స్త్రీని ఆటోలో ఆసుపత్రికి తీసుకెళ్లాల్సి వచ్చింది. మా ప్రాంతానికి అంబులెన్స్ సేవలు మెరుగుపరచాలని కోరుతున్నాము.',
    response:
      'సంబంధిత అంబులెన్స్ సేవల సమన్వయ విభాగానికి ఫిర్యాదు పంపబడింది. ఆ రోజు వాహన కేటాయింపు వివరాలు పరిశీలించి, ఆ ప్రాంతానికి అదనపు వాహనం కేటాయించబడింది.',
  },
  {
    n: 105,
    category: 'Healthcare',
    issueType: 'Hospital facilities',
    department: 'Health Department',
    district: 'District A',
    submittedAt: '2026-08-19',
    respondedAt: null,
    status: 'pending',
    complaint:
      'జిల్లా ఆసుపత్రిలోని జనరల్ వార్డులో పరిస్థితులు చాలా దయనీయంగా ఉన్నాయి. గత నెల రోజులుగా వార్డులోని సగానికి పైగా ఫ్యాన్లు పనిచేయడం లేదు. వేసవి వేడిలో రోగులు, ముఖ్యంగా వృద్ధులు, చిన్నపిల్లలు తీవ్ర ఇబ్బంది పడుతున్నారు. రోగుల సహాయకులు కూర్చోవడానికి కూడా సరైన స్థలం లేదు.\n\nవార్డుకు అనుబంధంగా ఉన్న మరుగుదొడ్లు సరిగా శుభ్రం చేయడం లేదు. నీటి సరఫరా లేక కొన్ని మరుగుదొడ్లను పూర్తిగా మూసివేశారు. తాగునీటి కోసం ఏర్పాటు చేసిన వాటర్ ప్యూరిఫైయర్ కూడా పాడైపోయింది, దాంతో సహాయకులు బయటి దుకాణాల నుండి నీటి సీసాలు కొనుక్కోవలసి వస్తోంది.\n\nఈ విషయాలపై వార్డు సిబ్బందికి పలుమార్లు మౌఖికంగా తెలియజేసినా ఎలాంటి మార్పు రాలేదు. పేద కుటుంబాలే ఎక్కువగా ఈ ఆసుపత్రిపై ఆధారపడతాయి కాబట్టి, సంబంధిత అధికారులు వెంటనే తనిఖీ చేసి ఫ్యాన్లు, మరుగుదొడ్లు, తాగునీటి సౌకర్యాలను సరిచేయాలని విజ్ఞప్తి చేస్తున్నాము.',
    response: null,
  },

  // ── Roads ────────────────────────────────────────────────────
  {
    n: 106,
    category: 'Roads',
    issueType: 'Potholes',
    department: 'Roads & Buildings',
    district: 'District B',
    submittedAt: '2026-07-21',
    respondedAt: '2026-07-28',
    status: 'pending',
    complaint:
      'పాఠశాలకు వెళ్లే ప్రధాన రహదారిలో గుంతలు ఉన్నాయి. వర్షం పడినప్పుడు గుంతల్లో నీరు నిలిచి పిల్లలు సైకిళ్లపై వెళ్లడం ప్రమాదకరంగా మారింది.',
    response: 'మరమ్మత్తు పనుల కోసం అభ్యర్థన నమోదు చేయబడింది.',
  },
  {
    n: 107,
    category: 'Roads',
    issueType: 'Rain damage',
    department:
      'Panchayat Raj & Rural Development — Engineering Wing (Rural Roads Maintenance and Monsoon Restoration Division)',
    district: 'District D',
    submittedAt: '2026-08-09',
    respondedAt: '2026-08-14',
    status: 'in_progress',
    complaint:
      'వర్షాల తర్వాత మా గ్రామం నుండి మండల కేంద్రానికి వెళ్లే రహదారి పూర్తిగా దెబ్బతింది. బస్సులు రావడం ఆగిపోయాయి. విద్యార్థులు, రైతులు తీవ్ర ఇబ్బంది పడుతున్నారు.',
    response:
      'రహదారి నష్టం అంచనా కోసం ఇంజనీరింగ్ సిబ్బందిని పంపించాము. అంచనా నివేదిక తర్వాత పనులు చేపడతాము.',
  },
  {
    n: 108,
    category: 'Roads',
    issueType: 'Incomplete construction',
    department: 'Roads & Buildings',
    district: 'District C',
    submittedAt: '2026-06-30',
    respondedAt: '2026-07-18',
    status: 'resolved',
    complaint:
      'రెండేళ్ల క్రితం మొదలైన సీసీ రోడ్డు పనులు సగంలోనే ఆగిపోయాయి. కంకర కుప్పలు రోడ్డుపై అలాగే ఉన్నాయి, రాత్రివేళ ద్విచక్ర వాహనదారులు ప్రమాదాలకు గురవుతున్నారు.',
    response:
      'కాంట్రాక్టర్‌కు నోటీసు జారీ చేయబడింది. పనులు పూర్తయ్యాయని క్షేత్ర స్థాయి తనిఖీలో నిర్ధారించబడింది.',
  },

  // ── Water supply ─────────────────────────────────────────────
  {
    n: 109,
    category: 'Water supply',
    issueType: 'Irregular supply',
    department: 'Rural Water Supply',
    district: 'District A',
    submittedAt: '2026-07-07',
    respondedAt: '2026-07-08',
    status: 'in_progress',
    complaint:
      'మా ప్రాంతంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు. ఉదయం అరగంట మాత్రమే నీరు వస్తోంది, అది కూడా తక్కువ ఒత్తిడితో. ఎత్తైన ప్రాంతాల్లోని ఇళ్లకు నీరు అసలు చేరడం లేదు.',
    response: 'సంబంధిత నీటి సరఫరా విభాగానికి సమస్యను పంపించాము. పరిశీలన కొనసాగుతోంది.',
  },
  {
    n: 110,
    category: 'Water supply',
    issueType: 'Contaminated water',
    department: 'Rural Water Supply',
    district: 'District D',
    submittedAt: '2026-08-12',
    respondedAt: '2026-08-16',
    status: 'resolved',
    complaint:
      'నల్లా నీరు మురికిగా, దుర్వాసనతో వస్తోంది. కాలనీలోని పలువురు పిల్లలకు విరేచనాలు అవుతున్నాయి. పైప్‌లైన్ లీకేజీ వల్ల మురుగు నీరు కలుస్తోందని అనుమానిస్తున్నాము.',
    response:
      'నీటి నమూనాలను పరీక్షకు పంపించాము. లీకేజీ ఉన్న పైప్‌లైన్ భాగాన్ని మరమ్మత్తు చేశాము. పరీక్ష ఫలితాలు వచ్చే వరకు నీటిని కాచి తాగమని సూచించాము.',
  },
  {
    n: 111,
    category: 'Water supply',
    issueType: 'Borewell repair',
    department: 'Rural Water Supply',
    district: 'District B',
    submittedAt: '2026-09-03',
    respondedAt: null,
    status: 'unknown',
    complaint:
      'మా కాలనీలోని ఏకైక బోరుబావి మోటార్ నెల రోజులుగా పనిచేయడం లేదు. మహిళలు దూరం నుండి నీరు మోసుకొస్తున్నారు.',
    response: null,
  },
  {
    n: 112,
    category: 'Water supply',
    issueType: 'Tanker supply',
    department: 'Rural Water Supply',
    district: 'District C',
    submittedAt: '2026-05-22',
    respondedAt: '2026-05-30',
    status: 'pending',
    complaint:
      'వేసవిలో ట్యాంకర్ ద్వారా నీటి సరఫరా వారానికి ఒక్కసారే జరుగుతోంది. కుటుంబానికి సరిపడా నీరు అందడం లేదు.',
    response: 'ట్యాంకర్ షెడ్యూల్ పెంపు కోసం ప్రతిపాదన పంపబడింది.',
  },

  // ── Electricity ──────────────────────────────────────────────
  {
    n: 113,
    category: 'Electricity',
    issueType: 'Power cuts',
    department: 'Electricity Distribution',
    district: 'District A',
    submittedAt: '2026-08-21',
    respondedAt: '2026-08-23',
    status: 'in_progress',
    complaint:
      'రోజుకు ఆరు నుంచి ఏడు గంటల వరకు అప్రకటిత విద్యుత్ కోతలు ఉంటున్నాయి. రాత్రి వేళల్లో కూడా కరెంటు పోతోంది, విద్యార్థుల చదువుకు ఆటంకం కలుగుతోంది.',
    response: 'సబ్‌స్టేషన్ స్థాయిలో లోడ్ సమస్యను పరిశీలిస్తున్నాము.',
  },
  {
    n: 114,
    category: 'Electricity',
    issueType: 'Transformer failure',
    department: 'Electricity Distribution',
    district: 'District D',
    submittedAt: '2026-09-01',
    respondedAt: '2026-09-04',
    status: 'resolved',
    complaint:
      'మా వీధిలోని ట్రాన్స్‌ఫార్మర్ కాలిపోయి నాలుగు రోజులైంది. ఫిర్యాదు చేసినా ఇంకా మార్చలేదు.',
    response: 'కొత్త ట్రాన్స్‌ఫార్మర్ అమర్చబడింది మరియు సరఫరా పునరుద్ధరించబడింది.',
  },
  {
    n: 115,
    category: 'Electricity',
    issueType: 'Billing dispute',
    department: 'Electricity Distribution',
    district: 'District B',
    submittedAt: '2026-09-10',
    respondedAt: '2026-09-17',
    status: 'unknown',
    complaint:
      'ఈ నెల విద్యుత్ బిల్లు సాధారణం కంటే నాలుగు రెట్లు ఎక్కువగా వచ్చింది. మీటర్ రీడింగ్ తప్పుగా నమోదు చేశారని భావిస్తున్నాము.',
    response: 'మీటర్ రీడింగ్ పునఃపరిశీలన కోసం అభ్యర్థన నమోదు చేయబడింది.',
  },
  {
    n: 116,
    category: 'Electricity',
    issueType: 'Agricultural supply',
    department: 'Electricity Distribution',
    district: 'District C',
    submittedAt: '2026-09-14',
    respondedAt: null,
    status: 'pending',
    complaint:
      'వ్యవసాయ పంపుసెట్లకు ఇవ్వాల్సిన విద్యుత్ సరఫరా రోజుకు నాలుగైదు గంటలకే పరిమితమైంది. నీరు అందక పంటలు ఎండిపోతున్నాయి.',
    response: null,
  },

  // ── Education ────────────────────────────────────────────────
  {
    n: 117,
    category: 'Education',
    issueType: 'Teacher shortage',
    department: 'School Education',
    district: 'District D',
    submittedAt: '2026-07-15',
    respondedAt: '2026-07-25',
    status: 'pending',
    complaint:
      'మా గ్రామ ప్రాథమిక పాఠశాలలో ఐదు తరగతులకు ఒక్కరే ఉపాధ్యాయుడు ఉన్నారు. పిల్లల చదువు దెబ్బతింటోంది.',
    response: 'అదనపు ఉపాధ్యాయుల నియామకం కోసం జిల్లా విద్యాశాఖకు ప్రతిపాదన పంపించాము.',
  },
  {
    n: 118,
    category: 'Education',
    issueType: 'Mid-day meal quality',
    department: 'School Education',
    district: 'District A',
    submittedAt: '2026-08-05',
    respondedAt: '2026-08-12',
    status: 'resolved',
    complaint:
      'మధ్యాహ్న భోజనంలో నాణ్యత లేని బియ్యం వాడుతున్నారు. కొన్ని రోజులుగా కూరగాయలు కూడా ఇవ్వడం లేదు.',
    response:
      'మండల విద్యాధికారి పాఠశాలను సందర్శించి నివేదిక సమర్పించారు. సరఫరాదారుని మార్చారు.',
  },
  {
    n: 119,
    category: 'Education',
    issueType: 'Scholarship delay',
    department: 'School Education',
    district: 'District B',
    submittedAt: '2026-06-18',
    respondedAt: '2026-07-02',
    status: 'in_progress',
    language: 'mixed',
    complaint:
      'పోస్ట్ మెట్రిక్ స్కాలర్‌షిప్ దరఖాస్తు చేసి 8 నెలలైనా మొత్తం జమ కాలేదు. Online portal లో status "Pending at verification" అని మాత్రమే చూపిస్తోంది.',
    response: 'దరఖాస్తు ధృవీకరణ దశలో ఉంది.',
  },

  // ── Sanitation ───────────────────────────────────────────────
  {
    n: 120,
    category: 'Sanitation',
    issueType: 'Garbage collection',
    department: 'Municipal Sanitation',
    district: 'District C',
    submittedAt: '2026-08-25',
    respondedAt: '2026-08-27',
    status: 'unknown',
    complaint:
      'మా కాలనీలో పది రోజులుగా చెత్త సేకరణ వాహనం రావడం లేదు. రోడ్ల పక్కన చెత్త పేరుకుపోయి దోమలు పెరిగాయి.',
    response: 'పారిశుద్ధ్య సిబ్బందిని కేటాయించాము.',
  },
  {
    n: 121,
    category: 'Sanitation',
    issueType: 'Drainage overflow',
    department: 'Municipal Sanitation',
    district: 'District A',
    submittedAt: '2026-09-06',
    respondedAt: '2026-09-08',
    status: 'in_progress',
    language: 'mixed',
    complaint:
      'Road No. 4 లో drainage overflow అవుతోంది, road మొత్తం water logging. Two-wheelers slip అవుతున్నాయి. Please take action urgently.',
    response: 'డ్రైనేజీ శుభ్రపరిచే పనులు ప్రారంభించబడ్డాయి.',
  },
  {
    n: 122,
    category: 'Sanitation',
    issueType: 'Public toilets',
    department: 'Municipal Sanitation',
    district: null,
    submittedAt: null,
    respondedAt: null,
    status: 'unknown',
    complaint:
      'బస్ స్టాండ్ వద్ద ఉన్న ప్రజా మరుగుదొడ్లు ఎప్పుడూ తాళం వేసి ఉంటున్నాయి. ప్రయాణికులు, ముఖ్యంగా మహిళలు ఇబ్బంది పడుతున్నారు.',
    response: null,
  },

  // ── Public transport ─────────────────────────────────────────
  {
    n: 123,
    category: 'Public transport',
    issueType: 'Service cancelled',
    department: 'Transport',
    district: 'District D',
    submittedAt: '2026-07-29',
    respondedAt: '2026-08-04',
    status: 'resolved',
    complaint:
      'మా గ్రామానికి వచ్చే ఉదయం బస్సు సర్వీసును రద్దు చేశారు. విద్యార్థులు, ఉద్యోగులు ఐదు కిలోమీటర్లు నడవాల్సి వస్తోంది.',
    response: 'ఉదయం సర్వీసును పునరుద్ధరించాము.',
  },
  {
    n: 124,
    category: 'Public transport',
    issueType: 'Bus pass counters',
    department: 'Transport',
    district: 'District B',
    submittedAt: '2026-06-10',
    respondedAt: '2026-06-20',
    status: 'unknown',
    complaint:
      'విద్యార్థి బస్ పాస్ పునరుద్ధరణకు కౌంటర్ వద్ద రోజుల తరబడి వేచి ఉండాల్సి వస్తోంది. ఒక్క కౌంటర్ మాత్రమే పనిచేస్తోంది.',
    response: 'అదనపు కౌంటర్ ఏర్పాటు పరిశీలనలో ఉంది.',
  },
  {
    n: 125,
    category: 'Public transport',
    issueType: 'Overcrowding',
    department: 'Transport',
    district: 'District C',
    submittedAt: '2026-09-19',
    respondedAt: '2026-09-24',
    status: 'pending',
    language: 'en',
    complaint:
      'The evening bus on our route is always overcrowded and often skips our stop. Students and daily workers are left waiting. Please add one more trip in the evening.',
    response: 'రద్దీ వివరాలను డిపో మేనేజర్‌కు పంపించాము.',
  },

  // ── Welfare schemes ──────────────────────────────────────────
  {
    n: 126,
    category: 'Welfare schemes',
    issueType: 'Pension delay',
    department: 'Welfare Department',
    district: 'District A',
    submittedAt: '2026-08-30',
    respondedAt: '2026-09-05',
    status: 'in_progress',
    complaint:
      'వృద్ధాప్య పెన్షన్ గత మూడు నెలలుగా రావడం లేదు. గ్రామ సచివాలయంలో అడిగితే సరైన సమాధానం ఇవ్వడం లేదు.',
    response: 'లబ్ధిదారు వివరాలను పరిశీలిస్తున్నాము.',
  },
  {
    n: 127,
    category: 'Welfare schemes',
    issueType: 'Ration card application',
    department: 'Welfare Department',
    district: 'District D',
    submittedAt: '2026-05-14',
    respondedAt: '2026-06-01',
    status: 'unknown',
    complaint: 'కొత్త రేషన్ కార్డు కోసం దరఖాస్తు చేసి ఆరు నెలలైంది. ఇంకా మంజూరు కాలేదు.',
    response: 'దరఖాస్తు అర్హత పరిశీలనలో ఉంది.',
  },
  {
    n: 128,
    category: 'Welfare schemes',
    issueType: 'Housing instalment',
    department: 'Welfare Department',
    district: 'District B',
    submittedAt: '2026-09-22',
    respondedAt: null,
    status: 'pending',
    complaint:
      'గృహ నిర్మాణ పథకం కింద మంజూరైన రెండవ విడత నిధులు విడుదల కాలేదు. ఇంటి నిర్మాణం మధ్యలో ఆగిపోయింది, వర్షాకాలంలో కుటుంబం అద్దె ఇంట్లో ఉండాల్సి వస్తోంది.',
    response: null,
  },
  {
    n: 129,
    category: 'Welfare schemes',
    issueType: 'Ration distribution',
    department: 'Welfare Department',
    district: 'District C',
    submittedAt: '2026-10-02',
    respondedAt: '2026-10-09',
    status: 'resolved',
    complaint: 'రేషన్ దుకాణంలో ఈ నెల బియ్యం పూర్తి కోటా ఇవ్వలేదు. అడిగితే స్టాక్ లేదని చెబుతున్నారు.',
    response: 'రేషన్ డీలర్‌పై విచారణ జరిపి, మిగిలిన కోటా పంపిణీ చేయబడింది.',
  },

  // ── Uncategorised (no category / department in source) ───────
  {
    n: 130,
    category: null,
    issueType: null,
    department: null,
    district: null,
    submittedAt: '2026-10-11',
    respondedAt: null,
    status: 'unknown',
    complaint:
      'గ్రామ సచివాలయంలో సిబ్బంది సమయానికి రావడం లేదు. ధృవీకరణ పత్రాల కోసం వచ్చిన వారు గంటల తరబడి వేచి ఉండాల్సి వస్తోంది.',
    response: null,
  },
];

export const SAMPLE_DATASET_NAME = 'Sample dataset · 30 curated records';

export function caseId(n: number): string {
  return `GRV-${String(n).padStart(6, '0')}`;
}

function toRecord(seed: Seed): GrievanceRecord {
  return {
    id: caseId(seed.n),
    complaintText: seed.complaint,
    responseText: seed.response,
    language: seed.language ?? 'te',
    category: seed.category,
    issueType: seed.issueType,
    department: seed.department,
    district: seed.district,
    submittedAt: seed.submittedAt,
    respondedAt: seed.respondedAt,
    status: seed.status,
    originalFileName: null,
    sourceType: 'note',
    isSyntheticDemo: true,
  };
}

// @__PURE__: lets the AWS build, which ships no sample data, tree-shake this whole module away.
export const DEMO_GRIEVANCES: readonly GrievanceRecord[] = /* @__PURE__ */ SEEDS.map(toRecord);

export function createSampleDataset(): Dataset {
  return {
    id: 'sample',
    name: SAMPLE_DATASET_NAME,
    kind: 'sample',
    records: DEMO_GRIEVANCES.map((r) => ({ ...r })),
    isSynthetic: true,
  };
}

/** Deterministic PRNG so the expansion is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EXPANSION_SIZE = 2000;
export const EXPANSION_DATASET_NAME = `Synthetic expansion · ${EXPANSION_SIZE.toLocaleString('en-IN')} records (performance test)`;

/**
 * Generates a large dataset by re-using the curated templates. FOR RENDERING /
 * PERFORMANCE TESTING ONLY — the distribution is random and says nothing about real
 * complaint diversity. Texts are copied verbatim from templates; only metadata varies.
 */
export function createExpandedDataset(size = EXPANSION_SIZE): Dataset {
  const rand = mulberry32(20260705);
  const templates = DEMO_GRIEVANCES;
  const statuses: CaseStatus[] = ['resolved', 'in_progress', 'pending', 'unknown'];
  const start = Date.parse('2026-01-01');
  const spanDays = 290;
  const records: GrievanceRecord[] = [];

  for (let i = 0; i < size; i++) {
    const t = templates[Math.floor(rand() * templates.length)];
    const dropResponse = rand() < 0.14;
    const responseText = dropResponse ? null : t.responseText;
    let status = statuses[Math.floor(rand() * statuses.length)];
    // Keep the expansion internally consistent: no "resolved" without any response.
    if (responseText === null && status === 'resolved') status = 'pending';
    const noDate = rand() < 0.05;
    const day = Math.floor(rand() * spanDays);
    const submitted = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
    const responded =
      responseText === null ? null : new Date(start + (day + 2 + Math.floor(rand() * 12)) * 86_400_000).toISOString().slice(0, 10);

    records.push({
      ...t,
      id: caseId(100_001 + i),
      responseText,
      status,
      submittedAt: noDate ? null : submitted,
      respondedAt: noDate ? null : responded,
      originalFileName: null,
      isSyntheticDemo: true,
    });
  }

  return {
    id: `synthetic-${size}`,
    name: EXPANSION_DATASET_NAME,
    kind: 'synthetic-expansion',
    records,
    isSynthetic: true,
  };
}
