import {useEffect, useRef, useState} from 'react';
import {missingFieldDisplayLabels} from '@casebee/shared';
import type {AiReviewDetail, AiReviewItem, BusinessProfile, BusinessRiskScore, CaseDetail, MessageEvent, MessageReplyStatusHistoryItem, Platform, RegistrySearchResult, ReplyStatus} from '@casebee/shared';
import {enrichBusinessRisk, excludeMessage, getCaseDetail, getGmailAuthUrl, getGmailStatus, getMessageReplyStatusHistory, getMessageReview, getMessages, importMessage, pollGmail, reanalyzeMessage, resolveReview,screenRegistry,  updateMessageReplyStatus, type ImportPipelineResult} from '../services/api';
import type {NavigateToPage} from '../App';

const fieldLabels: Record<string, string> = {
  ...missingFieldDisplayLabels,
  clientName: '客戶名稱',
  customerName: '客戶名稱',
  projectItem: '專案項目',
  quoteAmount: '預算 / 報價金額',
  expectedDeadline: '預期到期時間',
  intent: '需求目的',
  contactMethod: '聯絡方式',
  contact_method: '聯絡方式',
  reference: '參考資料',
  inheritedFields: '沿用欄位',
  changedFields: '變更欄位',
  conflictingFields: '衝突欄位',
  platform: '聯絡平台',
};

function formatField(field: string) {
  return fieldLabels[field] ?? field;
}

function formatBackendText(text: string) {
  return Object.entries(fieldLabels).reduce((current, [field, label]) => current.replaceAll(field, label), text);
}

function formatReviewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '未填寫';
  if (typeof value === 'number') return `NT$ ${value.toLocaleString('zh-TW')}`;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join('、') : '無';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildMessageNextStep(input: {hasCase: boolean; missingFields: string[]; hasSuggestedReply: boolean; riskLevel?: string}) {
  if (!input.hasCase) {
    return {title: '先建立案件', detail: '這封訊息尚未進入案件流程，先確認是否為案件需求；若不是，直接排除。'};
  }
  if (input.missingFields.length > 0) {
    return {title: '先補齊缺漏資料', detail: `回覆客戶確認 ${input.missingFields.map(formatField).join('、')}，再進入報價或排程。`};
  }
  if (input.riskLevel === 'warning' || input.riskLevel === 'danger') {
    return {title: '先處理風險提醒', detail: '此案件已有提醒或風險標記，先確認期限、範圍或商工驗證結果。'};
  }
  return {title: input.hasSuggestedReply ? '可回覆並推進案件' : '前往案件看板推進', detail: input.hasSuggestedReply ? '右欄已有回覆草稿，可編輯複製後回信，接著到 Kanban 更新狀態。' : '此案件資料大致完整，可到 Kanban 更新報價、狀態或下一步。'};
}

function splitMailSubject(text: string) {
  const normalized = text.replace(/^Subject:\s*/i, 'Subject: ');
  if (!normalized.startsWith('Subject: ')) {
    return {subject: '', body: text};
  }

  const separatorIndex = normalized.indexOf('\n\n');
  if (separatorIndex === -1) {
    return {subject: normalized.slice('Subject: '.length).trim(), body: ''};
  }

  return {
    subject: normalized.slice('Subject: '.length, separatorIndex).trim(),
    body: normalized.slice(separatorIndex).trimStart(),
  };
}

const platformFilters: Array<Platform | 'All'> = ['All', 'LINE', 'Gmail', 'Manual'];
const replyStatusFilters: Array<ReplyStatus | 'All'> = ['All', 'pending_reply', 'replied', 'no_reply_needed'];
const replyStatusLabels: Record<ReplyStatus | 'All', string> = {
  All: '全部回覆狀態',
  pending_reply: '待回覆',
  replied: '已回覆',
  no_reply_needed: '不需回覆',
};

const registryStatusLabels: Record<RegistrySearchResult['status'], string> = {
  found: '查得',
  not_found: '未查得',
  multiple: '多筆候選',
};

const gmailFilterRules = [
  '匯入：看起來像客戶詢價、合作、修改、交期或專案討論的信件',
  '略過：驗證碼、安全通知、Google 日曆邀請、noreply 系統通知',
  '略過：電子報、EDM、取消訂閱郵件、活動公告、競賽徵件通知',
  '略過：已匯入過的 Gmail message id，避免重複建案',
];

const exclusionReasons = [
  '不是客戶或案件相關郵件',
  '電子報 / 行銷郵件',
  '活動公告 / 競賽通知',
  '系統通知 / 驗證碼',
  '行事曆 / 會議邀請',
];

interface MessagesPageProps {
  onNavigate: NavigateToPage;
  targetMessageId?: string;
}

