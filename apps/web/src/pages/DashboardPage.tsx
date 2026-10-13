import {useEffect, useState} from 'react';
import type {BusinessRiskSummary, CaseRecord, MessageEvent} from '@casebee/shared';
import {getBusinessRiskSummary, getCases, getMessages} from '../services/api';
import type {NavigateToPage} from '../App';
import {displayText, truncateDisplayText} from '../utils/displayText';

interface DashboardPageProps {
  onNavigate: NavigateToPage;
}

export function DashboardPage({onNavigate}: DashboardPageProps) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [messages, setMessages] = useState<MessageEvent[]>([]);
  const [businessRiskSummary, setBusinessRiskSummary] = useState<BusinessRiskSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getCases(), getMessages(), getBusinessRiskSummary()])
      .then(([caseData, messageData, riskSummary]) => {
        setCases(caseData);
        setMessages(messageData);
        setBusinessRiskSummary(riskSummary);
      })
      .catch((caughtError: unknown) => {
        setError(caughtError instanceof Error ? caughtError.message : '資料載入失敗');
      });
  }, []);

  const lineCount = cases.filter((item) => item.platform === 'LINE').length;
  const gmailCount = cases.filter((item) => item.platform === 'Gmail').length;
  const manualCount = cases.filter((item) => item.platform === 'Manual').length;
  const riskCount = cases.filter((item) => item.riskLevel !== 'normal').length;
  const activeCaseCount = cases.filter((item) => item.status !== '已完成' && item.status !== '已流失').length;
  const todayMessageCount = messages.filter((item) => new Date(item.timestamp).toDateString() === new Date().toDateString()).length;
  const missingFieldCaseCount = cases.filter((item) => item.missingFields.length > 0).length;
  const pendingReviewMessages = messages.filter((item) => item.reviewStatus === 'pending');
  const quotedAmount = cases.reduce((sum, item) => sum + (item.quoteAmount ?? 0), 0);
  const unhandledMessages = messages.filter((item) => !item.caseId).slice(0, 3);
  const missingFieldCases = cases.filter((item) => item.missingFields.length > 0).slice(0, 3);
  const activeCases = cases.filter((item) => item.status !== '已完成' && item.status !== '已流失').slice(0, 3);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <h1>統計分析</h1>
          <p>今天該先處理什麼：新訊息、缺資料案件、客戶風險與進行中工作。</p>
        </div>
        <span className="status-pill">API connected</span>
      </header>

      {error ? <section className="page-card page-card--danger">{error}</section> : null}

      <section className="metric-grid">
        <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate('kanban')}>
          <span>案件總數</span>
          <strong>{cases.length}</strong>
          <small>查看案件看板</small>
        </button>
        <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate('kanban')}>
          <span>進行中案件</span>
          <strong>{activeCaseCount}</strong>
          <small>追蹤製作與回覆狀態</small>
        </button>
        <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate('messages')}>
          <span>今日訊息</span>
          <strong>{todayMessageCount}</strong>
          <small>前往訊息整合處理</small>
        </button>
      </section>

      <section className="metric-grid">
        <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate('kanban')}>
          <span>風險案件</span>
          <strong>{riskCount}</strong>
          <small>檢查需要人工介入的案件</small>
        </button>
        <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate('kanban')}>
          <span>缺資料案件</span>
          <strong>{missingFieldCaseCount}</strong>
          <small>先補齊資料再報價</small>
        </button>
        <article className="metric-card">
          <span>已記錄報價</span>
          <strong>{quotedAmount.toLocaleString('zh-TW')}</strong>
          <small>所有案件加總</small>
        </article>
        <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate('messages', pendingReviewMessages[0] ? {messageId: pendingReviewMessages[0].id} : undefined)}>
          <span>待人工確認</span>
          <strong>{pendingReviewMessages.length}</strong>
          <small>檢查 AI thread 衝突與新值</small>
        </button>
      </section>

      <section className="dashboard-action-grid">
        <article className="page-card dashboard-action-card">
          <div className="dashboard-action-card__header">
            <div>
              <h2>待判讀訊息</h2>
              <p>先確認新信是否要建案、排除或回覆。</p>
            </div>
            <button type="button" onClick={() => onNavigate('messages')}>前往 Messages</button>
          </div>
          {unhandledMessages.length > 0 ? unhandledMessages.map((message) => (
            <button type="button" key={message.id} className="dashboard-task-row dashboard-task-row--button" onClick={() => onNavigate('messages', {messageId: message.id})}><strong>{displayText(message.senderName, '未命名')}</strong><span>{truncateDisplayText(message.text, 64)}...</span></button>
          )) : <p>目前沒有未連結案件的訊息。</p>}
        </article>

        <article className="page-card dashboard-action-card">
          <div className="dashboard-action-card__header">
            <div>
              <h2>需要補資料</h2>
              <p>這些案件缺少預算、期限或專案項目。</p>
            </div>
            <button type="button" onClick={() => onNavigate('kanban')}>前往 Kanban</button>
          </div>
          {missingFieldCases.length > 0 ? missingFieldCases.map((item) => (
            <button type="button" key={item.id} className="dashboard-task-row dashboard-task-row--button" onClick={() => onNavigate('kanban', {caseId: item.id})}><strong>{displayText(item.title, '未命名案件')}</strong><span>{item.missingFields.length} 項缺漏・{displayText(item.customerName, '未命名')}</span></button>
          )) : <p>目前沒有缺資料案件。</p>}
        </article>

        <article className="page-card dashboard-action-card">
          <div className="dashboard-action-card__header">
            <div>
              <h2>進行中案件</h2>
              <p>回到案件看板安排下一步。</p>
            </div>
            <button type="button" onClick={() => onNavigate('kanban')}>管理案件</button>
          </div>
          {activeCases.length > 0 ? activeCases.map((item) => (
            <button type="button" key={item.id} className="dashboard-task-row dashboard-task-row--button" onClick={() => onNavigate('kanban', {caseId: item.id})}><strong>{displayText(item.title, '未命名案件')}</strong><span>{item.status}・{item.expectedDeadline ?? '未填期限'}</span></button>
          )) : <p>目前沒有進行中案件。</p>}
        </article>

        <article className="page-card dashboard-action-card">
          <div className="dashboard-action-card__header">
            <div>
              <h2>AI 人工確認</h2>
              <p>處理 thread 衝突、欄位變更與低信心判讀。</p>
            </div>
            <button type="button" onClick={() => onNavigate('messages', pendingReviewMessages[0] ? {messageId: pendingReviewMessages[0].id} : undefined)}>前往確認</button>
          </div>
          {pendingReviewMessages.length > 0 ? pendingReviewMessages.slice(0, 3).map((message) => (
            <button type="button" key={message.id} className="dashboard-task-row dashboard-task-row--button" onClick={() => onNavigate('messages', {messageId: message.id})}><strong>{displayText(message.senderName, '未命名')}</strong><span>{message.platform} thread 需要確認・{truncateDisplayText(message.text, 48)}...</span></button>
          )) : <p>目前沒有待人工確認的 AI 判讀。</p>}
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="page-card">
          <h2>案件來源平台</h2>
          <div className="source-row source-row--line"><span>LINE</span><strong>{lineCount} 件</strong></div>
          <div className="source-row source-row--gmail"><span>Gmail</span><strong>{gmailCount} 件</strong></div>
          <div className="source-row"><span>Manual</span><strong>{manualCount} 件</strong></div>
        </article>

        <article className="page-card">
          <h2>商工風險概況</h2>
          {businessRiskSummary ? (
            <div className="business-risk-summary">
              <div><span>低風險</span><strong>{businessRiskSummary.low}</strong></div>
              <div><span>中風險</span><strong>{businessRiskSummary.medium}</strong></div>
              <div><span>高風險</span><strong>{businessRiskSummary.high}</strong></div>
              <div><span>未驗證</span><strong>{businessRiskSummary.unverified}</strong></div>
              <p>平均分數：{businessRiskSummary.averageScore ?? '尚無資料'}</p>
              <button type="button" className="detail-secondary-button" onClick={() => onNavigate('customers')}>查看客戶風險</button>
            </div>
          ) : (
            <p>尚未建立商工風險資料。</p>
          )}
        </article>
      </section>

      {cases.length === 0 ? (
        <section className="empty-state">
          <strong>尚無案件資料</strong>
          <p>請先完成 Gmail 串接並等待自動同步，或到訊息整合頁手動匯入測試訊息。</p>
        </section>
      ) : null}
    </div>
  );
}
