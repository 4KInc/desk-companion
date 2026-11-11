import { handleBrainDumpRequest } from '../server/brain-dump.js';

// Vercel Node function (web-standard signature). Needs ANTHROPIC_API_KEY set
// in the project's environment variables.
export function POST(request: Request): Promise<Response> {
  return handleBrainDumpRequest(request);
}
