import cors from 'cors';
import express from 'express';
import type {CreateRagExampleInput, MessageEvent, Platform, ReplyStatus} from '@casebee/shared';
import './config/env.js';
import {checkDatabase} from './db/pool.js';
import {resolveAlert} from './repositories/alertsRepository.js';
import {findAllCases, findCaseById, findCaseDetailById, updateCaseFields} from './repositories/casesRepository.js';
import {findCustomerDetailById, findCustomerSummaries} from './repositories/customersRepository.js';
import {excludeMessage, findAllMessages, findReplyStatusHistoryByMessageId, setReplyStatus} from './repositories/messagesRepository.js';
import {createRagExample, deactivateRagExample, findAllRagExamples} from './repositories/ragExamplesRepository.js';
import {findReviewHistoryByMessageId, findReviewItemsByMessageId, resolveReviewItem} from './repositories/aiReviewRepository.js';
import {enrichBusinessRisk, getBusinessRiskSummary} from './services/businessRiskService.js';
import {getRegistryBackground, screenRegistry} from './services/gcisBusinessRegistryProvider.js';
import {extractEntityNames} from './services/entityNameExtractor.js';
import {importDemoMessages} from './services/demoImportService.js';
import {createGmailAuthUrl, getGmailStatus, handleGmailCallback, pollGmailMessages} from './services/gmailService.js';
import {startGmailPollingScheduler} from './services/gmailPollingScheduler.js';
import {handleLineWebhookEvents, verifyLineSignature} from './services/lineService.js';
import {importMessage} from './services/messageImportService.js';
import {reanalyzeMessage} from './services/messageReanalysisService.js';
import {getRuleScheduleStatus, runReplyOverdueRules} from './services/ruleEngine.js';

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const platforms: Platform[] = ['LINE', 'Gmail', 'Instagram', 'Manual'];
const replyStatuses: ReplyStatus[] = ['pending_reply', 'replied', 'no_reply_needed'];

function isCreateRagExampleInput(payload: Partial<CreateRagExampleInput>): payload is CreateRagExampleInput {
  return typeof payload.title === 'string'
    && platforms.includes(payload.platform as Platform)
    && typeof payload.projectItem === 'string'
    && (payload.quoteAmount === null || typeof payload.quoteAmount === 'number')
    && typeof payload.outcome === 'string'
    && typeof payload.summary === 'string'
    && typeof payload.replyExample === 'string'
    && (payload.caseType === undefined || payload.caseType === null || typeof payload.caseType === 'string')
    && (payload.projectAliases === undefined || (Array.isArray(payload.projectAliases) && payload.projectAliases.every((item) => typeof item === 'string')))
    && (payload.typicalMissingFields === undefined || (Array.isArray(payload.typicalMissingFields) && payload.typicalMissingFields.every((item) => typeof item === 'string')))
    && (payload.quoteRangeMin === undefined || payload.quoteRangeMin === null || typeof payload.quoteRangeMin === 'number')
    && (payload.quoteRangeMax === undefined || payload.quoteRangeMax === null || typeof payload.quoteRangeMax === 'number')
    && (payload.successPattern === undefined || payload.successPattern === null || typeof payload.successPattern === 'string');
}

app.use(cors({origin: process.env.FRONTEND_URL ?? 'http://localhost:5173'}));
app.use(express.json({
  verify: (request, _response, buffer) => {
    (request as express.Request & {rawBody?: Buffer}).rawBody = Buffer.from(buffer);
  },
}));

