import {useEffect, useState} from 'react';
import type {CaseDetail, CaseRecord, CaseStatus} from '@casebee/shared';
import {enrichBusinessRisk, getCaseDetail, getCases, resolveAlert, updateCase, updateCaseStatus} from '../services/api';
import type {NavigateToPage} from '../App';

const caseStatuses: CaseStatus[] = ['潛在詢問', '需求確認中', '已報價', '等待回覆', '已確認合作', '進行中', '等待素材', '待修改', '待交付', '已完成', '已流失'];

const phaseColumns: Array<{title: string; statuses: CaseStatus[]; dropStatus: CaseStatus; hint: string}> = [
  {title: '詢問中', statuses: ['潛在詢問', '需求確認中'], dropStatus: '需求確認中', hint: '新需求、資料確認'},
  {title: '報價 / 等回覆', statuses: ['已報價', '等待回覆'], dropStatus: '已報價', hint: '已送報價、等待確認'},
  {title: '製作中', statuses: ['已確認合作', '進行中', '等待素材', '待修改'], dropStatus: '進行中', hint: '執行、補素材、修改'},
  {title: '交付 / 結案', statuses: ['待交付', '已完成'], dropStatus: '待交付', hint: '準備交付或已完成'},
  {title: '已流失', statuses: ['已流失'], dropStatus: '已流失', hint: '未成交或停止追蹤'},
];

const missingFieldLabels: Record<string, string> = {
  clientName: '客戶名稱',
  customerName: '客戶名稱',
  projectItem: '專案項目',
  project_item: '專案項目',
  quoteAmount: '預算 / 報價金額',
  quote_amount: '預算 / 報價金額',
  expectedDeadline: '預期到期時間',
  expected_deadline: '預期到期時間',
  intent: '需求目的',
  contactMethod: '聯絡方式',
  contact_method: '聯絡方式',
  reference: '參考資料',
  required_materials: '必要素材',
  submission_deadline: '交稿期限',
  publish_deadline: '發布 / 上線期限',
  next_action: '下一步',
  scope: '工作範圍',
  deliverables: '交付項目',
  platform: '聯絡平台',
};

function formatMoney(value: number | null) {
  return value === null ? '未填' : `NT$ ${value.toLocaleString('zh-TW')}`;
}

function formatRiskLevel(level: string) {
  const labels: Record<string, string> = {normal: '一般', warning: '需注意', danger: '高風險', low: '低風險', medium: '中風險', high: '高風險', unverified: '未驗證'};
  return labels[level] ?? level;
}

function formatMissingField(field: string) {
  return missingFieldLabels[field] ?? field;
}

function formatBackendText(text: string) {
  return Object.entries(missingFieldLabels).reduce((current, [field, label]) => current.replaceAll(field, label), text);
}

function buildCaseNextSteps(caseDetail: CaseDetail) {
  const steps = [];
  if (caseDetail.case.missingFields.length > 0) {
    steps.push(`補齊 ${caseDetail.case.missingFields.map(formatMissingField).join('、')}`);
  }
  if (!caseDetail.businessRiskScore || caseDetail.businessRiskScore.riskLevel === 'unverified') {
    steps.push('報價前確認客戶商工/統編資料');
  }
  if (caseDetail.alerts.some((alert) => !alert.resolvedAt)) {
    steps.push('處理未完成規則提醒');
  }
  if (caseDetail.case.status === '潛在詢問' || caseDetail.case.status === '需求確認中') {
    steps.push('確認需求後更新為已報價或等待回覆');
  }
  if (caseDetail.case.status === '已報價' || caseDetail.case.status === '等待回覆') {
    steps.push('追蹤客戶是否接受報價');
  }
  return steps.length > 0 ? steps : ['資料完整，依目前狀態安排製作或交付。'];
}

interface KanbanPageProps {
  onNavigate: NavigateToPage;
  targetCaseId?: string;
}

