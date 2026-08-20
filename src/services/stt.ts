import OpenAI, { toFile } from 'openai'

const LANG_NAMES: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  vi: 'Vietnamese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  th: 'Thai',
  id: 'Indonesian',
  hi: 'Hindi',
}

// Transcribe one audio chunk (auto-detecting the spoken language) then translate the
// transcript into each target language in a single structured call.
//
// We do NOT force the transcription language: forcing the speaker's profile language made
// the model transcribe, say, spoken English AS Korean (wrong-language gibberish). Letting
// gpt-4o-transcribe detect the language is far more robust for a cross-border meeting.
export async function transcribeAndTranslate(
  audio: Buffer,
  opts: { sourceLang: string; targetLangs: string[]; apiKey: string },
): Promise<{ sourceText: string; translations: Record<string, string> }> {
  const openai = new OpenAI({ apiKey: opts.apiKey })

  const file = await toFile(audio, 'audio.webm', { type: 'audio/webm' })
  const tr = await openai.audio.transcriptions.create({
    model: 'gpt-4o-transcribe',
    file,
    // language intentionally omitted → auto-detect the spoken language.
  })
  const sourceText = tr.text?.trim() ?? ''

  const targets = opts.targetLangs.length ? opts.targetLangs : ['ko', 'en']
  if (!sourceText) {
    return { sourceText: '', translations: Object.fromEntries(targets.map((l) => [l, ''])) }
  }

  // One structured call returns every target language, keeping a same-language target
  // identical to the source instead of round-tripping it through the model.
  const legend = targets.map((l) => `${l} = ${LANG_NAMES[l] ?? l}`).join(', ')
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          `You translate one line of meeting speech. First detect the language of the transcript. ` +
          `Return ONLY a JSON object whose keys are exactly: ${targets.join(', ')} (${legend}). ` +
          `Each value is the transcript rendered in that language. If the transcript is already in ` +
          `that language, copy it verbatim. Preserve meaning; do not add notes, quotes, or extra keys.`,
      },
      { role: 'user', content: sourceText },
    ],
  })

  let translations: Record<string, string> = {}
  try {
    const parsed = JSON.parse(r.choices[0]?.message?.content ?? '{}') as Record<string, unknown>
    for (const l of targets) {
      const v = parsed[l]
      translations[l] = typeof v === 'string' && v.trim() ? v.trim() : sourceText
    }
  } catch {
    // Model didn't return valid JSON — fall back to the raw transcript for every target.
    translations = Object.fromEntries(targets.map((l) => [l, sourceText]))
  }

  return { sourceText, translations }
}
