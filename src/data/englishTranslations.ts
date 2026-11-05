import { DEMO_GRIEVANCES } from './demoGrievances';

/** English renderings of the bundled sample text, indexed by exact source text.
 * IDs are deliberately not used: imported or expanded records may reuse IDs.
 */
const TRANSLATIONS: Record<string, [string, string | null]> = {
  'GRV-000101': [
    'Medicines for diabetes and high blood pressure have not been available at our mandal primary health centre for the past two weeks. Elderly people come here every month to collect their medicines. They now have to buy them from private medical shops, which is a burden for many families. Please restore the medicine supply immediately.',
    'We have forwarded the complaint to the District Medical and Health Officer’s office. The medicine supply situation at the health centre is being examined.',
  ],
  'GRV-000102': [
    'The duty doctor is not available at the government hospital at night. Patients arriving in an emergency are seen only by nurses. Last week, an accident victim had to be transferred to a distant hospital.',
    'Instructions have been issued to the hospital superintendent to review the night-duty schedule.',
  ],
  'GRV-000103': [
    'Medicines are not available at the government hospital.',
    'The details have been forwarded to the hospital authorities. The supply situation is being examined.',
  ],
  'GRV-000104': [
    'The ambulance did not arrive for nearly an hour and a half after we called. A pregnant woman had to be taken to hospital in an auto-rickshaw. Please improve ambulance services in our area.',
    'The complaint was forwarded to the relevant ambulance services coordination unit. Vehicle allocation details for that day were examined, and an additional vehicle was allocated to the area.',
  ],
  'GRV-000105': [
    'Conditions in the general ward of the district hospital are very poor. More than half of the fans in the ward have not worked for the past month. Patients, particularly elderly people and young children, are suffering in the summer heat. There is also no proper seating for patients’ attendants.\n\nThe toilets attached to the ward are not cleaned properly. Some toilets have been completely closed because there is no water supply. The drinking-water purifier is also broken, forcing attendants to buy bottled water from shops outside.\n\nWe have repeatedly informed the ward staff verbally about these issues, but nothing has changed. As poor families depend heavily on this hospital, we request the authorities to inspect it immediately and repair the fans, toilets and drinking-water facilities.',
    null,
  ],
  'GRV-000106': [
    'There are potholes on the main road leading to the school. When it rains, water collects in them, making it dangerous for children travelling by bicycle.',
    'A request for repair work has been registered.',
  ],
  'GRV-000107': [
    'The road from our village to the mandal headquarters has been completely damaged after the rains. Buses have stopped coming. Students and farmers are facing severe difficulties.',
    'Engineering staff have been sent to assess the road damage. Work will be taken up after the assessment report.',
  ],
  'GRV-000108': [
    'The cement-concrete road work started two years ago was stopped halfway. Piles of gravel remain on the road, and two-wheeler riders are getting into accidents at night.',
    'A notice was issued to the contractor. A field inspection confirmed that the work had been completed.',
  ],
  'GRV-000109': [
    'Drinking-water supply in our area has been irregular for three days. Water comes for only half an hour in the morning, and even then at low pressure. Houses in higher areas receive no water at all.',
    'We have forwarded the issue to the relevant water supply department. An examination is ongoing.',
  ],
  'GRV-000110': [
    'Tap water is dirty and foul-smelling. Several children in the colony are suffering from diarrhoea. We suspect sewage is mixing with the water because of a pipeline leak.',
    'We have sent water samples for testing and repaired the leaking section of the pipeline. Residents have been advised to boil drinking water until the test results arrive.',
  ],
  'GRV-000111': [
    'The motor of the only borewell in our colony has not worked for a month. Women are carrying water from far away.', null,
  ],
  'GRV-000112': [
    'During summer, water is supplied by tanker only once a week. Families are not receiving enough water.',
    'A proposal has been sent to increase the tanker schedule.',
  ],
  'GRV-000113': [
    'There are unannounced power cuts lasting six to seven hours a day. Power also goes off at night, disrupting students’ studies.',
    'We are examining the load issue at the substation level.',
  ],
  'GRV-000114': [
    'It has been four days since the transformer in our street burned out. It has still not been replaced despite our complaint.',
    'A new transformer has been installed and power supply has been restored.',
  ],
  'GRV-000115': [
    'This month’s electricity bill is four times the usual amount. We believe the meter reading was recorded incorrectly.',
    'A request to recheck the meter reading has been registered.',
  ],
  'GRV-000116': [
    'Electricity supply for agricultural pump sets has been limited to four or five hours a day. Crops are drying up because they are not receiving water.', null,
  ],
  'GRV-000117': [
    'There is only one teacher for five classes at our village primary school. The children’s education is suffering.',
    'We have sent a proposal to the district education department for the appointment of additional teachers.',
  ],
  'GRV-000118': [
    'Poor-quality rice is being used in the midday meal. Vegetables have also not been served for several days.',
    'The Mandal Education Officer visited the school and submitted a report. The supplier has been changed.',
  ],
  'GRV-000119': [
    'It has been eight months since I applied for the post-matric scholarship, but the amount has still not been credited. The online portal only shows the status “Pending at verification”.',
    'The application is at the verification stage.',
  ],
  'GRV-000120': [
    'The garbage collection vehicle has not come to our colony for ten days. Garbage has piled up along the roads, and mosquitoes have increased.',
    'We have assigned sanitation staff.',
  ],
  'GRV-000121': [
    'The drainage on Road No. 4 is overflowing, and the entire road is waterlogged. Two-wheelers are slipping. Please take action urgently.',
    'Drainage cleaning work has begun.',
  ],
  'GRV-000122': [
    'The public toilets at the bus stand are always locked. Travellers, especially women, are facing difficulties.', null,
  ],
  'GRV-000123': [
    'The morning bus service to our village has been cancelled. Students and employees have to walk five kilometres.',
    'We have restored the morning service.',
  ],
  'GRV-000124': [
    'Students have to wait for days at the counter to renew their bus passes. Only one counter is operating.',
    'The provision of an additional counter is under consideration.',
  ],
  'GRV-000125': [
    'The evening bus on our route is always overcrowded and often skips our stop. Students and daily workers are left waiting. Please add one more trip in the evening.',
    'We have forwarded the overcrowding details to the depot manager.',
  ],
  'GRV-000126': [
    'The old-age pension has not been received for the past three months. Enquiries at the village secretariat have not received a proper answer.',
    'We are checking the beneficiary’s details.',
  ],
  'GRV-000127': [
    'It has been six months since I applied for a new ration card. It has still not been approved.',
    'The application’s eligibility is under examination.',
  ],
  'GRV-000128': [
    'The approved second instalment of funds under the housing construction scheme has not been released. Construction has stopped halfway, and the family has to stay in a rented house during the rainy season.', null,
  ],
  'GRV-000129': [
    'The ration shop did not provide the full rice quota this month. When asked, they say there is no stock.',
    'An inquiry was conducted into the ration dealer, and the remaining quota was distributed.',
  ],
  'GRV-000130': [
    'Staff at the village secretariat do not arrive on time. People coming for certificates have to wait for hours.', null,
  ],
};

