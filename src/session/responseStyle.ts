export type ResponseMode = 'concise' | 'detailed' | 'steps' | 'logs';
export type VerbosityLevel = 'short' | 'normal' | 'expanded';

export interface ResponseStyle {
  mode: ResponseMode;
  verbosity: VerbosityLevel;
}

export const DEFAULT_RESPONSE_STYLE: ResponseStyle = {
  mode: 'concise',
  verbosity: 'normal',
};

export interface StyleDirectiveResult {
  style: ResponseStyle;
  cleanedText: string;
  changed: boolean;
  onlyDirective: boolean;
  ackText?: string;
}

const directivePatterns: Array<{
  pattern: RegExp;
  apply: (style: ResponseStyle) => ResponseStyle;
  ack: string;
}> = [
  {
    pattern: /\b(be detailed|more detailed|in detail|full detail)\b/i,
    apply: (style) => ({ ...style, mode: 'detailed', verbosity: 'normal' }),
    ack: 'Got it — I’ll be more detailed.',
  },
  {
    pattern: /\b(explain more|expand|go deeper|more depth)\b/i,
    apply: (style) => ({ ...style, mode: 'detailed', verbosity: 'expanded' }),
    ack: 'Sure — I’ll explain more.',
  },
  {
    pattern: /\b(give steps|step by step|steps?)\b/i,
    apply: (style) => ({ ...style, mode: 'steps', verbosity: 'normal' }),
    ack: 'Okay — I’ll give steps.',
  },
  {
    pattern: /\b(show logs|logs?|log output)\b/i,
    apply: (style) => ({ ...style, mode: 'logs', verbosity: 'normal' }),
    ack: 'Okay — I’ll include logs.',
  },
  {
    pattern: /\b(short|brief|quick answer|tl;dr)\b/i,
    apply: (style) => ({ ...style, mode: 'concise', verbosity: 'short' }),
    ack: 'Got it — I’ll keep it short.',
  },
  {
    pattern: /\b(concise|normal|default)\b/i,
    apply: () => ({ ...DEFAULT_RESPONSE_STYLE }),
    ack: 'Got it — I’ll keep it concise.',
  },
];

export function applyStyleDirective(
  input: string,
  currentStyle: ResponseStyle = DEFAULT_RESPONSE_STYLE
): StyleDirectiveResult {
  let style = { ...currentStyle };
  let cleanedText = input;
  let changed = false;
  let ackText: string | undefined;

  for (const directive of directivePatterns) {
    if (directive.pattern.test(cleanedText)) {
      style = directive.apply(style);
      cleanedText = cleanedText.replace(directive.pattern, ' ').replace(/\s+/g, ' ').trim();
      changed = true;
      ackText = directive.ack;
    }
  }

  const onlyDirective = changed && cleanedText.length === 0;

  return {
    style,
    cleanedText,
    changed,
    onlyDirective,
    ackText,
  };
}

export function shouldIncludeSnippets(
  query: string,
  style: ResponseStyle
): boolean {
  const lower = query.toLowerCase();
  const askedForCode = /show|snippet|code|lines?|example|implementation|source/.test(lower);
  return style.mode === 'logs' || askedForCode;
}

export function getMaxSentences(style: ResponseStyle): number {
  if (style.verbosity === 'short') {
    return 2;
  }
  if (style.mode === 'concise') {
    return 4;
  }
  if (style.mode === 'detailed') {
    return style.verbosity === 'expanded' ? 8 : 6;
  }
  if (style.mode === 'steps') {
    return 4;
  }
  return 4;
}

export function normalizeResponseText(text: string): string {
  const lines = text.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return false;
    if (/^\*\*[^*]+\*\*:?$/.test(trimmed)) return false;
    return true;
  });
  return filtered.join('\n').trim();
}

export function limitToSentences(text: string, maxSentences: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;

  const sentenceMatches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!sentenceMatches || sentenceMatches.length <= maxSentences) {
    return normalized;
  }

  return sentenceMatches.slice(0, maxSentences).join(' ').trim();
}