app.get('/api/health', async (_request, response) => {
  try {
    const database = await checkDatabase();
    response.json({status: 'ok', service: 'casebee-api', database, timestamp: new Date().toISOString()});
  } catch (error) {
    response.status(503).json({
      status: 'degraded',
      service: 'casebee-api',
      database: {status: 'disconnected'},
      error: error instanceof Error ? error.message : 'Database check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/cases', async (_request, response) => {
  try {
    response.json({data: await findAllCases()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load cases'}});
  }
});

app.get('/api/customers', async (_request, response) => {
  try {
    response.json({data: await findCustomerSummaries()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load customers'}});
  }
});

app.get('/api/customers/:id/details', async (request, response) => {
  try {
    const item = await findCustomerDetailById(request.params.id);
    if (!item) {
      response.status(404).json({error: {message: 'Customer not found'}});
      return;
    }
    response.json({data: item});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load customer detail'}});
  }
});

app.get('/api/cases/:id', async (request, response) => {
  let item;

  try {
    item = await findCaseById(request.params.id);
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load case'}});
    return;
  }

  if (!item) {
    response.status(404).json({error: {message: 'Case not found'}});
    return;
  }

  response.json({data: item});
});

app.get('/api/cases/:id/details', async (request, response) => {
  try {
    const item = await findCaseDetailById(request.params.id);
    if (!item) {
      response.status(404).json({error: {message: 'Case not found'}});
      return;
    }

    response.json({data: item});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load case detail'}});
  }
});

app.patch('/api/cases/:id', async (request, response) => {
  const payload = request.body as {status?: unknown; quoteAmount?: unknown; expectedDeadline?: unknown; summary?: unknown};
  const hasInvalidPayload =
    (payload.status !== undefined && typeof payload.status !== 'string')
    || (payload.quoteAmount !== undefined && payload.quoteAmount !== null && typeof payload.quoteAmount !== 'number')
    || (payload.expectedDeadline !== undefined && payload.expectedDeadline !== null && typeof payload.expectedDeadline !== 'string')
    || (payload.summary !== undefined && typeof payload.summary !== 'string');

  if (hasInvalidPayload) {
    response.status(400).json({error: {message: 'Invalid case update payload'}});
    return;
  }

  try {
    const item = await updateCaseFields(request.params.id, {
      status: payload.status as never,
      quoteAmount: payload.quoteAmount as number | null | undefined,
      expectedDeadline: payload.expectedDeadline as string | null | undefined,
      summary: payload.summary as string | undefined,
    });
    if (!item) {
      response.status(404).json({error: {message: 'Case not found'}});
      return;
    }

    response.json({data: item});
  } catch (error) {
    response.status(400).json({error: {message: error instanceof Error ? error.message : 'Failed to update case'}});
  }
});

app.patch('/api/alerts/:id/resolve', async (request, response) => {
  try {
    const item = await resolveAlert(request.params.id);
    if (!item) {
      response.status(404).json({error: {message: 'Alert not found'}});
      return;
    }

    response.json({data: item});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to resolve alert'}});
  }
});

app.get('/api/messages', async (_request, response) => {
  try {
    response.json({data: await findAllMessages()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load messages'}});
  }
});

app.post('/api/messages/:id/exclude', async (request, response) => {
  const payload = request.body as {reason?: unknown};
  const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : '使用者排除不相關郵件';

  try {
    const result = await excludeMessage(request.params.id, reason);
    if (!result) {
      response.status(404).json({error: {message: 'Message not found'}});
      return;
    }

    response.json({data: result});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to exclude message'}});
  }
});

app.post('/api/messages/:id/reanalyze', async (request, response) => {
  try {
    const result = await reanalyzeMessage(request.params.id);
    if (!result) {
      response.status(404).json({error: {message: 'Message not found'}});
      return;
    }

    response.json({data: result});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to reanalyze message'}});
  }
});

app.patch('/api/messages/:id/reply-status', async (request, response) => {
  const payload = request.body as {replyStatus?: unknown};
  if (!replyStatuses.includes(payload.replyStatus as ReplyStatus)) {
    response.status(400).json({error: {message: 'Invalid reply status'}});
    return;
  }

  try {
    const message = await setReplyStatus(request.params.id, payload.replyStatus as ReplyStatus, 'user');
    if (!message) {
      response.status(404).json({error: {message: 'Message not found'}});
      return;
    }
    response.json({data: message});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to update reply status'}});
  }
});

app.get('/api/messages/:id/reply-status-history', async (request, response) => {
  try {
    response.json({data: await findReplyStatusHistoryByMessageId(request.params.id)});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load reply status history'}});
  }
});

app.get('/api/messages/:id/review', async (request, response) => {
  try {
    const [items, history] = await Promise.all([
      findReviewItemsByMessageId(request.params.id),
      findReviewHistoryByMessageId(request.params.id),
    ]);
    response.json({data: {items, history}});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load AI review detail'}});
  }
});

app.post('/api/reviews/:id/resolve', async (request, response) => {
  const payload = request.body as {action?: unknown; value?: unknown};
  if (payload.action !== 'apply' && payload.action !== 'keep' && payload.action !== 'edit') {
    response.status(400).json({error: {message: 'Invalid review action'}});
    return;
  }

  try {
    const result = await resolveReviewItem(request.params.id, payload.action, payload.value);
    if (!result) {
      response.status(404).json({error: {message: 'Pending review item not found'}});
      return;
    }
    response.json({data: result});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to resolve review item'}});
  }
});

app.post('/api/messages/import', async (request, response) => {
  const payload = request.body as Partial<MessageEvent>;

  if (!payload.text || !payload.senderName || !payload.platform) {
    response.status(400).json({error: {message: 'platform, senderName, and text are required'}});
    return;
  }

  try {
    const result = await importMessage({
      platform: payload.platform as Platform,
      senderId: payload.senderId,
      senderName: payload.senderName,
      text: payload.text,
      timestamp: payload.timestamp,
      threadId: payload.threadId,
      rawPayload: payload,
    });
    response.status(201).json({data: result});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to import message'}});
  }
});

app.post('/api/webhooks/line', (request, response) => {
  const rawBody = (request as express.Request & {rawBody?: Buffer}).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
  const signature = request.header('x-line-signature');

  if (!verifyLineSignature(rawBody, signature)) {
    response.status(401).json({error: {message: 'Invalid LINE signature'}});
    return;
  }

  const events = Array.isArray(request.body?.events) ? request.body.events : [];
  // Respond immediately so LINE does not retry/time out; process events in the background.
  response.json({ok: true, receivedEvents: events.length});

  handleLineWebhookEvents(events).catch((error) => {
    console.error('Failed to process LINE webhook events', error);
  });
});

app.post('/api/demo/import', async (_request, response) => {
  try {
    response.status(201).json({data: await importDemoMessages()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to import demo messages'}});
  }
});

app.post('/api/rules/run', async (_request, response) => {
  try {
    response.json({data: await runReplyOverdueRules()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to run rules'}});
  }
});

app.get('/api/rules/status', (_request, response) => {
  response.json({data: getRuleScheduleStatus()});
});

app.get('/api/rag/examples', async (_request, response) => {
  try {
    response.json({data: await findAllRagExamples()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load RAG examples'}});
  }
});

app.post('/api/rag/examples', async (request, response) => {
  const payload = request.body as Partial<CreateRagExampleInput>;

  if (!isCreateRagExampleInput(payload)) {
    response.status(400).json({error: {message: 'Invalid RAG example payload'}});
    return;
  }

  try {
    response.status(201).json({data: await createRagExample(payload)});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to create RAG example'}});
  }
});

app.patch('/api/rag/examples/:id/deactivate', async (request, response) => {
  try {
    const item = await deactivateRagExample(request.params.id);
    if (!item) {
      response.status(404).json({error: {message: 'RAG example not found'}});
      return;
    }

    response.json({data: item});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to deactivate RAG example'}});
  }
});

app.get('/api/business/risk-summary', async (_request, response) => {
  try {
    response.json({data: await getBusinessRiskSummary()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load business risk summary'}});
  }
});

app.post('/api/business/enrich', async (request, response) => {
  const payload = request.body as {customerName?: string; taxId?: string; customerId?: string};

  if (!payload.customerName && !payload.taxId) {
    response.status(400).json({error: {message: 'customerName or taxId is required'}});
    return;
  }

  try {
    response.status(201).json({
      data: await enrichBusinessRisk({
        customerName: payload.customerName ?? payload.taxId ?? '未命名客戶',
        taxId: payload.taxId,
        customerId: payload.customerId ?? null,
      }),
    });
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to enrich business risk'}});
  }
});

app.post('/api/business/screen', async (request, response) => {
  const payload = request.body as {taxId?: unknown; keyword?: unknown};
  const taxId = typeof payload.taxId === 'string' ? payload.taxId.trim() : '';
  const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : '';

  if (!taxId && !keyword) {
    response.status(400).json({error: {message: 'taxId or keyword is required'}});
    return;
  }

  if (taxId && !keyword && !/^\d{8}$/.test(taxId)) {
    response.status(400).json({error: {message: 'taxId must be 8 digits'}});
    return;
  }

  try {
    response.json({data: await screenRegistry({taxId: taxId || undefined, keyword: keyword || undefined})});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to screen registry'}});
  }
});

app.post('/api/business/extract-names', (request, response) => {
  const payload = request.body as {text?: unknown};
  const text = typeof payload.text === 'string' ? payload.text.slice(0, 5000) : '';
  response.json({data: {names: extractEntityNames(text)}});
});

app.post('/api/business/background', async (request, response) => {
  const payload = request.body as {taxId?: unknown};
  const taxId = typeof payload.taxId === 'string' ? payload.taxId.trim() : '';

  if (!/^\d{8}$/.test(taxId)) {
    response.status(400).json({error: {message: 'taxId must be 8 digits'}});
    return;
  }

  try {
    const card = await getRegistryBackground(taxId);
    if (!card) {
      response.status(404).json({error: {message: 'Registry record not found'}});
      return;
    }
    response.json({data: card});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load registry background'}});
  }
});

app.get('/api/integrations/gmail/status', async (_request, response) => {
  try {
    response.json({data: await getGmailStatus()});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to load Gmail status'}});
  }
});

app.get('/api/integrations/gmail/auth', (_request, response) => {
  try {
    response.json({data: {url: createGmailAuthUrl()}});
  } catch (error) {
    response.status(500).json({error: {message: error instanceof Error ? error.message : 'Failed to create Gmail auth URL'}});
  }
});

app.get('/api/integrations/gmail/callback', async (request, response) => {
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  if (!code) {
    response.status(400).send('Missing Gmail authorization code');
    return;
  }

  try {
    const connection = await handleGmailCallback(code);
    response.send(`Gmail connected for ${connection.accountEmail ?? 'unknown account'}. You can close this page.`);
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : 'Failed to connect Gmail');
  }
});

app.post('/api/integrations/gmail/poll', async (_request, response) => {
  try {
    response.json({data: await pollGmailMessages()});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to poll Gmail';
    const status = message.includes('not connected') || message.includes('not configured') ? 400 : 500;
    response.status(status).json({error: {message}});
  }
});

app.listen(port, () => {
  console.log(`Casebee API listening on http://localhost:${port}`);
  startGmailPollingScheduler();
});