const englishBySource = new Map<string, string>();
for (const record of DEMO_GRIEVANCES) {
  const translated = TRANSLATIONS[record.id];
  if (!translated) continue;
  englishBySource.set(record.complaintText.normalize('NFC').trim(), translated[0]);
  if (record.responseText && translated[1]) englishBySource.set(record.responseText.normalize('NFC').trim(), translated[1]);
}

export type TextLanguage = 'te' | 'en' | 'mixed' | 'unknown';
export type TextView = 'original' | 'en' | 'both';
export const TEXT_LANGUAGE_LABEL = { te: 'తెలుగు · Telugu', en: 'English', mixed: 'తెలుగు / English', unknown: 'Unknown language' };
export function textLanguage(text: string): TextLanguage {
  const telugu = /[\u0C00-\u0C7F]/.test(text);
  const latin = /[A-Za-z]/.test(text);
  if (telugu) return latin ? 'mixed' : 'te';
  const letters = text.match(/\p{Letter}/gu) ?? [];
  return letters.length && letters.every((letter) => /\p{Script=Latin}/u.test(letter)) ? 'en' : 'unknown';
}

export function englishTranslation(text: string): string | null {
  if (textLanguage(text) === 'en') return text;
  return englishBySource.get(text.normalize('NFC').trim()) ?? null;
}

export function displayedText(original: string, view: TextView): string {
  const english = englishTranslation(original);
  if (view === 'en') return english ?? original;
  if (view === 'both' && english && english !== original) return `Original\n${original}\n\nEnglish translation\n${english}`;
  return original;
}
