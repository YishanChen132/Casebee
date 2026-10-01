import {createAlert, resolveAlert} from '../repositories/alertsRepository.js';
import {findReviewHistoryByMessageId, findReviewItemsByMessageId, resolveReviewItem} from '../repositories/aiReviewRepository.js';
import {findAllCases, findCaseDetailById, updateCaseFields} from '../repositories/casesRepository.js';
import {findCustomerDetailById, findCustomerSummaries} from '../repositories/customersRepository.js';
import {findSenderEmailExclusionRule} from '../repositories/messageExclusionRulesRepository.js';
import {createMessage, excludeMessage, findAllMessages, findReplyStatusHistoryByMessageId, setReplyStatus} from '../repositories/messagesRepository.js';
import {createRagExample, deactivateRagExample, findAllRagExamples} from '../repositories/ragExamplesRepository.js';
import {pool} from '../db/pool.js';
import {enrichBusinessRisk} from '../services/businessRiskService.js';
import {mapCaseStatusToStage, normalizeMissingFields, stageRequiredFields} from '@casebee/shared';
import {analyzeMessage} from '../services/aiService.js';
import {inferCustomerName} from '../services/customerNameInference.js';
import {extractMessage} from '../services/extractionService.js';
import {getGmailStatus} from '../services/gmailService.js';
import {importMessage} from '../services/messageImportService.js';
import {reanalyzeMessage} from '../services/messageReanalysisService.js';
import {getRuleScheduleStatus, runReplyOverdueRules, runRules} from '../services/ruleEngine.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await pool.query('DELETE FROM alerts WHERE title = $1', ['Smoke test alert']);
  await pool.query('DELETE FROM rag_examples WHERE title = $1', ['Smoke test RAG example']);

  const cases = await findAllCases();
  assert(cases.length > 0, 'Expected at least one case. Run npm run db:seed first.');
  assert(mapCaseStatusToStage('潛在詢問') === 'inquiry', 'Expected 潛在詢問 to map to inquiry.');
  assert(mapCaseStatusToStage('已報價') === 'quotation', 'Expected 已報價 to map to quotation.');
  assert(mapCaseStatusToStage('已確認合作') === 'confirmed', 'Expected 已確認合作 to map to confirmed.');
  assert(mapCaseStatusToStage('進行中') === 'execution', 'Expected 進行中 to map to execution.');
  assert(mapCaseStatusToStage('已完成') === 'completed', 'Expected 已完成 to map to completed.');
  assert(mapCaseStatusToStage('已流失') === 'cancelled', 'Expected 已流失 to map to cancelled.');
  assert(mapCaseStatusToStage('unknown-status') === 'inquiry', 'Expected unknown status to fall back safely.');
  assert(normalizeMissingFields(['materials', 'reference', 'quoteAmount', 'deadline']).join(',') === 'quote_amount,expected_deadline,required_materials', 'Expected missing field aliases to normalize in taxonomy order.');
  assert(['inquiry', 'quotation', 'confirmed', 'execution', 'completed', 'cancelled'].includes(cases[0].caseStage), 'Expected case serialization to include standard caseStage.');
  assert(stageRequiredFields.completed.length === 0 && stageRequiredFields.cancelled.length === 0, 'Expected completed and cancelled stages not to require missing fields.');

  const messages = await findAllMessages();
  assert(messages.length > 0, 'Expected at least one message. Run npm run db:seed first.');
  await pool.query('DELETE FROM messages WHERE sender_id = $1', ['smoke-exclude@example.com']);
  const smokeMessage = await createMessage({
    platform: 'Gmail',
    senderId: 'smoke-exclude@example.com',
    senderName: 'Smoke Exclude Sender',
    text: 'Smoke test message exclusion',
    rawPayload: {smokeTest: true},
  });
  const excludedMessage = await excludeMessage(smokeMessage.id, 'Smoke test exclusion');
  assert(excludedMessage?.message.id === smokeMessage.id, 'Expected message exclusion to return the excluded message.');
  const learnedExclusionRule = await findSenderEmailExclusionRule('Gmail', 'smoke-exclude@example.com');
  assert(learnedExclusionRule?.reason === 'Smoke test exclusion', 'Expected Gmail exclusion to learn sender rule.');
  const visibleMessagesAfterExclusion = await findAllMessages();
  assert(!visibleMessagesAfterExclusion.some((message) => message.id === smokeMessage.id), 'Expected excluded message to be hidden from message list.');
  await pool.query('DELETE FROM messages WHERE id = $1', [smokeMessage.id]);
  await pool.query('DELETE FROM message_exclusion_rules WHERE match_value = $1', ['smoke-exclude@example.com']);

  await pool.query('DELETE FROM ai_extractions WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)', ['smoke-reply@example.com']);
  const staleReplyCases = await pool.query('SELECT DISTINCT case_id FROM messages WHERE sender_id = $1 AND case_id IS NOT NULL', ['smoke-reply@example.com']);
  const staleReplyCaseIds = staleReplyCases.rows.map((row) => String(row.case_id));
  if (staleReplyCaseIds.length > 0) {
    await pool.query('DELETE FROM alerts WHERE case_id = ANY($1::text[])', [staleReplyCaseIds]);
  }
  await pool.query('DELETE FROM messages WHERE sender_id = $1', ['smoke-reply@example.com']);
  if (staleReplyCaseIds.length > 0) {
    await pool.query('DELETE FROM cases WHERE id = ANY($1::text[])', [staleReplyCaseIds]);
  }
  await pool.query("DELETE FROM customers WHERE contact_handle = 'smoke-reply@example.com' AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");
  const nonCaseReplyMessage = await createMessage({
    platform: 'Gmail',
    senderId: 'smoke-reply@example.com',
    senderName: 'Smoke System',
    text: 'Your one-time verification code is 123456.',
    rawPayload: {smokeReplyStatus: 'non-case'},
  });
  assert(nonCaseReplyMessage.replyStatus === 'no_reply_needed', 'Expected non-case direct message to default to no_reply_needed.');
  assert(nonCaseReplyMessage.replyStatusSource === 'system', 'Expected non-case default reply status source to be system.');
  await pool.query('DELETE FROM messages WHERE id = $1', [nonCaseReplyMessage.id]);

  const replyImport = await importMessage({
    platform: 'Gmail',
    senderId: 'smoke-reply@example.com',
    senderName: 'Smoke Reply Client',
    text: '想詢問官網設計報價，預算大約 120,000 元，希望 10/20 前完成。',
    rawPayload: {smokeReplyStatus: 'case'},
  });
  assert(replyImport.message.replyStatus === 'pending_reply', 'Expected imported case-related message to default to pending_reply.');
  assert(replyImport.message.replyStatusSource === 'system', 'Expected default pending reply source to be system.');
  const repliedMessage = await setReplyStatus(replyImport.message.id, 'replied', 'user');
  assert(repliedMessage?.replyStatus === 'replied' && repliedMessage.replyStatusSource === 'user', 'Expected user to mark message as replied.');
  const historyAfterReplied = await findReplyStatusHistoryByMessageId(replyImport.message.id);
  const userRepliedHistoryCount = historyAfterReplied.filter((item) => item.source === 'user' && item.previousStatus === 'pending_reply' && item.newStatus === 'replied').length;
  assert(userRepliedHistoryCount === 1, 'Expected pending_reply to replied to create one user history record.');
  assert(Boolean(historyAfterReplied[0]?.changedAt), 'Expected reply status history to include changedAt.');
  await setReplyStatus(replyImport.message.id, 'replied', 'user');
  const historyAfterDuplicateReplied = await findReplyStatusHistoryByMessageId(replyImport.message.id);
  assert(historyAfterDuplicateReplied.length === historyAfterReplied.length, 'Expected duplicate replied submission not to create history.');
  const noReplyNeededMessage = await setReplyStatus(replyImport.message.id, 'no_reply_needed', 'user');
  assert(noReplyNeededMessage?.replyStatus === 'no_reply_needed' && noReplyNeededMessage.replyStatusSource === 'user', 'Expected user to mark message as no_reply_needed.');
  const historyBeforeReanalysis = await findReplyStatusHistoryByMessageId(replyImport.message.id);
  const reanalyzedReplyMessage = await reanalyzeMessage(replyImport.message.id);
  assert(reanalyzedReplyMessage?.message.replyStatus === 'no_reply_needed' && reanalyzedReplyMessage.message.replyStatusSource === 'user', 'Expected reanalysis not to override user reply status.');
  const historyAfterReanalysis = await findReplyStatusHistoryByMessageId(replyImport.message.id);
  assert(historyAfterReanalysis.length === historyBeforeReanalysis.length, 'Expected reanalysis not to create reply status history.');
  assert(new Date(historyAfterReanalysis[0].changedAt).getTime() >= new Date(historyAfterReanalysis[historyAfterReanalysis.length - 1].changedAt).getTime(), 'Expected reply status history sorted newest first.');
  const visibleReplyMessages = await findAllMessages();
  assert(visibleReplyMessages.filter((message) => message.replyStatus === 'pending_reply').every((message) => message.replyStatus !== 'replied'), 'Expected messages to expose replyStatus for filtering.');
  const replyHistoryCountBeforeDelete = historyAfterReanalysis.length;
  assert(replyHistoryCountBeforeDelete > 0, 'Expected reply history before message deletion.');
  await pool.query('DELETE FROM alerts WHERE case_id = $1', [replyImport.case.id]);
  await pool.query('DELETE FROM ai_extractions WHERE message_id = $1', [replyImport.message.id]);
  await pool.query('DELETE FROM messages WHERE id = $1', [replyImport.message.id]);
  const replyHistoryAfterDelete = await findReplyStatusHistoryByMessageId(replyImport.message.id);
  assert(replyHistoryAfterDelete.length === 0, 'Expected reply status history to cascade when message is deleted.');
  await pool.query('DELETE FROM cases WHERE id = $1', [replyImport.case.id]);
  await pool.query("DELETE FROM customers WHERE contact_handle = 'smoke-reply@example.com' AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");
  const inferredCustomerName = inferCustomerName({
    senderName: 'fupin.mp2企劃部第二帳號',
    senderEmail: 'fupin.mp2@gmail.com',
    subject: '【第一屆富品盃 AI 創新應用競賽】決賽初評通知',
    text: '第一屆富品盃 AI 創新應用競賽 執行團隊 敬上',
  });
  assert(inferredCustomerName === '富品建設', 'Expected fupin sender to infer 富品建設.');

  const extractionCases = [
    {
      name: 'collaboration invite',
      input: {
        senderName: 'Amy',
        text: 'Subject: 【合作邀請】LumiNote × 小晴｜短影音宣傳合作邀約\n\n我是 LumiNote 行銷團隊的 Amy。合作形式：Instagram Reels 一支\n影片長度：30～60 秒\n預計上線時間：2026 年 9 月 15 日前\n其他需求：發布後以 Instagram 限時動態轉發一次',
      },
      expected: {clientName: 'LumiNote', projectItem: 'Instagram Reels', quoteAmount: null, expectedDeadline: '9/15', intent: '合作邀請'},
    },
    {
      name: 'quote inquiry',
      input: {
        senderName: '晴天行銷',
        text: '想詢問官網設計報價，預算大約 120,000 元，希望 10/20 前完成，請問可以接嗎？',
      },
      expected: {clientName: '晴天行銷', projectItem: '官網設計', quoteAmount: 120000, expectedDeadline: '10/20', intent: '詢價'},
    },
    {
      name: 'revision request',
      input: {
        senderName: '小島咖啡',
        text: 'Logo 想再修改一下，順便追加一張菜單 Banner，月底前可以完成嗎？',
      },
      expected: {clientName: '小島咖啡', projectItem: 'Logo', quoteAmount: null, expectedDeadline: '8/31', intent: '修改需求'},
    },
    {
      name: 'material delay risk',
      input: {
        senderName: '森木科技',
        text: '產品攝影素材下週才能給你，原本後天交件可能來不及，需要延後。',
      },
      expected: {clientName: '森木科技', projectItem: '產品攝影', quoteAmount: null, expectedDeadline: '9/2', intent: '交期風險'},
    },
    {
      name: 'submission and publish deadlines',
      input: {
        senderName: '日光製作',
        text: 'Reels 影片 9/10 前交初稿，9/15 上線，請提供報價。',
        receivedAt: '2026-08-31T00:00:00+08:00',
      },
      expected: {clientName: '日光製作', projectItem: 'Reels 影片', quoteAmount: null, expectedDeadline: '9/10', submissionDeadline: '9/10', publishDeadline: '9/15', nextAction: '提供報價', intent: '詢價'},
    },
    {
      name: 'submission deadline only',
      input: {
        senderName: '紙月設計',
        text: 'Logo 修改稿請 9/12 前交給我們，費用 12000。',
      },
      expected: {clientName: '紙月設計', projectItem: 'Logo', quoteAmount: 12000, expectedDeadline: '9/12', submissionDeadline: '9/12', publishDeadline: null, nextAction: '準備／提交初稿', intent: '修改需求'},
    },
    {
      name: 'publish deadline only',
      input: {
        senderName: 'Mori Select',
        text: '影片希望 10 月底發布，預算 30000。',
      },
      expected: {clientName: 'Mori Select', projectItem: '影片', quoteAmount: 30000, expectedDeadline: '10/31', submissionDeadline: null, publishDeadline: '10/31', nextAction: null, intent: '詢價'},
    },
    {
      name: 'generic deadline only',
      input: {
        senderName: '晴天行銷',
        text: '希望 9/15 前完成官網設計，預算 120000。',
      },
      expected: {clientName: '晴天行銷', projectItem: '官網設計', quoteAmount: 120000, expectedDeadline: '9/15', submissionDeadline: null, publishDeadline: null, nextAction: null, intent: '詢價'},
    },
    {
      name: 'relative friday submission',
      input: {
        senderName: '小島咖啡',
        text: '這週五前給腳本，短影音預算 20000。',
        receivedAt: '2026-08-31T00:00:00+08:00',
      },
      expected: {clientName: '小島咖啡', projectItem: '短影音', quoteAmount: 20000, expectedDeadline: '9/4', submissionDeadline: '9/4', publishDeadline: null, nextAction: '準備／提交初稿', intent: '詢價'},
    },
    {
      name: 'required materials waiting',
      input: {
        senderName: '森木科技',
        text: '產品攝影確認合作，請提供產品圖片、商品連結和 brief，收到後安排拍攝。',
      },
      expected: {clientName: '森木科技', projectItem: '產品攝影', quoteAmount: null, expectedDeadline: null, submissionDeadline: null, publishDeadline: null, nextAction: '等待客戶提供素材', requiredMaterials: ['產品圖片', '商品連結', 'brief'], intent: '確認合作'},
    },
    {
      name: 'provided logo not missing',
      input: {
        senderName: '沐白茶室',
        text: '附件提供 Logo，包裝設計還需要文案，預算 35000，9/20 前完稿。',
      },
      expected: {clientName: '沐白茶室', projectItem: '包裝設計', quoteAmount: 35000, expectedDeadline: '9/20', submissionDeadline: '9/20', publishDeadline: null, nextAction: '等待客戶提供素材', requiredMaterials: ['文案'], intent: '詢價'},
    },
  ];

  for (const item of extractionCases) {
    const extraction = extractMessage(item.input);
    assert(extraction.clientName === item.expected.clientName, `Expected ${item.name} clientName ${item.expected.clientName}, got ${extraction.clientName}.`);
    assert(extraction.projectItem === item.expected.projectItem, `Expected ${item.name} projectItem ${item.expected.projectItem}, got ${extraction.projectItem}.`);
    assert(extraction.quoteAmount === item.expected.quoteAmount, `Expected ${item.name} quoteAmount ${item.expected.quoteAmount}, got ${extraction.quoteAmount}.`);
    assert(extraction.expectedDeadline === item.expected.expectedDeadline, `Expected ${item.name} expectedDeadline ${item.expected.expectedDeadline}, got ${extraction.expectedDeadline}.`);
    if ('submissionDeadline' in item.expected) assert(extraction.submissionDeadline === item.expected.submissionDeadline, `Expected ${item.name} submissionDeadline ${item.expected.submissionDeadline}, got ${extraction.submissionDeadline}.`);
    if ('publishDeadline' in item.expected) assert(extraction.publishDeadline === item.expected.publishDeadline, `Expected ${item.name} publishDeadline ${item.expected.publishDeadline}, got ${extraction.publishDeadline}.`);
    if ('nextAction' in item.expected) assert(extraction.nextAction === item.expected.nextAction, `Expected ${item.name} nextAction ${item.expected.nextAction}, got ${extraction.nextAction}.`);
    if ('requiredMaterials' in item.expected) assert(JSON.stringify(extraction.requiredMaterials) === JSON.stringify(item.expected.requiredMaterials), `Expected ${item.name} requiredMaterials ${JSON.stringify(item.expected.requiredMaterials)}, got ${JSON.stringify(extraction.requiredMaterials)}.`);
    assert(extraction.intent === item.expected.intent, `Expected ${item.name} intent ${item.expected.intent}, got ${extraction.intent}.`);
  }

  const previousAiProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'rule';
  const ragAssisted = await analyzeMessage({
    senderName: 'LumiNote',
    text: 'Subject: 合作邀請\n\n我們想邀請你合作拍一支生活感的筆記 App 宣傳影片，9/15 前上線，會需要 IG 限動轉發。',
  });
  process.env.AI_PROVIDER = previousAiProvider;
  assert(ragAssisted.extraction.projectItem === 'Reels 影片' || ragAssisted.extraction.projectItem === '品牌合作', `Expected RAG-assisted extraction to infer a similar project item, got ${ragAssisted.extraction.projectItem}.`);
  assert(ragAssisted.extraction.missingFields.includes('usage_rights'), 'Expected structured RAG metadata to add usage_rights as a missing field.');
  assert(ragAssisted.extraction.suggestedReply.includes('過去成功做法'), 'Expected structured RAG metadata to influence suggested reply.');

  const reanalysisImport = await importMessage({
    platform: 'Gmail',
    senderId: 'smoke-reanalysis@example.com',
    senderName: 'Smoke Reanalysis',
    text: 'Subject: 合作邀請\n\n我們想邀請你合作拍一支生活感的筆記 App 宣傳影片，9/15 前上線，會需要 IG 限動轉發。',
    rawPayload: {smokeReanalysis: true},
  });
  const reanalysis = await reanalyzeMessage(reanalysisImport.message.id);
  assert(reanalysis?.case?.projectItem === 'Reels 影片', `Expected reanalysis to update project item to Reels 影片, got ${reanalysis?.case?.projectItem}.`);
  await pool.query('UPDATE cases SET expected_deadline = $2, submission_deadline = $3, publish_deadline = $4 WHERE id = $1', [reanalysisImport.case.id, '12/01', '11/28', '12/01']);
  const protectedReanalysis = await reanalyzeMessage(reanalysisImport.message.id);
  assert(protectedReanalysis?.case?.expectedDeadline === '12/01', 'Expected reanalysis not to silently overwrite existing expectedDeadline.');
  assert(protectedReanalysis?.case?.submissionDeadline === '11/28', 'Expected reanalysis not to silently overwrite existing submissionDeadline.');
  assert(protectedReanalysis?.case?.publishDeadline === '12/01', 'Expected reanalysis not to silently overwrite existing publishDeadline.');
  await pool.query('DELETE FROM alerts WHERE case_id = $1', [reanalysisImport.case.id]);
  await pool.query('DELETE FROM ai_extractions WHERE message_id = $1', [reanalysisImport.message.id]);
  await pool.query('DELETE FROM messages WHERE id = $1', [reanalysisImport.message.id]);
  await pool.query('DELETE FROM cases WHERE id = $1', [reanalysisImport.case.id]);
  await pool.query('DELETE FROM customers WHERE contact_handle = $1 AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)', ['smoke-reanalysis@example.com']);

  await pool.query('DELETE FROM ai_extractions WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1)', ['smoke-missing@example.com']);
  const staleMissingCases = await pool.query('SELECT DISTINCT case_id FROM messages WHERE sender_id = $1 AND case_id IS NOT NULL', ['smoke-missing@example.com']);
  const staleMissingCaseIds = staleMissingCases.rows.map((row) => String(row.case_id));
  if (staleMissingCaseIds.length > 0) {
    await pool.query('DELETE FROM alerts WHERE case_id = ANY($1::text[])', [staleMissingCaseIds]);
  }
  await pool.query('DELETE FROM messages WHERE sender_id = $1', ['smoke-missing@example.com']);
  if (staleMissingCaseIds.length > 0) {
    await pool.query('DELETE FROM cases WHERE id = ANY($1::text[])', [staleMissingCaseIds]);
  }
  await pool.query("DELETE FROM customers WHERE contact_handle = 'smoke-missing@example.com' AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");
  const missingImport = await importMessage({
    platform: 'Gmail',
    senderId: 'smoke-missing@example.com',
    senderName: 'Smoke Missing Client',
    text: '確認可以合作 Logo 設計，預算 8,000 元，預計 9/30 前完成。合約和付款方式麻煩提供。',
    rawPayload: {smokeMissingLifecycle: true},
  });
  assert(missingImport.case.status === '已確認合作', `Expected confirmation message to create 已確認合作, got ${missingImport.case.status}.`);
  assert(missingImport.case.caseStage === 'confirmed', `Expected confirmed stage serialization, got ${missingImport.case.caseStage}.`);
  assert(missingImport.case.missingFields.includes('revision_scope'), 'Expected confirmed stage to require revision_scope.');
  const missingDetail = await findCaseDetailById(missingImport.case.id);
  const openMissingAlerts = missingDetail?.alerts.filter((alert) => alert.type === 'missing_fields' && !alert.resolvedAt) ?? [];
  assert(openMissingAlerts.length === missingImport.case.missingFields.length, 'Expected one open missing_fields alert per missing field.');
  assert(openMissingAlerts.every((alert) => typeof alert.metadata?.field === 'string'), 'Expected missing field alerts to store metadata.field.');
  await runRules(missingImport.case, missingImport.extraction);
  const afterDuplicateRuleDetail = await findCaseDetailById(missingImport.case.id);
  const duplicateCheckAlerts = afterDuplicateRuleDetail?.alerts.filter((alert) => alert.type === 'missing_fields' && !alert.resolvedAt) ?? [];
  assert(duplicateCheckAlerts.length === openMissingAlerts.length, 'Expected rerunning rules not to duplicate missing field alerts.');
  const humanReviewAlert = await createAlert({
    caseId: missingImport.case.id,
    type: 'needs_human_review',
    title: 'Smoke human review should stay open',
    message: 'Smoke missing lifecycle must not resolve non-missing alerts.',
    severity: 'warning',
  });
  const completedMissingCase = await updateCaseFields(missingImport.case.id, {status: '已完成'});
  assert(completedMissingCase?.missingFields.length === 0, 'Expected completed cases to have no regular missing fields.');
  const completedMissingDetail = await findCaseDetailById(missingImport.case.id);
  assert(completedMissingDetail?.alerts.filter((alert) => alert.type === 'missing_fields' && !alert.resolvedAt).length === 0, 'Expected completed status to resolve open missing field alerts.');
  assert(completedMissingDetail?.alerts.find((alert) => alert.id === humanReviewAlert.id)?.resolvedAt === null, 'Expected missing field lifecycle not to resolve human review alerts.');
  await pool.query('DELETE FROM alerts WHERE case_id = $1', [missingImport.case.id]);
  await pool.query('DELETE FROM ai_extractions WHERE message_id = $1', [missingImport.message.id]);
  await pool.query('DELETE FROM messages WHERE id = $1', [missingImport.message.id]);
  await pool.query('DELETE FROM cases WHERE id = $1', [missingImport.case.id]);
  await pool.query("DELETE FROM customers WHERE contact_handle = 'smoke-missing@example.com' AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");

  const threadId = 'smoke-thread-context-001';
  const staleThreadCases = await pool.query('SELECT DISTINCT case_id FROM messages WHERE thread_id = $1 AND case_id IS NOT NULL', [threadId]);
  const staleThreadCaseIds = staleThreadCases.rows.map((row) => String(row.case_id));
  await pool.query('DELETE FROM ai_review_history WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)', [threadId]);
  await pool.query('DELETE FROM ai_review_items WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)', [threadId]);
  if (staleThreadCaseIds.length > 0) {
    await pool.query('DELETE FROM alerts WHERE case_id = ANY($1::text[])', [staleThreadCaseIds]);
  }
  await pool.query('DELETE FROM ai_extractions WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)', [threadId]);
  await pool.query('DELETE FROM messages WHERE thread_id = $1', [threadId]);
  if (staleThreadCaseIds.length > 0) {
    await pool.query('DELETE FROM cases WHERE id = ANY($1::text[])', [staleThreadCaseIds]);
  }
  await pool.query("DELETE FROM customers WHERE contact_handle IN ('smoke-thread@example.com') AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");

  const firstThreadImport = await importMessage({
    platform: 'Gmail',
    senderId: 'smoke-thread@example.com',
    senderName: '遠嶼科技',
    threadId,
    text: '網站重新設計確認可以合作，報價 98,000 元，預計 11/30 上線。',
    rawPayload: {smokeThread: true, gmailMessageId: 'smoke-thread-1', threadId},
  });
  const secondThreadImport = await importMessage({
    platform: 'Gmail',
    senderId: 'smoke-thread@example.com',
    senderName: '遠嶼科技',
    threadId,
    text: '內部希望提前到 11/15 上線，其他範圍不變。',
    rawPayload: {smokeThread: true, gmailMessageId: 'smoke-thread-2', threadId},
  });
  assert(secondThreadImport.case.id === firstThreadImport.case.id, 'Expected same Gmail thread to reuse existing case instead of creating a duplicate.');
  assert(secondThreadImport.threadContext.existingCaseId === firstThreadImport.case.id, 'Expected thread context to report existing case id.');
  assert(secondThreadImport.threadContext.needsHumanReview, 'Expected conflicting thread update to require human review.');
  assert(secondThreadImport.threadContext.conflictingFields.some((field) => field.field === 'expectedDeadline'), 'Expected deadline conflict to be reported.');
  assert(secondThreadImport.alerts.some((alert) => alert.type === 'needs_human_review'), 'Expected human review alert for thread conflict.');
  const beforeReviewCase = await findCaseDetailById(firstThreadImport.case.id);
  assert(beforeReviewCase?.case.expectedDeadline === '11/30', `Expected thread conflict not to overwrite case deadline before review, got ${beforeReviewCase?.case.expectedDeadline}.`);
  const pendingReviews = await findReviewItemsByMessageId(secondThreadImport.message.id);
  const deadlineReview = pendingReviews.find((item) => item.field === 'expectedDeadline');
  assert(deadlineReview, 'Expected pending review item for deadline conflict.');
  const resolvedReview = await resolveReviewItem(deadlineReview.id, 'apply');
  assert(resolvedReview?.item.status === 'applied', 'Expected review item to be marked applied.');
  for (const item of pendingReviews.filter((review) => review.id !== deadlineReview.id)) {
    await resolveReviewItem(item.id, 'apply');
  }
  const afterReviewCase = await findCaseDetailById(firstThreadImport.case.id);
  assert(afterReviewCase?.case.expectedDeadline === '11/15', `Expected applying review to update case deadline, got ${afterReviewCase?.case.expectedDeadline}.`);
  const reviewHistory = await findReviewHistoryByMessageId(secondThreadImport.message.id);
  assert(reviewHistory.some((item) => item.reviewItemId === deadlineReview.id && item.action === 'apply'), 'Expected review history to record applied action.');
  const resolvedHumanReviewAlert = afterReviewCase.alerts.find((alert) => alert.type === 'needs_human_review');
  assert(resolvedHumanReviewAlert?.resolvedAt, 'Expected human-review alert to be resolved after all review items are handled.');
  await pool.query('DELETE FROM ai_review_history WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)', [threadId]);
  await pool.query('DELETE FROM ai_review_items WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)', [threadId]);
  await pool.query('DELETE FROM alerts WHERE case_id = $1', [firstThreadImport.case.id]);
  await pool.query('DELETE FROM ai_extractions WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)', [threadId]);
  await pool.query('DELETE FROM messages WHERE thread_id = $1', [threadId]);
  await pool.query('DELETE FROM cases WHERE id = $1', [firstThreadImport.case.id]);
  await pool.query("DELETE FROM customers WHERE contact_handle IN ('smoke-thread@example.com') AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");

  const customers = await findCustomerSummaries();
  assert(customers.length > 0, 'Expected at least one customer. Run npm run db:seed first.');
  const customerWithCases = customers.find((customer) => customer.caseCount > 0) ?? customers[0];
  const customerDetail = await findCustomerDetailById(customerWithCases.id);
  assert(customerDetail, 'Expected customer detail to load.');

  const freshCases = await findAllCases();
  const firstCase = freshCases[0];
  const detail = await findCaseDetailById(firstCase.id);
  assert(detail, 'Expected case detail to load.');
  assert(Array.isArray(detail.messages), 'Expected case detail messages array.');
  assert(Array.isArray(detail.similarCases), 'Expected case detail similarCases array.');

  const updated = await updateCaseFields(firstCase.id, {
    status: '進行中',
    quoteAmount: 12345,
    expectedDeadline: '2026-09-15',
    summary: 'Smoke test update',
  });
  assert(updated?.quoteAmount === 12345, 'Expected case quote amount update to work.');

  await updateCaseFields(firstCase.id, {
    status: firstCase.status,
    quoteAmount: firstCase.quoteAmount,
    expectedDeadline: firstCase.expectedDeadline,
    summary: firstCase.summary,
  });

  const smokeAlert = await createAlert({
    caseId: firstCase.id,
    type: 'needs_clarification',
    title: 'Smoke test alert',
    message: 'Smoke test alert can be resolved',
    severity: 'warning',
  });
  const resolvedAlert = await resolveAlert(smokeAlert.id);
  assert(resolvedAlert?.resolvedAt, 'Expected alert resolve to set resolvedAt.');
  await pool.query('DELETE FROM alerts WHERE id = $1 OR title = $2', [smokeAlert.id, 'Smoke test alert']);

  const gmailStatus = await getGmailStatus();
  assert(typeof gmailStatus.configured === 'boolean', 'Expected Gmail configured status.');

  const ragExamples = await findAllRagExamples();
  assert(ragExamples.length > 0, 'Expected RAG examples to load.');
  const createdRagExample = await createRagExample({
    title: 'Smoke test RAG example',
    platform: 'Manual',
    projectItem: 'Smoke test',
    quoteAmount: null,
    outcome: '測試',
    summary: 'Smoke test RAG example can be created.',
    replyExample: 'Smoke test reply example.',
    caseType: 'quote_inquiry',
    projectAliases: ['smoke alias'],
    typicalMissingFields: ['quote_amount'],
    quoteRangeMin: null,
    quoteRangeMax: null,
    successPattern: 'Smoke success pattern.',
  });
  assert(createdRagExample.caseType === 'quote_inquiry', 'Expected RAG case type to be persisted.');
  assert(createdRagExample.projectAliases.includes('smoke alias'), 'Expected RAG aliases to be persisted.');
  const deactivatedRagExample = await deactivateRagExample(createdRagExample.id);
  assert(deactivatedRagExample?.isActive === false, 'Expected RAG example deactivation to work.');
  await pool.query('DELETE FROM rag_examples WHERE id = $1 OR title = $2', [createdRagExample.id, 'Smoke test RAG example']);

  const business = await enrichBusinessRisk({customerName: '晴天行銷', taxId: '24500001'});
  assert(business.riskScore.score >= 0, 'Expected business risk score.');

  process.env.REPLY_OVERDUE_HOURS = '999999';
  const ruleStatus = getRuleScheduleStatus();
  assert(ruleStatus.mode === 'manual', 'Expected rules to report manual mode.');
  const rules = await runReplyOverdueRules();
  assert(typeof rules.checkedCount === 'number', 'Expected rules checkedCount.');

  console.log(JSON.stringify({
    ok: true,
    cases: cases.length,
    customers: customers.length,
    customerDetailCases: customerDetail.cases.length,
    messages: messages.length,
    inferredCustomerName,
    extractionRegressionCases: extractionCases.length,
    ragAssistedProjectItem: ragAssisted.extraction.projectItem,
    ragAssistedMissingFields: ragAssisted.extraction.missingFields,
    reanalysisProjectItem: reanalysis.case.projectItem,
    threadCaseReused: secondThreadImport.case.id === firstThreadImport.case.id,
    threadHumanReview: secondThreadImport.threadContext.needsHumanReview,
    reviewApplied: resolvedReview?.item.status === 'applied',
    reviewHistory: reviewHistory.length,
    defaultReplyStatus: replyImport.message.replyStatus,
    userReplyStatusPreservedAfterReanalysis: reanalyzedReplyMessage?.message.replyStatus,
    replyStatusHistoryRecords: replyHistoryCountBeforeDelete,
    learnedExclusionRule: Boolean(learnedExclusionRule),
    ragExamples: ragExamples.length,
    ragDeactivate: deactivatedRagExample.isActive === false,
    gmailConfigured: gmailStatus.configured,
    businessRiskScore: business.riskScore.score,
    resolvedAlert: Boolean(resolvedAlert.resolvedAt),
    ruleMode: ruleStatus.mode,
    rulesChecked: rules.checkedCount,
    caseStageSerialization: cases[0].caseStage,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 0);
  });
