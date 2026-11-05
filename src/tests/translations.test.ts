import { describe, expect, it } from 'vitest';
import { createExpandedDataset, DEMO_GRIEVANCES } from '../data/demoGrievances';
import { displayedText, englishTranslation, textLanguage } from '../data/englishTranslations';

describe('English record translations', () => {
  it('covers every sample and expanded complaint and recorded response', () => {
    for (const record of [...DEMO_GRIEVANCES, ...createExpandedDataset().records]) {
      expect(englishTranslation(record.complaintText)).toBeTruthy();
      if (record.responseText?.trim()) expect(englishTranslation(record.responseText)).toBeTruthy();
    }
  });
  it('matches source text rather than case IDs and never invents an imported translation', () => {
    expect(englishTranslation('ఇది కొత్తగా దిగుమతి చేసిన ఫిర్యాదు.')).toBeNull();
    expect(englishTranslation('यह एक शिकायत है।')).toBeNull();
    expect(englishTranslation(DEMO_GRIEVANCES[0].complaintText.normalize('NFD'))).toContain('diabetes');
  });
  it('detects the actual response language even for an English complaint', () => {
    const record = DEMO_GRIEVANCES.find((item) => item.language === 'en')!;
    expect(textLanguage(record.complaintText)).toBe('en');
    expect(textLanguage(record.responseText!)).toBe('te');
    expect(englishTranslation(record.complaintText)).toBe(record.complaintText);
  });
  it('copies the selected view while preserving original source text', () => {
    const original = DEMO_GRIEVANCES[0].complaintText;
    expect(displayedText(original, 'original')).toBe(original);
    expect(displayedText(original, 'en')).toBe(englishTranslation(original));
    expect(displayedText(original, 'both')).toContain(original);
    expect(displayedText(original, 'both')).toContain(englishTranslation(original));
    expect(displayedText('అందుబాటులో లేని అనువాదం', 'en')).toBe('అందుబాటులో లేని అనువాదం');
  });
});
