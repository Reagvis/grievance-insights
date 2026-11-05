import { englishTranslation, textLanguage, TEXT_LANGUAGE_LABEL, type TextView } from '../data/englishTranslations';

export function TranslatedText({ text, view }: { text: string; view: TextView }) {
  const english = englishTranslation(text);
  const language = textLanguage(text);
  const showOriginal = view !== 'en' || !english;
  const showEnglish = view !== 'original' && english && (view === 'en' || language !== 'en');
  return (
    <>
      {showOriginal && <div className="text-body">
        <p className="translation-caption">Original · {TEXT_LANGUAGE_LABEL[language]}</p>
        <p className={`${language === 'te' || language === 'mixed' ? 'te ' : ''}source-text`} lang={language === 'te' || language === 'mixed' ? 'te' : language === 'en' ? 'en' : undefined}>{text}</p>
      </div>}
      {showEnglish && <div className="text-body text-body--translation">
        <p className="translation-caption">{language === 'en' ? 'English · Original text' : 'English translation'}</p>
        <p className="source-text" lang="en">{english}</p>
      </div>}
      {view !== 'original' && !english && <p className="record-note" role="status">An English translation is not available for this text. Showing the original.</p>}
    </>
  );
}