export function MessagesPage({onNavigate, targetMessageId}: MessagesPageProps) {
  const [messages, setMessages] = useState<MessageEvent[]>([]);
  const [platform, setPlatform] = useState<Platform>('Manual');
  const [senderName, setSenderName] = useState('測試客戶');
  const [text, setText] = useState('你好，想詢問 Logo + 名片設計費用，預算 8000，月底前完成');
  const [importStatus, setImportStatus] = useState('');
  const [lastResult, setLastResult] = useState<ImportPipelineResult | null>(null);
  const [selectedCaseDetail, setSelectedCaseDetail] = useState<CaseDetail | null>(null);
  const [businessRisk, setBusinessRisk] = useState<{profile: BusinessProfile | null; riskScore: BusinessRiskScore; provider: string} | null>(null);
  const [businessRiskStatus, setBusinessRiskStatus] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<Platform | 'All'>('All');
  const [draftReply, setDraftReply] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [gmailAssistantStatus, setGmailAssistantStatus] = useState('Gmail 尚未同步。');
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [isSyncingGmail, setIsSyncingGmail] = useState(false);
  const [excludeReason, setExcludeReason] = useState(exclusionReasons[0]);
  const [excludeStatus, setExcludeStatus] = useState('');
  const [reanalyzeStatus, setReanalyzeStatus] = useState('');
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [replyStatusFilter, setReplyStatusFilter] = useState<ReplyStatus | 'All'>('All');
  const [replyStatusUpdateStatus, setReplyStatusUpdateStatus] = useState('');
  const [replyStatusHistory, setReplyStatusHistory] = useState<MessageReplyStatusHistoryItem[]>([]);
  const [reviewDetail, setReviewDetail] = useState<AiReviewDetail | null>(null);
  const [reviewStatus, setReviewStatus] = useState('');
  const [manualReviewValues, setManualReviewValues] = useState<Record<string, string>>({});
  const [registryTaxId, setRegistryTaxId] = useState('');
  const [registryKeyword, setRegistryKeyword] = useState('');
  const [registryResult, setRegistryResult] = useState<RegistrySearchResult | null>(null);
  const [registryStatus, setRegistryStatus] = useState('');
  const [isScreening, setIsScreening] = useState(false);
  const registryRequestId = useRef(0);

  useEffect(() => {
    getMessages().then(setMessages).catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      getMessages().then(setMessages).catch(() => undefined);
    }, 30_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    getGmailStatus()
      .then((status) => {
        setGmailConfigured(status.configured);
        setGmailConnected(status.connected);
        const autoPollText = status.autoPollEnabled ? `，自動同步每 ${status.autoPollIntervalSeconds} 秒` : '，自動同步關閉';
        setGmailAssistantStatus(status.connected ? `Gmail 已連接：${status.accountEmail ?? 'unknown'}${status.lastSyncedAt ? `，上次同步 ${new Date(status.lastSyncedAt).toLocaleString('zh-TW')}` : ''}${autoPollText}` : 'Gmail 尚未連接，請到 Settings 完成授權。');
      })
      .catch(() => setGmailAssistantStatus('無法讀取 Gmail 狀態。'));
  }, []);

  useEffect(() => {
    if (targetMessageId && messages.some((message) => message.id === targetMessageId)) {
      setSelectedMessageId(targetMessageId);
      return;
    }

    if (!selectedMessageId && messages[0]) {
      setSelectedMessageId(messages[0].id);
    }
  }, [messages, selectedMessageId, targetMessageId]);

  useEffect(() => {
    if (lastResult) {
      setDraftReply(lastResult.extraction.suggestedReply);
      return;
    }

    setDraftReply(selectedCaseDetail?.aiExtractions[0]?.suggestedReply ?? '');
  }, [lastResult, selectedCaseDetail]);

  const filteredMessages = messages.filter((message) => (activeFilter === 'All' || message.platform === activeFilter) && (!reviewOnly || message.reviewStatus === 'pending') && (replyStatusFilter === 'All' || message.replyStatus === replyStatusFilter));
  const selectedMessage = filteredMessages.find((message) => message.id === selectedMessageId) ?? filteredMessages[0] ?? messages[0];
  const gmailMessages = messages.filter((message) => message.platform === 'Gmail');
  const selectedMessageIsGmail = selectedMessage?.platform === 'Gmail';
  const selectedMailContent = selectedMessage ? splitMailSubject(selectedMessage.text) : {subject: '', body: ''};
  const visibleExtraction = lastResult?.extraction ?? selectedCaseDetail?.aiExtractions[0] ?? null;
  const visibleCase = lastResult?.case ?? selectedCaseDetail?.case ?? null;
  const visibleAlerts = lastResult?.alerts ?? selectedCaseDetail?.alerts ?? [];
  const visibleSimilarCases = lastResult?.similarCases ?? [];
  const messageNextStep = buildMessageNextStep({
    hasCase: Boolean(visibleCase),
    missingFields: visibleExtraction?.missingFields ?? [],
    hasSuggestedReply: Boolean(visibleExtraction?.suggestedReply),
    riskLevel: visibleCase?.riskLevel,
  });

  const selectedTaxId = selectedMessage?.text.match(/\b\d{8}\b/)?.[0];

  const [isRefreshing, setIsRefreshing] = useState(false);

