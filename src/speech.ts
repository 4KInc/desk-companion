/** Minimal typing for the (still vendor-prefixed) Web Speech recognition API. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** Returns the recognition constructor, or undefined where speech input is unsupported. */
export function speechRecognitionConstructor(): (new () => SpeechRecognitionLike) | undefined {
  const scope = globalThis as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
}
