import {
  SYSTEM_QA, SYSTEM_PLAN, SYSTEM_INGEST, SYSTEM_LOG,
  buildQAMessages, buildPlanMessages, buildIngestMessages, buildLogMessages,
} from './prompts.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5-20251001';  // cheapest, fast enough
const MAX_TOKENS    = 1024;

// Allowed origin — set to your GitHub Pages URL in production
const ALLOWED_ORIGIN = '*'; // e.g. 'https://yourusername.github.io'

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204);
    }

    if (request.method !== 'POST') {
      return corsResponse('Method not allowed', 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse('Invalid JSON', 400);
    }

    const { type, userPrompt, styleIndex, wearHistory, weatherSummary } = body;

    if (!type || !userPrompt) {
      return corsResponse('Missing type or userPrompt', 400);
    }

    // Select system prompt and build messages
    let system, messages;

    if (type === 'plan') {
      system   = SYSTEM_PLAN;
      messages = buildPlanMessages(userPrompt, styleIndex ?? [], wearHistory ?? '', weatherSummary ?? '');
    } else if (type === 'ingest') {
      system   = SYSTEM_INGEST;
      messages = buildIngestMessages(userPrompt, styleIndex ?? []);
    } else if (type === 'log') {
      system   = SYSTEM_LOG;
      messages = buildLogMessages(userPrompt, styleIndex ?? []);
    } else {
      // 'qa' and anything else
      system   = SYSTEM_QA;
      messages = buildQAMessages(userPrompt, styleIndex ?? []);
    }

    // Log requests return JSON — don't stream, return full response
    const streamMode = type !== 'log';

    // Call Anthropic API
    const anthropicReq = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        stream: streamMode,
      }),
    });

    if (!anthropicReq.ok) {
      const err = await anthropicReq.text();
      return corsResponse(`Anthropic error: ${err}`, 502);
    }

    // Non-streaming: extract text and return as plain JSON string
    if (!streamMode) {
      const data = await anthropicReq.json();
      const text = data.content?.map(b => b.text ?? '').join('') ?? '';
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }

    // Streaming: pass through directly
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type':                'text/plain',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
