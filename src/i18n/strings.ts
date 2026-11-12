import { createContext, useContext } from 'react';
import type { CaseStatus } from '../domain/grievance';

/**
 * Interface strings. Telugu covers navigation, controls and record labels.
 * The consolidated report itself is generated in English (Telugu report templates
 * are a planned capability), and source text is always shown verbatim.
 */
const en = {
  appName: 'Reagvis Labs',
  appSubtitle: 'CM Helpline · Complaint Intelligence',
  prototypeBadge: 'Prototype · Sample Data',
  prototypeBadgeImported: 'Prototype · Imported data',
  intro: 'Explore Telugu citizen grievances and generate a collection-wide report.',
  dataset: 'Dataset',
  datasetSample: 'Sample · 30 curated records',
  datasetExpanded: 'Synthetic · 2,000 records (load test)',
  importData: 'Import data',
  language: 'Interface language',
  records: 'Complaint records',
  summaryTab: 'Summary',
  searchLabel: 'Search records',
  searchPlaceholder: 'Search case ID or text…',
  clearSearch: 'Clear search',
  category: 'Category',
  status: 'Status',
  response: 'Response',
  allCategories: 'All categories',
  allStatuses: 'All statuses',
  anyResponse: 'Any response',
  responseProvided: 'Response recorded',
  responseMissing: 'No response',
  resetFilters: 'Reset filters',
  showingAll: 'All records',
  showingFiltered: 'Filtered',
  of: 'of',
  noMatches: 'No complaints match these filters. Try clearing your search or filters.',
  noRecords: 'This dataset has no records. Import a file or switch back to the sample dataset.',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  downloadAll: 'Download all records',
  preparingZip: 'Preparing ZIP…',
  citizenComplaint: 'Citizen complaint',
  departmentResponse: 'Department response',
  noResponse: 'No response recorded in the source data.',
  statusNotRecorded: 'Resolution status not recorded.',
  downloadNote: 'Download this note',
  copy: 'Copy',
  previous: 'Previous',
  next: 'Next',
  close: 'Close',
  notRecorded: 'Not recorded',
  overviewTitle: 'Dataset overview',
  totalRecords: 'Total records',
  withResponse: 'Response recorded',
  resolved: 'Explicitly resolved',
  outcomeUnknown: 'Outcome not recorded',
  generate: 'Generate consolidated summary',
  regenerate: 'Regenerate summary',
  assistant: 'Document Assistant',
  openAssistant: 'Open Document Assistant',
  consolidatedInsights: 'Consolidated insights',
  summarySubtitle: 'One report covering the complaints and responses in your selected dataset.',
  reportScope: 'Report scope',
  reportLanguage: 'Report language',
  allRecordsScope: 'All records',
  filteredRecordsScope: 'Filtered records',
  copySummary: 'Copy summary',
  downloadMarkdown: 'Download Markdown',
  printPdf: 'Print / Save PDF',
  teluguCoverage: 'Telugu labels cover navigation and controls. Reports are generated in English; source text is always shown as written.',
  applyFiltersHint: 'Apply filters to enable',
  reportLangEnglish: 'English (Telugu planned)',
  inThisReport: 'In this report',
  navUpload: 'Upload',
  navDashboard: 'Dashboard',
  navComplaints: 'All Complaints',
  navSummary: 'Consolidated Summary',
} as const;

export type StringKey = keyof typeof en;

