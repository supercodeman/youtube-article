const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUIREMENTS_LENGTH = 500;

export function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url);
}

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

export function sanitizeRequirements(requirements: string | undefined): string {
  if (!requirements) return '';
  return requirements.slice(0, MAX_REQUIREMENTS_LENGTH).trim();
}

export function extractVideoId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
  if (!match) throw new Error('Invalid YouTube URL');
  return match[1];
}

export function isValidSessionStatus(status: string): status is 'idle' | 'generating' | 'done' | 'error' {
  return ['idle', 'generating', 'done', 'error'].includes(status);
}