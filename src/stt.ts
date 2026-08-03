import OpenAI, { toFile } from 'openai'

const LANG_NAMES: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  vi: 'Vietnamese',
}

// Transcribe one audio chunk, then translate into each target language.
export async function transcribeAndTranslate(
  audio: Buffer,
  opts: { sourceLang: string; targetLangs: string[]; apiKey: string },
): Promise<{ sourceText: string; translations: Record<string, string> }> {
  const openai = new OpenAI({ apiKey: opts.apiKey })

  const file = await toFile(audio, 'audio.webm', { type: 'audio/webm' })
  const tr = await openai.audio.transcriptions.create({
    model: 'gpt-4o-transcribe',
    file,
    language: opts.sourceLang,
  })
  const sourceText = tr.text?.trim() ?? ''

  const translations: Record<string, string> = {}
  for (const lang of opts.targetLangs) {
    if (!sourceText || lang === opts.sourceLang) {
      translations[lang] = sourceText
      continue
    }
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Translate the user's message into ${LANG_NAMES[lang] ?? lang}. Output only the translation, with no quotes or notes.`,
        },
        { role: 'user', content: sourceText },
      ],
    })
    translations[lang] = r.choices[0]?.message?.content?.trim() ?? ''
  }

  return { sourceText, translations }
}