const te: Partial<Record<StringKey, string>> = {
  appSubtitle: 'సీఎం హెల్ప్‌లైన్ · ఫిర్యాదుల విశ్లేషణ',
  prototypeBadge: 'ప్రోటోటైప్ · నమూనా డేటా',
  prototypeBadgeImported: 'ప్రోటోటైప్ · దిగుమతి చేసిన డేటా',
  intro: 'తెలుగు పౌర ఫిర్యాదులను పరిశీలించి, మొత్తం సేకరణపై ఒకే నివేదికను రూపొందించండి.',
  dataset: 'డేటాసెట్',
  datasetSample: 'నమూనా · 30 రికార్డులు',
  datasetExpanded: 'సింథటిక్ · 2,000 రికార్డులు (లోడ్ పరీక్ష)',
  importData: 'డేటా దిగుమతి',
  language: 'ఇంటర్‌ఫేస్ భాష',
  records: 'ఫిర్యాదుల రికార్డులు',
  summaryTab: 'సారాంశం',
  searchLabel: 'రికార్డులు వెతకండి',
  searchPlaceholder: 'కేసు ID లేదా పాఠ్యం వెతకండి…',
  clearSearch: 'శోధన తొలగించండి',
  category: 'వర్గం',
  status: 'స్థితి',
  response: 'స్పందన',
  allCategories: 'అన్ని వర్గాలు',
  allStatuses: 'అన్ని స్థితులు',
  anyResponse: 'ఏ స్పందన అయినా',
  responseProvided: 'స్పందన నమోదైంది',
  responseMissing: 'స్పందన లేదు',
  resetFilters: 'ఫిల్టర్లు తొలగించండి',
  showingAll: 'అన్ని రికార్డులు',
  showingFiltered: 'ఫిల్టర్ చేసినవి',
  of: '/',
  noMatches: 'ఈ ఫిల్టర్లకు సరిపోయే ఫిర్యాదులు లేవు. శోధన లేదా ఫిల్టర్లను తొలగించి ప్రయత్నించండి.',
  noRecords: 'ఈ డేటాసెట్‌లో రికార్డులు లేవు. ఫైల్‌ను దిగుమతి చేయండి లేదా నమూనా డేటాసెట్‌కు మారండి.',
  prevPage: 'మునుపటి పేజీ',
  nextPage: 'తదుపరి పేజీ',
  downloadAll: 'అన్ని రికార్డులు డౌన్‌లోడ్ చేయండి',
  preparingZip: 'ZIP సిద్ధమవుతోంది…',
  citizenComplaint: 'పౌరుని ఫిర్యాదు',
  departmentResponse: 'విభాగం స్పందన',
  noResponse: 'మూల డేటాలో స్పందన నమోదు కాలేదు.',
  statusNotRecorded: 'పరిష్కార స్థితి నమోదు కాలేదు.',
  downloadNote: 'ఈ నోట్‌ను డౌన్‌లోడ్ చేయండి',
  copy: 'కాపీ',
  previous: 'మునుపటి',
  next: 'తదుపరి',
  close: 'మూసివేయండి',
  notRecorded: 'నమోదు కాలేదు',
  overviewTitle: 'డేటాసెట్ అవలోకనం',
  totalRecords: 'మొత్తం రికార్డులు',
  withResponse: 'స్పందన నమోదైనవి',
  resolved: 'పరిష్కరించబడినవి',
  outcomeUnknown: 'ఫలితం నమోదు కానివి',
  generate: 'సమగ్ర సారాంశం రూపొందించండి',
  regenerate: 'సారాంశం మళ్లీ రూపొందించండి',
  assistant: 'డాక్యుమెంట్ అసిస్టెంట్',
  openAssistant: 'డాక్యుమెంట్ అసిస్టెంట్ తెరవండి',
  consolidatedInsights: 'సమగ్ర విశ్లేషణ',
  summarySubtitle: 'ఎంచుకున్న డేటాసెట్‌లోని ఫిర్యాదులు, స్పందనలన్నింటిపై ఒకే నివేదిక.',
  reportScope: 'నివేదిక పరిధి',
  reportLanguage: 'నివేదిక భాష',
  allRecordsScope: 'అన్ని రికార్డులు',
  filteredRecordsScope: 'ఫిల్టర్ చేసిన రికార్డులు',
  copySummary: 'సారాంశం కాపీ',
  downloadMarkdown: 'Markdown డౌన్‌లోడ్',
  printPdf: 'ప్రింట్ / PDF సేవ్',
  applyFiltersHint: 'ఉపయోగించడానికి ఫిల్టర్ వర్తింపజేయండి',
  reportLangEnglish: 'English (తెలుగు ప్రణాళికలో ఉంది)',
  inThisReport: 'ఈ నివేదికలో',
  navUpload: 'అప్‌లోడ్',
  navDashboard: 'డాష్‌బోర్డ్',
  navComplaints: 'అన్ని ఫిర్యాదులు',
  navSummary: 'సమగ్ర సారాంశం',
};

export type UiLanguage = 'en' | 'te';

const STATUS: Record<UiLanguage, Record<CaseStatus, string>> = {
  en: { resolved: 'Resolved', in_progress: 'In progress', pending: 'Pending', unknown: 'Not recorded' },
  te: { resolved: 'పరిష్కరించబడింది', in_progress: 'ప్రక్రియలో ఉంది', pending: 'పెండింగ్‌లో ఉంది', unknown: 'నమోదు కాలేదు' },
};

/** Telugu display names for the demo categories (imported categories are shown as-is). */
const CATEGORY_TE: Record<string, string> = {
  Healthcare: 'ఆరోగ్యం / ఆసుపత్రులు',
  Roads: 'రహదారులు',
  'Water supply': 'తాగునీరు',
  Electricity: 'విద్యుత్',
  Education: 'విద్య',
  Sanitation: 'పారిశుద్ధ్యం',
  'Public transport': 'ప్రజా రవాణా',
  'Welfare schemes': 'సంక్షేమ పథకాలు',
  Uncategorized: 'వర్గం నమోదు కాలేదు',
};

export type I18n = {
  lang: UiLanguage;
  t: (key: StringKey) => string;
  statusLabel: (s: CaseStatus) => string;
  categoryLabel: (c: string) => string;
};

export function makeI18n(lang: UiLanguage): I18n {
  return {
    lang,
    t: (key) => (lang === 'te' ? (te[key] ?? en[key]) : en[key]),
    statusLabel: (s) => STATUS[lang][s],
    categoryLabel: (c) => (lang === 'te' ? (CATEGORY_TE[c] ?? c) : c),
  };
}

export const I18nContext = createContext<I18n>(makeI18n('en'));

export function useI18n(): I18n {
  return useContext(I18nContext);
}