const refreshAll = async () => {
  setIsRefreshing(true);
  try {
    const latest = await getMessages();
    setMessages(latest);
    setLastResult(null);
    const current = latest.find((message) => message.id === selectedMessage?.id) ?? selectedMessage ?? latest[0];
    if (current?.caseId) {
      setSelectedCaseDetail(await getCaseDetail(current.caseId));
    }
    if (current) {
      const [detail, history] = await Promise.all([getMessageReview(current.id), getMessageReplyStatusHistory(current.id)]);
      setReviewDetail(detail);
      setReplyStatusHistory(history);
    }
  } catch {
    // 失敗時保留目前畫面
  } finally {
    setIsRefreshing(false);
  }
};

  useEffect(() => {
    if (!selectedMessage?.caseId) {
      setSelectedCaseDetail(null);
      return;
    }

    let isCurrent = true;
    setSelectedCaseDetail(null);
    setDraftReply('');
    getCaseDetail(selectedMessage.caseId)
      .then((detail) => {
        if (isCurrent) {
          setSelectedCaseDetail(detail);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setSelectedCaseDetail(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedMessage?.caseId]);

  useEffect(() => {
    if (!selectedMessage) {
      setReviewDetail(null);
      setReplyStatusHistory([]);
      return;
    }

    let isCurrent = true;
    Promise.all([getMessageReview(selectedMessage.id), getMessageReplyStatusHistory(selectedMessage.id)])
      .then(([detail, history]) => {
        if (isCurrent) {
          setReviewDetail(detail);
          setReplyStatusHistory(history);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setReviewDetail(null);
          setReplyStatusHistory([]);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [selectedMessage?.id]);

  useEffect(() => {
    const customerName = visibleExtraction?.clientName ?? selectedMessage?.senderName;
    if (!customerName) {
      setBusinessRisk(null);
      setBusinessRiskStatus('');
      return;
    }

    let isCurrent = true;
    setBusinessRisk(null);
    setBusinessRiskStatus('商工風險自動查詢中...');
    enrichBusinessRisk({customerName, taxId: selectedTaxId})
      .then((result) => {
        if (isCurrent) {
          setBusinessRisk(result);
          setBusinessRiskStatus(`已自動查詢商工風險，來源：${result.provider}`);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setBusinessRiskStatus(error instanceof Error ? error.message : '商工風險查詢失敗');
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedMessage?.id, selectedTaxId, visibleExtraction?.clientName, selectedMessage?.senderName]);

  useEffect(() => {
    registryRequestId.current += 1;
    setIsScreening(false);
    setRegistryResult(null);
    setRegistryStatus('');
    setRegistryTaxId(selectedTaxId ?? '');
    setRegistryKeyword(visibleExtraction?.clientName ?? selectedMessage?.senderName ?? '');
  }, [selectedMessage?.id, selectedTaxId, visibleExtraction?.clientName, selectedMessage?.senderName]);


  const handleGmailSync = async () => {
    setIsSyncingGmail(true);
    setGmailAssistantStatus('正在同步 Gmail 並套用分類篩選...');

    try {
      const result = await pollGmail();
      const skippedSummary = result.skipped.reduce<Record<string, number>>((summary, item) => {
        summary[item.category] = (summary[item.category] ?? 0) + 1;
        return summary;
      }, {});
      const skippedText = Object.entries(skippedSummary).map(([category, count]) => `${category} ${count}`).join('、') || '無';
      setGmailAssistantStatus(`Gmail 同步完成：掃描 ${result.checkedCount}，匯入 ${result.importedCount}，略過 ${result.skippedCount}（${skippedText}），失敗 ${result.failedCount}`);
      setMessages(await getMessages());
      setActiveFilter('Gmail');
    } catch (error) {
      setGmailAssistantStatus(error instanceof Error ? error.message : 'Gmail 同步失敗。');
    } finally {
      setIsSyncingGmail(false);
    }
  };

  const handleGmailConnect = async () => {
    try {
      const {url} = await getGmailAuthUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
      setGmailAssistantStatus('已開啟 Gmail 授權頁，完成後回到 Casebee 即可同步。');
    } catch (error) {
      setGmailAssistantStatus(error instanceof Error ? error.message : '無法開啟 Gmail 授權頁。');
    }
  };

  const handleImport = async () => {
    if (!senderName.trim() || !text.trim()) {
      setImportStatus('請填寫客戶名稱與訊息內容');
      return;
    }

    try {
      const result = await importMessage({platform, senderName, text});
      setImportStatus(`已建立案件：${result.case.title}，提醒 ${result.alerts.length} 則`);
      setLastResult(result);
      setBusinessRisk(null);
      setMessages(await getMessages());
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : '匯入失敗');
    }
  };

  const handleExcludeSelectedMessage = async () => {
    if (!selectedMessage) {
      return;
    }

    try {
      setExcludeStatus('排除郵件中...');
      const result = await excludeMessage(selectedMessage.id, excludeReason);
      setMessages((current) => current.filter((message) => message.id !== selectedMessage.id));
      setSelectedMessageId(null);
      const nextMessages = await getMessages();
      setMessages(nextMessages);
      setLastResult((current) => (current?.message.id === result.message.id ? null : current));
      const learnedRuleText = result.learnedRule ? '未來同寄件者會自動略過。' : '';
      setExcludeStatus(`${result.excludedCaseId ? '已排除郵件，並隱藏其自動建立的案件。' : '已排除郵件。'}${learnedRuleText}`);
    } catch (error) {
      setExcludeStatus(error instanceof Error ? error.message : '排除郵件失敗。');
    }
  };

  const handleReanalyzeSelectedMessage = async () => {
    if (!selectedMessage) {
      return;
    }

    setIsReanalyzing(true);
    setReanalyzeStatus('正在用新版擷取流程重新分析...');
    try {
      const result = await reanalyzeMessage(selectedMessage.id);
      setLastResult(result.case ? {...result, alerts: result.caseDetail?.alerts ?? result.alerts} : null);
      setSelectedCaseDetail(result.caseDetail);
      setMessages(await getMessages());
      setReanalyzeStatus(`重新分析完成：${result.extraction.projectItem ?? '未擷取專案'}，模型 ${result.modelName}`);
    } catch (error) {
      setReanalyzeStatus(error instanceof Error ? error.message : '重新分析失敗。');
    } finally {
      setIsReanalyzing(false);
    }
  };

  const refreshSelectedReview = async () => {
    if (!selectedMessage) return;
    const [nextMessages, nextReview] = await Promise.all([getMessages(), getMessageReview(selectedMessage.id)]);
    setMessages(nextMessages);
    setReviewDetail(nextReview);
        if (selectedMessage.caseId) {
      const nextDetail = await getCaseDetail(selectedMessage.caseId);
      setSelectedCaseDetail(nextDetail);
      setLastResult((current) => (current ? {...current, case: nextDetail.case, alerts: nextDetail.alerts} : current));
    }
  };

  const handleResolveReview = async (item: AiReviewItem, action: 'apply' | 'keep' | 'edit') => {
    setReviewStatus('更新人工確認結果中...');
    try {
      const rawValue = manualReviewValues[item.id];
      const value = action === 'edit' ? (item.field === 'quoteAmount' ? Number(rawValue) : rawValue) : undefined;
      await resolveReview(item.id, {action, value});
      await refreshSelectedReview();
      setReviewStatus(action === 'apply' ? '已採用新值並更新案件。' : action === 'keep' ? '已保留舊值。' : '已套用手動修改值。');
    } catch (error) {
      setReviewStatus(error instanceof Error ? error.message : '人工確認更新失敗。');
    }
  };

  const handleReplyStatusUpdate = async (replyStatus: ReplyStatus) => {
    if (!selectedMessage) return;
    setReplyStatusUpdateStatus('更新回覆狀態中...');
    try {
      const updated = await updateMessageReplyStatus(selectedMessage.id, replyStatus);
      setMessages((current) => current.map((message) => (message.id === updated.id ? updated : message)));
      setReplyStatusHistory(await getMessageReplyStatusHistory(selectedMessage.id));
      setReplyStatusUpdateStatus(`已標記為${replyStatusLabels[replyStatus]}。`);
    } catch (error) {
      setReplyStatusUpdateStatus(error instanceof Error ? error.message : '回覆狀態更新失敗。');
    }
  };

    const handleScreenRegistry = async () => {
    const keyword = registryKeyword.trim();
    const taxId = registryTaxId.trim();

    if (!keyword && !taxId) {
      setRegistryStatus('請輸入統一編號或公司名稱關鍵字。');
      return;
    }
    if (!keyword && !/^\d{8}$/.test(taxId)) {
      setRegistryStatus('統一編號需為 8 碼數字。');
      return;
    }

    const requestId = ++registryRequestId.current;
    setIsScreening(true);
    setRegistryResult(null);
    setRegistryStatus('查詢中...');

    try {
      const result = await screenRegistry({taxId: taxId || undefined, keyword: keyword || undefined});
      if (requestId !== registryRequestId.current) return;
      setRegistryResult(result);
      setRegistryStatus('');
    } catch (error) {
      if (requestId !== registryRequestId.current) return;
      setRegistryStatus(error instanceof Error ? error.message : '登記查詢失敗');
    } finally {
      if (requestId === registryRequestId.current) {
        setIsScreening(false);
      }
    }
  };

  return (
    <div className="page-stack messages-workspace">
      <header className="page-header">
        <div>
          <h1>訊息整合</h1>
          <p>把跨平台訊息集中成可判讀、可建案、可回覆的工作台。</p>
        </div>
        <span className="status-pill">Gmail ready</span>
      </header>

      <section className="gmail-assistant-panel" aria-label="Gmail 輔助操作">
        <div className="gmail-assistant-panel__main">
          <span>Gmail Triage</span>
          <div>
            <h2>先篩選，再建案</h2>
            <p>{gmailAssistantStatus}</p>
          </div>
        </div>
        <div className="gmail-assistant-panel__metrics">
          <div><strong>{gmailMessages.length}</strong><span>Gmail 訊息</span></div>
          <div><strong>{messages.filter((message) => message.platform === 'Gmail' && message.caseId).length}</strong><span>已建案</span></div>
        </div>
        <div className="gmail-assistant-panel__actions">
          {!gmailConnected ? <button type="button" onClick={handleGmailConnect} disabled={!gmailConfigured}>連接 Gmail</button> : null}
          <button type="button" onClick={handleGmailSync} disabled={isSyncingGmail || !gmailConnected}>{isSyncingGmail ? '同步中...' : '同步並分類 Gmail'}</button>
          <button type="button" className="gmail-assistant-panel__secondary" onClick={() => setActiveFilter('Gmail')}>只看 Gmail</button>
          <button type="button" className="gmail-assistant-panel__secondary" onClick={() => onNavigate('settings')}>查看同步設定</button>
        </div>
        <details className="gmail-filter-rules">
          <summary>目前篩選標準</summary>
          <ul>
            {gmailFilterRules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </details>
      </section>

      <section className="messages-layout messages-layout--integrated">
        <aside className="page-card message-list messages-inbox-panel">
          <div className="messages-panel-heading">
            <div>
              <h2>訊息串流</h2>
              <p>{filteredMessages.length} 則訊息</p>
            </div>
            <span>即時</span>
            <button type="button" className="messages-filter-tabs__button" onClick={refreshAll} disabled={isRefreshing}>
    {isRefreshing ? '更新中...' : '重新整理'}
  </button>
          </div>

          <div className="messages-filter-tabs" role="tablist" aria-label="訊息平台篩選">
            {platformFilters.map((filter) => (
              <button key={filter} type="button" className={activeFilter === filter ? 'messages-filter-tabs__button messages-filter-tabs__button--active' : 'messages-filter-tabs__button'} onClick={() => setActiveFilter(filter)}>
                {filter === 'All' ? '全部' : filter}
              </button>
            ))}
          </div>
          <button type="button" className={reviewOnly ? 'messages-filter-tabs__button messages-filter-tabs__button--active' : 'messages-filter-tabs__button'} onClick={() => setReviewOnly((current) => !current)}>
            待人工確認 {messages.filter((message) => message.reviewStatus === 'pending').length}
          </button>
          <select value={replyStatusFilter} onChange={(event) => setReplyStatusFilter(event.target.value as ReplyStatus | 'All')}>
            {replyStatusFilters.map((status) => <option key={status} value={status}>{replyStatusLabels[status]}</option>)}
          </select>

          <details className="message-action-box">
            <summary>手動匯入</summary>
            <label>
              平台
              <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
                <option value="Manual">Manual</option>
                <option value="LINE">LINE</option>
                <option value="Gmail">Gmail</option>
              </select>
            </label>
            <label>
              客戶名稱
              <input value={senderName} onChange={(event) => setSenderName(event.target.value)} />
            </label>
            <label>
              訊息內容
              <textarea value={text} onChange={(event) => setText(event.target.value)} />
            </label>
            <button type="button" onClick={handleImport}>匯入並自動建案</button>
            {importStatus ? <p className="import-form__status">{importStatus}</p> : null}
          </details>

            {filteredMessages.map((message) => (
            <button key={message.id} type="button" className={selectedMessage?.id === message.id ? 'message-thread-card message-thread-card--active' : 'message-thread-card'} onClick={() => { setSelectedMessageId(message.id); setLastResult(null); setBusinessRisk(null); setExcludeStatus(''); }}>
              <div className="message-thread-card__top">
                <span>{message.platform}</span>
                <small>{new Date(message.timestamp).toLocaleString('zh-TW', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}</small>
              </div>
              <strong>{message.senderName}</strong>
              <p>{splitMailSubject(message.text).subject || message.text}</p>
              <small>{message.caseId ? '已連結案件' : '尚未建案'}</small>
              <small>{replyStatusLabels[message.replyStatus]}</small>
              {message.reviewStatus === 'pending' ? <small>需人工確認</small> : null}
            </button>
          ))}
          {filteredMessages.length === 0 ? (
            <section className="empty-state empty-state--compact">
              <strong>沒有符合條件的訊息</strong>
              <p>請切換平台篩選、等待 Gmail 自動同步，或使用手動匯入建立測試訊息。</p>
            </section>
          ) : null}
        </aside>

        <section className="message-analysis-stack">
          <article className="page-card message-analysis">
            <div className="messages-panel-heading">
              <div>
                <h2>AI 判讀與下一步</h2>
                <p>{lastResult ? `剛匯入完成｜模型 ${lastResult.modelName}` : visibleExtraction ? '已讀取此案件的 AI 判讀結果' : '此訊息尚未產生 AI 判讀'}</p>
              </div>
            </div>
          {visibleExtraction ? (
            <>
              {visibleCase ? (
                <section className="analysis-case-summary">
                  <span className={`risk-badge risk-badge--${visibleCase.riskLevel}`}>{visibleCase.riskLevel}</span>
                  <div>
                    <strong>{visibleCase.title}</strong>
                    <p>{visibleCase.code}｜{visibleCase.status}</p>
                  </div>
                </section>
              ) : null}
              <div className="entity-grid">
                <span>客戶名稱</span><strong>{visibleExtraction.clientName ?? '未擷取'}</strong>
                <span>專案項目</span><strong>{visibleCase?.projectItem ?? visibleExtraction.projectItem ?? '未擷取'}</strong>
                <span>預算 / 報價金額</span><strong>{(visibleCase?.quoteAmount ?? visibleExtraction.quoteAmount) ? `$${(visibleCase?.quoteAmount ?? visibleExtraction.quoteAmount)!.toLocaleString()}` : '未擷取'}</strong>
                <span>預期到期時間</span><strong>{visibleCase?.expectedDeadline ?? visibleExtraction.expectedDeadline ?? '未擷取'}</strong>
                <span>需求目的</span><strong>{visibleExtraction.intent}</strong>
                <span>案件狀態</span><strong>{visibleCase?.status ?? visibleExtraction.caseStatus}</strong>
                <span>缺少資料</span><strong>{visibleExtraction.missingFields.length > 0 ? visibleExtraction.missingFields.map(formatField).join('、') : '無'}</strong>
              </div>
              <span className="analysis-label">案件摘要</span>
              <p className="analysis-text">{visibleExtraction.summary}</p>
              {reviewDetail && reviewDetail.items.length > 0 ? (
                <section className="review-workflow-card">
                  <div className="messages-panel-heading">
                    <div>
                      <h3>AI 人工確認</h3>
                      <p>確認前不會覆寫案件關鍵欄位。請比較既有值與 AI 建議值後決定。</p>
                    </div>
                    <span>{reviewDetail.items.filter((item) => item.status === 'pending').length} 待處理</span>
                  </div>
                  {reviewDetail.items.map((item) => (
                    <article key={item.id} className={item.status === 'pending' ? 'review-field-row' : 'review-field-row review-field-row--resolved'}>
                      <div>
                        <strong>{formatField(item.field)}</strong>
                        <small>{item.isConflict ? '衝突' : '變更'}・來源 {item.source}・{item.status}</small>
                      </div>
                      <div><span>既有值</span><p>{formatReviewValue(item.existingValue)}</p></div>
                      <div><span>建議值</span><p>{formatReviewValue(item.suggestedValue)}</p></div>
                      {item.status === 'pending' ? (
                        <div className="review-field-actions">
                          <button type="button" onClick={() => void handleResolveReview(item, 'apply')}>採用新值</button>
                          <button type="button" onClick={() => void handleResolveReview(item, 'keep')}>保留舊值</button>
                          <input value={manualReviewValues[item.id] ?? ''} onChange={(event) => setManualReviewValues((current) => ({...current, [item.id]: event.target.value}))} placeholder="手動修改值" />
                          <button type="button" onClick={() => void handleResolveReview(item, 'edit')} disabled={!manualReviewValues[item.id]?.trim()}>套用修改</button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {reviewDetail.history.length > 0 ? <small>已建立 {reviewDetail.history.length} 筆 review history。</small> : null}
                  {reviewStatus ? <p>{reviewStatus}</p> : null}
                </section>
              ) : null}
              <section className="next-step-card">
                <span>下一步</span>
                <strong>{messageNextStep.title}</strong>
                <p>{messageNextStep.detail}</p>
                <button type="button" onClick={handleReanalyzeSelectedMessage} disabled={isReanalyzing}>{isReanalyzing ? '重新分析中...' : '用新版 AI 流程重新分析'}</button>
                {reanalyzeStatus ? <small>{reanalyzeStatus}</small> : null}
              </section>
              {selectedMessage ? (
                <section className="reply-status-card">
                  <span>回覆狀態</span>
                  <strong>{replyStatusLabels[selectedMessage.replyStatus]}</strong>
                  <p>來源：{selectedMessage.replyStatusSource === 'user' ? '人工設定' : '系統預設'}｜更新時間：{new Date(selectedMessage.replyStatusUpdatedAt).toLocaleString('zh-TW')}</p>
                  <div className="reply-status-actions">
                    <button type="button" onClick={() => void handleReplyStatusUpdate('replied')}>標記為已回覆</button>
                    <button type="button" onClick={() => void handleReplyStatusUpdate('pending_reply')}>標記為待回覆</button>
                    <button type="button" onClick={() => void handleReplyStatusUpdate('no_reply_needed')}>標記為不需回覆</button>
                  </div>
                  {replyStatusUpdateStatus ? <small>{replyStatusUpdateStatus}</small> : null}
                  {replyStatusHistory.length > 0 ? (
                    <div className="reply-status-history">
                      <strong>狀態紀錄</strong>
                      {replyStatusHistory.slice(0, 4).map((item) => (
                        <small key={item.id}>{replyStatusLabels[item.previousStatus ?? 'All']} → {replyStatusLabels[item.newStatus]}・{item.source === 'user' ? '人工' : '系統'}・{new Date(item.changedAt).toLocaleString('zh-TW')}</small>
                      ))}
                    </div>
                  ) : <small>尚無狀態變更紀錄。</small>}
                </section>
              ) : null}
              <div className="business-risk-panel">
                <div className="business-risk-panel__header">
                  <h3>商工驗證風險分數</h3>
                </div>
                {businessRisk ? (
                  <div className={`business-risk-score business-risk-score--${businessRisk.riskScore.riskLevel}`}>
                    <strong>{businessRisk.riskScore.score}</strong>
                    <span>{businessRisk.riskScore.riskLevel}</span>
                    <p>{businessRisk.profile ? `${businessRisk.profile.businessName}｜${businessRisk.profile.statusDesc ?? '狀態不明'}｜資本額 ${businessRisk.profile.capitalAmount?.toLocaleString() ?? '未揭露'}` : '查無商工資料，請確認統編是否正確，或向客戶索取統編後再查。'}</p>
                    {[...businessRisk.riskScore.positiveFactors, ...businessRisk.riskScore.negativeFactors].map((factor) => (
                      <small key={`${factor.type}-${factor.label}`}>{factor.label} ({factor.scoreDelta > 0 ? '+' : ''}{factor.scoreDelta})</small>
                    ))}
                  </div>
                ) : <p>{businessRiskStatus || (selectedTaxId ? `可用訊息中的統編 ${selectedTaxId} 查詢。` : '訊息未提供統編時，系統會用客戶名稱嘗試查詢；若查無資料會顯示未驗證結果。')}</p>}
                {businessRisk && businessRiskStatus ? <p>{businessRiskStatus}</p> : null}
              </div>
              <div className="alerts-list">
                <h3>規則提醒</h3>
                {visibleAlerts.length > 0 ? visibleAlerts.map((alert) => (
                  <article key={alert.id} className={`alert-card alert-card--${alert.severity}`}>
                    <div className="alert-card__top">
                      <strong>{alert.title}</strong>
                      <span>{alert.type}</span>
                    </div>
                    <p>{formatBackendText(alert.message)}</p>
                  </article>
                )) : <p>沒有觸發提醒。</p>}
              </div>
              {visibleSimilarCases.length > 0 ? <div className="similar-list">
                <h3>RAG 相似歷史案例</h3>
                {visibleSimilarCases.map((item) => (
                  <article key={item.id} className="similar-card">
                    <div className="similar-card__top">
                      <strong>{item.title}</strong>
                      <span>相似 {item.score}%</span>
                    </div>
                    <p>{item.summary}</p>
                    <div className="similar-card__meta">
                      <span>{item.platform}</span>
                      <span>{item.quoteAmount ? `$${item.quoteAmount.toLocaleString()}` : '未定價'}</span>
                      <span>{item.outcome}</span>
                    </div>
                    <blockquote>{item.replyExample}</blockquote>
                  </article>
                ))}
              </div> : null}
            </>
          ) : selectedMessage ? (
            <>
              <section className="analysis-empty-state">
                <strong>{selectedMessage.caseId ? 'AI 判讀資料載入中' : '尚未建案'}</strong>
                <p>{selectedMessage.caseId ? '正在讀取此案件既有的 AI 擷取資料。' : '這封訊息還沒有進入建案流程，因此中間欄不顯示原信，只保留給分析結果。'}</p>
              </section>
            </>
          ) : (
            <p>目前沒有訊息。</p>
          )}
          <section className="business-risk-panel registry-screen-panel">
                <div className="business-risk-panel__header">
                  <h3>客戶真偽篩選</h3>
                </div>
                <p>收到不認識的合作邀請時，用統編或名稱查公司登記。登記資料只能證明這間公司存在，對方有沒有被授權，仍要用公司官方聯絡管道確認。目前只查登記狀態為「核准設立」的公司。</p>
                <label>
                  統一編號
                  <input value={registryTaxId} onChange={(event) => setRegistryTaxId(event.target.value)} inputMode="numeric" maxLength={8} placeholder="8 碼，可留空" />
                </label>
                <label>
                  公司名稱關鍵字
                  <input value={registryKeyword} onChange={(event) => setRegistryKeyword(event.target.value)} placeholder="例如 品喬室內裝修設計" />
                </label>
                <button type="button" onClick={handleScreenRegistry} disabled={isScreening}>{isScreening ? '查詢中...' : '查詢登記資料'}</button>
                {registryStatus ? <small>{registryStatus}</small> : null}
                {registryResult ? (
                  <div className="registry-screen-result">
                    <strong>查詢結果：{registryStatusLabels[registryResult.status]}</strong>
                    {registryResult.candidates.map((item) => (
                      <article key={`${item.entityType}-${item.taxId ?? item.name}`} className="similar-card">
                        <div className="similar-card__top">
                          <strong>{item.name}</strong>
                          <span>{item.entityType === 'company' ? '公司' : '商業'}</span>
                        </div>
                        <p>統編 {item.taxId ?? '未提供'}｜登記狀態 {item.statusDesc ?? '未提供'}</p>
                        <p>{item.address ?? '地址未提供'}｜負責人 {item.responsibleName ?? '未提供'}</p>
                      </article>
                    ))}
                    {registryResult.hint ? <p>{registryResult.hint}</p> : null}
                    {registryResult.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                    <small>查詢時間 {new Date(registryResult.queriedAt).toLocaleString('zh-TW')}｜來源：經濟部商工行政資料開放平臺｜尚未確認為對方本人</small>
                  </div>
                ) : null}
              </section>
          {selectedMessageIsGmail ? (
            <div className="message-exclusion-box">
              <div>
                <h3>這封不相關？</h3>
                <p>排除後會從訊息串流隱藏；若它單獨建立了一張案件卡，也會從 Kanban 隱藏。</p>
              </div>
              <label>
                排除原因
                <select value={excludeReason} onChange={(event) => setExcludeReason(event.target.value)}>
                  {exclusionReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <button type="button" onClick={handleExcludeSelectedMessage}>排除這封郵件</button>
              {excludeStatus ? <p>{excludeStatus}</p> : null}
            </div>
          ) : null}
          </article>

        </section>

        <section className="message-chat-panel">
          <article className="page-card message-chat-card">
            <div className="messages-panel-heading">
              <div>
                <h2>{selectedMessage?.senderName ?? '尚無訊息'}</h2>
                <p>{selectedMessage ? `${selectedMessage.platform}・${new Date(selectedMessage.timestamp).toLocaleString('zh-TW')}` : '等待訊息'}</p>
              </div>
              <span>{selectedMessage?.caseId ? '已建案' : '待處理'}</span>
            </div>
            <div className="message-conversation">
              {selectedMessage ? (
                <article className="message-bubble">
                  {selectedMailContent.subject ? <strong className="message-bubble__subject">{selectedMailContent.subject}</strong> : null}
                  <pre>{selectedMailContent.body || selectedMessage.text}</pre>
                  <small>{new Date(selectedMessage.timestamp).toLocaleString('zh-TW')}</small>
                </article>
              ) : <p>目前沒有訊息。</p>}
              {visibleExtraction?.suggestedReply ? (
                <article className="message-bubble message-bubble--ai">
                  <p>{visibleExtraction.suggestedReply}</p>
                  <small>AI 建議回覆</small>
                </article>
              ) : null}
            </div>
          </article>

          <article className="page-card message-reply-card">
  <div className="messages-panel-heading">
    <div>
      <h2>AI 回覆草稿</h2>
      <p>可直接編輯後複製使用</p>
    </div>
  </div>
  <textarea value={draftReply} onChange={(event) => setDraftReply(event.target.value)} placeholder="匯入訊息後會產生建議回覆" />
  <div className="message-reply-card__actions">
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(draftReply).then(() => {
          setCopyFeedback(true);
          setTimeout(() => setCopyFeedback(false), 2000);
        });
      }}
    >
      複製回覆
    </button>
    {copyFeedback ? <span className="copy-toast">已複製到剪貼簿</span> : null}
  </div>
</article>
        </section>
      </section>
    </div>
  );
}
