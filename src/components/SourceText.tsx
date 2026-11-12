/**
 * Record text exactly as it arrived, in whatever language it arrived in. Nothing is translated:
 * the app only adds a language hint so fonts and screen readers handle Telugu correctly.
 */
export function SourceText({ text }: { text: string }) {
  const telugu = /[\u0C00-\u0C7F]/.test(text);
  const latinOnly = !telugu && /[A-Za-z]/.test(text);
  return (
    <div className="text-body">
      <p className={telugu ? 'te source-text' : 'source-text'} lang={telugu ? 'te' : latinOnly ? 'en' : undefined}>
        {text}
      </p>
    </div>
  );
}