export function KanbanPage({onNavigate, targetCaseId}: KanbanPageProps) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [draggingCaseId, setDraggingCaseId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [editStatus, setEditStatus] = useState<CaseStatus>('潛在詢問');
  const [editQuoteAmount, setEditQuoteAmount] = useState('');
  const [editExpectedDeadline, setEditExpectedDeadline] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [businessRiskMessage, setBusinessRiskMessage] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [isSavingCase, setIsSavingCase] = useState(false);
  const [isEnrichingBusinessRisk, setIsEnrichingBusinessRisk] = useState(false);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;

  useEffect(() => {
    getCases().then(setCases).catch(() => setCases([]));
  }, []);

  useEffect(() => {
    if (targetCaseId && cases.some((item) => item.id === targetCaseId)) {
      setSelectedCaseId(targetCaseId);
    }
  }, [cases, targetCaseId]);

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseDetail(null);
      return;
    }

    getCaseDetail(selectedCaseId).then(setCaseDetail).catch(() => setCaseDetail(null));
  }, [selectedCaseId]);

  useEffect(() => {
    if (!caseDetail) {
      return;
    }

    setEditStatus(caseDetail.case.status);
    setEditQuoteAmount(caseDetail.case.quoteAmount === null ? '' : String(caseDetail.case.quoteAmount));
    setEditExpectedDeadline(caseDetail.case.expectedDeadline ?? '');
    setEditSummary(caseDetail.case.summary);
    setSaveMessage('');
    setBusinessRiskMessage('');
    setAlertMessage('');
    setResolvingAlertId(null);
    setIsSavingCase(false);
    setIsEnrichingBusinessRisk(false);
  }, [caseDetail]);

  useEffect(() => {
    if (!caseDetail || caseDetail.businessRiskScore) {
      return;
    }

    let isCurrent = true;
    setIsEnrichingBusinessRisk(true);
    setBusinessRiskMessage('商工風險自動查詢中...');

    const taxId = caseDetail.messages.map((message) => message.text.match(/\b\d{8}\b/)?.[0]).find(Boolean);
    enrichBusinessRisk({customerName: caseDetail.case.customerName, customerId: caseDetail.case.customerId, taxId})
      .then((result) => {
        if (isCurrent) {
          setCaseDetail((current) => (current ? {...current, businessProfile: result.profile, businessRiskScore: result.riskScore} : current));
          setBusinessRiskMessage(`已自動更新商工風險，來源：${result.provider}`);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setBusinessRiskMessage(error instanceof Error ? error.message : '商工風險查詢失敗。');
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsEnrichingBusinessRisk(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [caseDetail]);

  const handleDrop = async (status: CaseStatus) => {
    if (!draggingCaseId) {
      return;
    }

    const previousCases = cases;
    const draggedCase = cases.find((item) => item.id === draggingCaseId);
    setDraggingCaseId(null);

    if (!draggedCase || draggedCase.status === status) {
      return;
    }

    setCases((current) => current.map((item) => (item.id === draggingCaseId ? {...item, status} : item)));
    setStatusMessage('更新案件狀態中...');

    try {
      const updatedCase = await updateCaseStatus(draggingCaseId, status);
      setCases((current) => current.map((item) => (item.id === updatedCase.id ? updatedCase : item)));
      setCaseDetail((current) => (current?.case.id === updatedCase.id ? {...current, case: updatedCase} : current));
      setStatusMessage(`已移動到「${status}」`);
    } catch {
      setCases(previousCases);
      setStatusMessage('狀態更新失敗，已還原。');
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    setResolvingAlertId(alertId);
    setAlertMessage('處理提醒中...');

    try {
      const updatedAlert = await resolveAlert(alertId);
      setCaseDetail((current) => current ? {
        ...current,
        alerts: current.alerts.map((alert) => (alert.id === updatedAlert.id ? updatedAlert : alert)),
      } : current);
      setAlertMessage('提醒已標記為已處理。');
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : '提醒處理失敗。');
    } finally {
      setResolvingAlertId(null);
    }
  };

  const handleSaveCase = async () => {
    if (!caseDetail) {
      return;
    }

    const quoteAmount = editQuoteAmount.trim() ? Number(editQuoteAmount) : null;
    if (quoteAmount !== null && (!Number.isFinite(quoteAmount) || quoteAmount < 0)) {
      setSaveMessage('報價金額需為 0 以上數字。');
      return;
    }

    setIsSavingCase(true);
    setSaveMessage('儲存中...');

    try {
      const updatedCase = await updateCase(caseDetail.case.id, {
        status: editStatus,
        quoteAmount,
        expectedDeadline: editExpectedDeadline.trim() || null,
        summary: editSummary.trim(),
      });
      setCases((current) => current.map((item) => (item.id === updatedCase.id ? updatedCase : item)));
      setCaseDetail((current) => (current ? {...current, case: updatedCase} : current));
      setSaveMessage('已儲存案件資料。');
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : '儲存失敗。');
    } finally {
      setIsSavingCase(false);
    }
  };

  const handleEnrichBusinessRisk = async () => {
    if (!caseDetail) {
      return;
    }

    setIsEnrichingBusinessRisk(true);
    setBusinessRiskMessage('查詢商工風險中...');

    try {
      const taxId = caseDetail.messages.map((message) => message.text.match(/\b\d{8}\b/)?.[0]).find(Boolean);
      const result = await enrichBusinessRisk({customerName: caseDetail.case.customerName, customerId: caseDetail.case.customerId, taxId});
      setCaseDetail((current) => (current ? {...current, businessProfile: result.profile, businessRiskScore: result.riskScore} : current));
      setBusinessRiskMessage(`已更新商工風險，來源：${result.provider}`);
    } catch (error) {
      setBusinessRiskMessage(error instanceof Error ? error.message : '商工風險查詢失敗。');
    } finally {
      setIsEnrichingBusinessRisk(false);
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <h1>案件看板</h1>
          <p>從訊息自動形成案件卡片，集中追蹤狀態與風險。</p>
        </div>
        <span className="status-pill">{statusMessage || '拖曳卡片即可更新狀態'}</span>
      </header>

      <section className="kanban-board">
        {phaseColumns.map((column) => {
          const columnCases = cases.filter((item) => column.statuses.includes(item.status));
          return (
          <article
            key={column.title}
            className="kanban-column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void handleDrop(column.dropStatus)}
          >
            <div className="kanban-column__header">
              <div>
                <h2>{column.title}</h2>
                <small>{column.hint}</small>
              </div>
              <span>{columnCases.length}</span>
            </div>
            {columnCases.map((item) => (
              <button
                key={item.id}
                className={`case-card ${draggingCaseId === item.id ? 'case-card--dragging' : ''}`}
                draggable
                type="button"
                onClick={() => setSelectedCaseId(item.id)}
                onDragStart={() => setDraggingCaseId(item.id)}
                onDragEnd={() => setDraggingCaseId(null)}
              >
                <div className="case-card__top">
                  <span>{item.platform}・{item.status}</span>
                  <span className={`risk-badge risk-badge--${item.riskLevel}`}>{item.riskLevel}</span>
                </div>
                <strong>{item.customerName}</strong>
                <p>{item.projectItem}</p>
                <div className="case-card__meta">
                  <span>{formatMoney(item.quoteAmount)}</span>
                  <span>{item.expectedDeadline ?? '未填期限'}</span>
                </div>
                <div className="case-card__bottom">
                  <small>{item.code}・{item.status}</small>
                  {item.missingFields.length > 0 ? <span>缺 {item.missingFields.length} 項</span> : <span>資料完整</span>}
                </div>
              </button>
            ))}
            {columnCases.length === 0 ? <p className="kanban-empty">目前沒有案件</p> : null}
          </article>
          );
        })}
      </section>

      {selectedCaseId ? (
        <aside className="case-modal" aria-label="案件詳情">
          <button className="case-modal__backdrop" type="button" onClick={() => setSelectedCaseId(null)} aria-label="關閉案件詳情" />
          <div className="case-modal__panel">
            <div className="case-modal__header">
              <div>
                <span>{caseDetail ? `${caseDetail.case.code}・${caseDetail.case.projectItem}` : selectedCase ? `${selectedCase.code}・${selectedCase.projectItem}` : '載入中'}</span>
                <h2>{caseDetail?.case.customerName ?? selectedCase?.customerName ?? '案件詳情'}</h2>
              </div>
              <button className="case-modal__close" type="button" onClick={() => setSelectedCaseId(null)} aria-label="關閉案件詳情">×</button>
            </div>

            {caseDetail ? (
              <div className="case-modal__body">
                <section className="detail-section detail-section--hero">
                  <h3>專案總覽</h3>
                  <div className="detail-grid">
                    <span>客戶</span><strong>{caseDetail.case.customerName}</strong>
                    <span>專案</span><strong>{caseDetail.case.projectItem}</strong>
                    <span>來源</span><strong>{caseDetail.case.platform}</strong>
                    <span>狀態</span><strong>{caseDetail.case.status}</strong>
                    <span>報價</span><strong>{formatMoney(caseDetail.case.quoteAmount)}</strong>
                    <span>期限</span><strong>{caseDetail.case.expectedDeadline ?? '未填'}</strong>
                    <span>風險</span><strong>{formatRiskLevel(caseDetail.case.riskLevel)}</strong>
                  </div>
                  <p>{caseDetail.case.summary}</p>
                  <div className="detail-action-row">
                    <button type="button" onClick={() => onNavigate('messages', {messageId: caseDetail.messages[0]?.id})}>回看來源訊息</button>
                    <button type="button" onClick={() => onNavigate('customers', {customerId: caseDetail.case.customerId})}>查看客戶資料</button>
                  </div>
                </section>

                <section className="detail-section">
                  <h3>下一步建議</h3>
                  <div className="next-step-list">
                    {buildCaseNextSteps(caseDetail).map((step) => <span key={step}>{step}</span>)}
                  </div>
                </section>

                <section className="detail-section detail-edit-section">
                  <h3>編輯案件</h3>
                  <label>
                    狀態
                    <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as CaseStatus)}>
                      {caseStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <label>
                    預算 / 報價金額
                    <input inputMode="numeric" value={editQuoteAmount} onChange={(event) => setEditQuoteAmount(event.target.value)} placeholder="例如 12000" />
                  </label>
                  <label>
                    預期到期時間
                    <input value={editExpectedDeadline} onChange={(event) => setEditExpectedDeadline(event.target.value)} placeholder="例如 2026-09-15 或 下週五" />
                  </label>
                  <label>
                    案件摘要
                    <textarea value={editSummary} onChange={(event) => setEditSummary(event.target.value)} />
                  </label>
                  <button type="button" onClick={handleSaveCase} disabled={isSavingCase}>{isSavingCase ? '儲存中...' : '儲存案件資料'}</button>
                  {saveMessage ? <p>{saveMessage}</p> : null}
                </section>

                <section className="detail-section">
                  <h3>缺少資料</h3>
                  {caseDetail.case.missingFields.length > 0 ? (
                    <div className="tag-row">{caseDetail.case.missingFields.map((field) => <span key={field}>{formatMissingField(field)}</span>)}</div>
                  ) : <p>目前沒有缺少欄位。</p>}
                </section>

                <section className="detail-section">
                  <h3>商工風險</h3>
                  {caseDetail.businessRiskScore ? (
                    <div className={`business-risk-score business-risk-score--${caseDetail.businessRiskScore.riskLevel}`}>
                      <strong>{caseDetail.businessRiskScore.score}</strong>
                      <span>{formatRiskLevel(caseDetail.businessRiskScore.riskLevel)}</span>
                      <p>{caseDetail.businessProfile ? `${caseDetail.businessProfile.businessName}｜${caseDetail.businessProfile.statusDesc ?? '狀態不明'}｜資本額 ${caseDetail.businessProfile.capitalAmount?.toLocaleString('zh-TW') ?? '未揭露'}` : '尚未取得商工登記資料。'}</p>
                      {[...caseDetail.businessRiskScore.positiveFactors, ...caseDetail.businessRiskScore.negativeFactors].map((factor) => (
                        <small key={`${factor.type}-${factor.label}`}>{factor.label} ({factor.scoreDelta > 0 ? '+' : ''}{factor.scoreDelta})</small>
                      ))}
                    </div>
                  ) : <p>尚未查詢商工風險。可直接針對此客戶執行商工風險查詢。</p>}
                  {isEnrichingBusinessRisk && !caseDetail.businessRiskScore ? <p>商工風險自動查詢中...</p> : null}
                  {businessRiskMessage ? <p>{businessRiskMessage}</p> : null}
                </section>

                <section className="detail-section">
                  <h3>訊息紀錄</h3>
                  {caseDetail.messages.length > 0 ? caseDetail.messages.map((message) => (
                    <article key={message.id} className="detail-card">
                      <strong>{message.senderName}・{message.platform}</strong>
                      <p>{message.text}</p>
                      <small>{new Date(message.timestamp).toLocaleString('zh-TW')}</small>
                    </article>
                  )) : <p>尚無訊息紀錄。</p>}
                </section>

                <section className="detail-section">
                  <h3>AI 擷取與建議回覆</h3>
                  {caseDetail.aiExtractions.length > 0 ? caseDetail.aiExtractions.map((extraction, index) => (
                    <article key={`${extraction.intent}-${index}`} className="detail-card">
                      <strong>{extraction.intent}</strong>
                      <p>{extraction.summary}</p>
                      <blockquote>{extraction.suggestedReply}</blockquote>
                    </article>
                  )) : <p>尚無 AI 擷取資料。</p>}
                </section>

                <section className="detail-section">
                  <h3>提醒</h3>
                  {caseDetail.alerts.length > 0 ? caseDetail.alerts.map((alert) => (
                    <article key={alert.id} className={`alert-card alert-card--${alert.severity} ${alert.resolvedAt ? 'alert-card--resolved' : ''}`}>
                      <div className="alert-card__top"><strong>{alert.title}</strong><span>{alert.resolvedAt ? '已處理' : alert.type}</span></div>
                      <p>{formatBackendText(alert.message)}</p>
                      {alert.resolvedAt ? <small>處理時間：{new Date(alert.resolvedAt).toLocaleString('zh-TW')}</small> : (
                        <button type="button" onClick={() => void handleResolveAlert(alert.id)} disabled={resolvingAlertId === alert.id}>{resolvingAlertId === alert.id ? '處理中...' : '標記已處理'}</button>
                      )}
                    </article>
                  )) : <p>目前沒有提醒。</p>}
                  {alertMessage ? <p>{alertMessage}</p> : null}
                </section>
              </div>
            ) : (
              <p className="case-modal__loading">載入案件內容中...</p>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
