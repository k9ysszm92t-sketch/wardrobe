import {
  SYSTEM_QA, SYSTEM_PLAN, SYSTEM_INGEST, SYSTEM_PHOTO, SYSTEM_MEMORY,
  getSystemLog,
  buildQAMessages, buildPlanMessages, buildIngestMessages,
  buildPhotoMessages, buildLogMessages, buildMemoryMessages,
} from './prompts.js';

const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';
const MODEL          = 'claude-sonnet-4-6';
const MAX_TOKENS     = 1024;
const MEMORY_TOKENS  = 512;   // memory extraction needs less headroom
const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse('', 204);
    if (request.method !== 'POST')    return corsResponse('Method not allowed', 405);

    let body;
    try { body = await request.json(); }
    catch { return corsResponse('Invalid JSON', 400); }

    const {
      type, userPrompt, styleIndex, preferences,
      wearHistory, weatherSummary, imageBase64,
    } = body;

    if (!type || !userPrompt) return corsResponse('Missing type or userPrompt', 400);

    // ── Route to correct system prompt + message builder ──────────────────────
    let system, messages, stream = true;

    if (type === 'plan') {
      system   = SYSTEM_PLAN;
      messages = buildPlanMessages(userPrompt, styleIndex ?? [], preferences, wearHistory ?? '', weatherSummary ?? '');

    } else if (type === 'photo') {
      if (!imageBase64) return corsResponse('Missing imageBase64 for photo request', 400);
      system   = SYSTEM_PHOTO;
      messages = buildPhotoMessages(userPrompt, styleIndex ?? [], preferences, imageBase64);

    } else if (type === 'log') {
      system   = getSystemLog();
      messages = buildLogMessages(userPrompt, styleIndex ?? []);
      stream   = false;

    } else if (type === 'memory') {
      const { userMessage, assistantResponse, currentPrefs } = body;
      system   = SYSTEM_MEMORY;
      messages = buildMemoryMessages(userMessage ?? '', assistantResponse ?? '', currentPrefs ?? {});
      stream   = false;

    } else if (type === 'ingest') {
      system   = SYSTEM_INGEST;
      messages = buildIngestMessages(userPrompt, styleIndex ?? []);

    } else {
      system   = SYSTEM_QA;
      messages = buildQAMessages(userPrompt, styleIndex ?? [], preferences);
    }

    // ── Call Anthropic ────────────────────────────────────────────────────────
    const anthropicReq = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: type === 'memory' ? MEMORY_TOKENS : MAX_TOKENS,
        system,
        messages,
        stream,
      }),
    });

    if (!anthropicReq.ok) {
      const err = await anthropicReq.text();
      return corsResponse(`Anthropic error: ${err}`, 502);
    }

    // Non-streaming: return plain text
    if (!stream) {
      const data = await anthropicReq.json();
      const text = data.content?.map(b => b.text ?? '').join('') ?? '';
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type':                'text/plain',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }

    // Streaming: pass through SSE
    return new Response(anthropicReq.body, {
      status: 200,
      headers: {
        'Content-Type':                'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Transfer-Encoding':           'chunked',
        'Cache-Control':               'no-cache',
      },
    });
  },
};

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type':                 'text/plain',
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
