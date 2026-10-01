import {useEffect, useState} from 'react';
import type {CustomerDetail, CustomerSummary} from '@casebee/shared';
import {enrichBusinessRisk, getCustomerDetail, getCustomers} from '../services/api';
import type {NavigateToPage} from '../App';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-TW') : '尚無案件';
}

function customerDecision(detail: CustomerDetail) {
  if (detail.businessRiskScore?.riskLevel === 'high') {
    return '高風險客戶，報價或簽約前需要人工確認商工狀態與付款條件。';
  }
  if (!detail.businessRiskScore || detail.businessRiskScore.riskLevel === 'unverified') {
    return '尚未驗證客戶，報價前建議索取統編、合約抬頭或付款資訊。';
  }
  if (detail.customer.activeCaseCount > 0) {
    return '目前有進行中案件，優先回到 Kanban 追蹤交期與狀態。';
  }
  return '目前無進行中案件，可保留為歷史客戶與相似案例參考。';
}

interface CustomersPageProps {
  onNavigate: NavigateToPage;
  targetCustomerId?: string;
}

export function CustomersPage({onNavigate, targetCustomerId}: CustomersPageProps) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState('');
  const [businessRiskStatus, setBusinessRiskStatus] = useState('');

  useEffect(() => {
    getCustomers()
      .then(setCustomers)
      .catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : '客戶資料載入失敗'));
  }, []);

  useEffect(() => {
    if (targetCustomerId && customers.some((customer) => customer.id === targetCustomerId)) {
      setSelectedCustomerId(targetCustomerId);
    }
  }, [customers, targetCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerDetail(null);
      return;
    }

    getCustomerDetail(selectedCustomerId)
      .then(setCustomerDetail)
      .catch(() => setCustomerDetail(null));
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!customerDetail || customerDetail.businessRiskScore) {
      setBusinessRiskStatus('');
      return;
    }

    let isCurrent = true;
    const taxId = customerDetail.messages.map((message) => message.text.match(/\b\d{8}\b/)?.[0]).find(Boolean);
    setBusinessRiskStatus('商工風險自動查詢中...');
    enrichBusinessRisk({customerName: customerDetail.customer.name, customerId: customerDetail.customer.id, taxId})
      .then((result) => {
        if (isCurrent) {
          setCustomerDetail((current) => (current ? {...current, businessProfile: result.profile, businessRiskScore: result.riskScore} : current));
          setBusinessRiskStatus(`已自動查詢商工風險，來源：${result.provider}`);
        }
      })
      .catch((caughtError: unknown) => {
        if (isCurrent) {
          setBusinessRiskStatus(caughtError instanceof Error ? caughtError.message : '商工風險查詢失敗');
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [customerDetail]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <h1>客戶管理</h1>
          <p>集中查看客戶、聯絡來源、案件數與風險概況。</p>
        </div>
        <span className="status-pill">{customers.length} 位客戶</span>
      </header>

      {error ? <section className="page-card page-card--danger">{error}</section> : null}

      {customers.length === 0 && !error ? (
        <section className="empty-state">
          <strong>尚無客戶資料</strong>
          <p>請先在設定頁完成 Gmail 串接並等待自動同步，或到訊息整合頁手動匯入測試訊息。</p>
        </section>
      ) : (
        <section className="customer-grid">
          {customers.map((customer) => (
            <button key={customer.id} type="button" className="customer-card" onClick={() => setSelectedCustomerId(customer.id)}>
              <div className="customer-card__top">
                <div>
                  <strong>{customer.name}</strong>
                  <span>{customer.platform}・{customer.contactHandle}</span>
                </div>
                <span>{customer.riskCaseCount > 0 ? `風險 ${customer.riskCaseCount}` : '正常'}</span>
              </div>
              <div className="customer-card__metrics">
                <div><span>案件總數</span><strong>{customer.caseCount}</strong></div>
                <div><span>進行中</span><strong>{customer.activeCaseCount}</strong></div>
                <div><span>風險案件</span><strong>{customer.riskCaseCount}</strong></div>
              </div>
              <p>最後聯絡：{new Date(customer.lastContactAt).toLocaleString('zh-TW')}</p>
              <p>最近案件更新：{formatDate(customer.latestCaseUpdatedAt)}</p>
            </button>
          ))}
        </section>
      )}

      {selectedCustomerId ? (
        <aside className="case-modal" aria-label="客戶詳情">
          <button className="case-modal__backdrop" type="button" onClick={() => setSelectedCustomerId(null)} aria-label="關閉客戶詳情" />
          <div className="case-modal__panel">
            <div className="case-modal__header">
              <div>
                <span>{customerDetail?.customer.platform ?? '載入中'}</span>
                <h2>{customerDetail?.customer.name ?? '客戶詳情'}</h2>
              </div>
              <button className="case-modal__close" type="button" onClick={() => setSelectedCustomerId(null)} aria-label="關閉客戶詳情">×</button>
            </div>

            {customerDetail ? (
              <div className="case-modal__body">
                <section className="detail-section detail-section--hero">
                  <h3>客戶總覽</h3>
                  <div className="detail-grid">
                    <span>聯絡來源</span><strong>{customerDetail.customer.platform}</strong>
                    <span>聯絡識別</span><strong>{customerDetail.customer.contactHandle}</strong>
                    <span>案件總數</span><strong>{customerDetail.customer.caseCount}</strong>
                    <span>進行中</span><strong>{customerDetail.customer.activeCaseCount}</strong>
                    <span>風險案件</span><strong>{customerDetail.customer.riskCaseCount}</strong>
                  </div>
                  <div className="detail-action-row">
                    <button type="button" onClick={() => onNavigate('kanban', {caseId: customerDetail.cases[0]?.id})}>查看案件看板</button>
                    <button type="button" onClick={() => onNavigate('messages', {messageId: customerDetail.messages[0]?.id})}>查看相關訊息</button>
                  </div>
                </section>

                <section className="detail-section">
                  <h3>客戶決策</h3>
                  <p>{customerDecision(customerDetail)}</p>
                </section>

                <section className="detail-section">
                  <h3>商工風險</h3>
                  {customerDetail.businessRiskScore ? (
                    <div className={`business-risk-score business-risk-score--${customerDetail.businessRiskScore.riskLevel}`}>
                      <strong>{customerDetail.businessRiskScore.score}</strong>
                      <span>{customerDetail.businessRiskScore.riskLevel}</span>
                      <p>{customerDetail.businessProfile ? `${customerDetail.businessProfile.businessName}｜${customerDetail.businessProfile.statusDesc ?? '狀態不明'}` : '尚未取得商工資料'}</p>
                    </div>
                  ) : <p>{businessRiskStatus || '商工風險自動查詢中...'}</p>}
                  {customerDetail.businessRiskScore && businessRiskStatus ? <p>{businessRiskStatus}</p> : null}
                </section>

                <section className="detail-section">
                  <h3>案件紀錄</h3>
                  {customerDetail.cases.length > 0 ? customerDetail.cases.map((item) => (
                    <article key={item.id} className="detail-card">
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                      <small>{item.status}・{item.quoteAmount ? `NT$ ${item.quoteAmount.toLocaleString('zh-TW')}` : '未報價'}・{item.expectedDeadline ?? '未填期限'}</small>
                    </article>
                  )) : <p>尚無案件紀錄。</p>}
                </section>

                <section className="detail-section">
                  <h3>最近訊息</h3>
                  {customerDetail.messages.length > 0 ? customerDetail.messages.map((message) => (
                    <article key={message.id} className="detail-card">
                      <strong>{message.platform}・{message.senderName}</strong>
                      <p>{message.text}</p>
                      <small>{new Date(message.timestamp).toLocaleString('zh-TW')}</small>
                    </article>
                  )) : <p>尚無訊息紀錄。</p>}
                </section>
              </div>
            ) : <p className="case-modal__loading">載入客戶內容中...</p>}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
