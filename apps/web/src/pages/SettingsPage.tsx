import {useEffect, useState} from 'react';
import type {Platform, RagExample, RuleScheduleStatus} from '@casebee/shared';
import {createRagExample, deactivateRagExample, getGmailAuthUrl, getGmailStatus, getMessageExclusionRules, getRagExamples, getRuleStatus, pollGmail, runRules, updateMessageExclusionRule, type MessageExclusionRule} from '../services/api';
import {displayText} from '../utils/displayText';

const platformOptions: Platform[] = ['Gmail', 'LINE', 'Instagram', 'Manual'];

export function SettingsPage() {
  const [gmailStatus, setGmailStatus] = useState('Gmail 狀態讀取中');
  const [gmailSyncStatus, setGmailSyncStatus] = useState('');
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailRedirectUri, setGmailRedirectUri] = useState('');
  const [gmailAutoPollEnabled, setGmailAutoPollEnabled] = useState(false);
  const [gmailAutoPollInterval, setGmailAutoPollInterval] = useState<number | null>(null);
  const [gmailAuthPending, setGmailAuthPending] = useState(false);
  const [ruleRunStatus, setRuleRunStatus] = useState('尚未執行');
  const [ruleStatus, setRuleStatus] = useState<RuleScheduleStatus | null>(null);
  const [ragExamples, setRagExamples] = useState<RagExample[]>([]);
  const [ragStatus, setRagStatus] = useState('RAG 知識庫讀取中');
  const [exclusionRules, setExclusionRules] = useState<MessageExclusionRule[]>([]);
  const [exclusionRuleStatus, setExclusionRuleStatus] = useState('寄件者排除規則讀取中');
  const emptyRagForm = {title: '', platform: 'Manual' as Platform, projectItem: '', quoteAmount: '', outcome: '', summary: '', replyExample: '', caseType: '', projectAliases: '', typicalMissingFields: '', quoteRangeMin: '', quoteRangeMax: '', successPattern: ''};
  const [ragForm, setRagForm] = useState(emptyRagForm);
  const [savingRag, setSavingRag] = useState(false);

  const refreshGmailStatus = async () => {
    try {
      const status = await getGmailStatus();
      setGmailConfigured(status.configured);
      setGmailConnected(status.connected);
      setGmailRedirectUri(status.redirectUri);
      setGmailAutoPollEnabled(status.autoPollEnabled);
      setGmailAutoPollInterval(status.autoPollIntervalSeconds);
      setGmailAuthPending((current) => (status.connected ? false : current));
      setGmailStatus(status.configured ? (status.connected ? `已連接：${status.accountEmail ?? 'unknown'}` : '尚未連接') : 'OAuth 尚未設定');
      setGmailSyncStatus(status.lastSyncedAt ? `上次同步：${new Date(status.lastSyncedAt).toLocaleString('zh-TW')}` : (status.configured ? 'OAuth 已設定。若剛在 Google Console 儲存，可能需等待 5 分鐘後再連接。' : '尚未同步'));
    } catch {
      setGmailConfigured(false);
      setGmailConnected(false);
      setGmailAutoPollEnabled(false);
      setGmailAutoPollInterval(null);
      setGmailStatus('無法讀取 Gmail 連線狀態');
      setGmailSyncStatus('請確認 GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI');
    }
  };

  useEffect(() => {
    void refreshGmailStatus();
    getRagExamples()
      .then((items) => {
        setRagExamples(items);
        setRagStatus(`已載入 ${items.length} 筆歷史案例`);
      })
      .catch(() => setRagStatus('無法讀取 RAG 歷史案例'));
    getRuleStatus().then(setRuleStatus).catch(() => setRuleStatus(null));
    getMessageExclusionRules()
      .then((items) => {
        setExclusionRules(items);
        setExclusionRuleStatus(`已載入 ${items.length} 筆寄件者排除規則`);
      })
      .catch(() => setExclusionRuleStatus('無法讀取寄件者排除規則'));
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => void refreshGmailStatus();
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshGmailStatus();
      }
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, []);

  useEffect(() => {
    if (!gmailAuthPending) {
      return;
    }

    const timer = window.setInterval(() => void refreshGmailStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [gmailAuthPending]);

  const handleGmailAuth = async () => {
    try {
      const {url} = await getGmailAuthUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
      setGmailAuthPending(true);
      setGmailStatus('已開啟 Gmail 授權視窗，完成授權後請回到此頁重新整理狀態。');
    } catch (error) {
      setGmailStatus(error instanceof Error ? error.message : '無法建立 Gmail 授權網址');
    }
  };

  const handleGmailPoll = async () => {
    try {
      const result = await pollGmail();
      const skippedSummary = result.skipped.reduce<Record<string, number>>((summary, item) => {
        summary[item.category] = (summary[item.category] ?? 0) + 1;
        return summary;
      }, {});
      const skippedText = Object.entries(skippedSummary).map(([category, count]) => `${category} ${count}`).join('、');
      setGmailSyncStatus(`同步完成：掃描 ${result.checkedCount} 則，匯入 ${result.importedCount} 則，略過 ${result.skippedCount} 則${skippedText ? `（${skippedText}）` : ''}，空內容 ${result.emptyCount} 則，失敗 ${result.failedCount} 則`);
      await refreshGmailStatus();
    } catch (error) {
      setGmailSyncStatus(error instanceof Error ? error.message : 'Gmail 同步失敗');
    }
  };

  const handleRunRules = async () => {
    try {
      const result = await runRules();
      setRuleRunStatus(`已檢查 ${result.checkedCount} 個需追蹤案件，新增 ${result.createdCount} 則未回覆提醒，門檻 ${result.thresholdHours} 小時。`);
      const status = await getRuleStatus();
      setRuleStatus(status);
    } catch (error) {
      setRuleRunStatus(error instanceof Error ? error.message : '規則檢查失敗');
    }
  };

  const handleCreateRagExample = async () => {
    const quoteAmount = ragForm.quoteAmount.trim() ? Number(ragForm.quoteAmount) : null;
    const quoteRangeMin = ragForm.quoteRangeMin.trim() ? Number(ragForm.quoteRangeMin) : null;
    const quoteRangeMax = ragForm.quoteRangeMax.trim() ? Number(ragForm.quoteRangeMax) : null;
    if (quoteAmount !== null && (!Number.isFinite(quoteAmount) || quoteAmount < 0)) {
      setRagStatus('金額需為 0 以上數字，或留空。');
      return;
    }
    if ((quoteRangeMin !== null && (!Number.isFinite(quoteRangeMin) || quoteRangeMin < 0)) || (quoteRangeMax !== null && (!Number.isFinite(quoteRangeMax) || quoteRangeMax < 0))) {
      setRagStatus('報價區間需為 0 以上數字，或留空。');
      return;
    }

    setSavingRag(true);
    setRagStatus('新增歷史案例中...');

    try {
      const item = await createRagExample({
        title: ragForm.title.trim(),
        platform: ragForm.platform,
        projectItem: ragForm.projectItem.trim(),
        quoteAmount,
        outcome: ragForm.outcome.trim(),
        summary: ragForm.summary.trim(),
        replyExample: ragForm.replyExample.trim(),
        caseType: ragForm.caseType.trim() || null,
        projectAliases: ragForm.projectAliases.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean),
        typicalMissingFields: ragForm.typicalMissingFields.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean),
        quoteRangeMin,
        quoteRangeMax,
        successPattern: ragForm.successPattern.trim() || null,
      });
      setRagExamples((current) => [item, ...current]);
      setRagForm(emptyRagForm);
      setRagStatus('已新增 1 筆歷史案例。');
    } catch (error) {
      setRagStatus(error instanceof Error ? error.message : '新增歷史案例失敗');
    } finally {
      setSavingRag(false);
    }
  };

  const handleDeactivateRagExample = async (id: string) => {
    setRagStatus('停用歷史案例中...');

    try {
      const item = await deactivateRagExample(id);
      setRagExamples((current) => current.map((example) => (example.id === item.id ? item : example)));
      setRagStatus('已停用歷史案例，不會再參與相似案例比對。');
    } catch (error) {
      setRagStatus(error instanceof Error ? error.message : '停用歷史案例失敗');
    }
  };

  const handleToggleExclusionRule = async (id: string, isActive: boolean) => {
    setExclusionRuleStatus(isActive ? '啟用寄件者排除規則中...' : '停用寄件者排除規則中...');
    try {
      const rule = await updateMessageExclusionRule(id, isActive);
      setExclusionRules((current) => current.map((item) => (item.id === rule.id ? rule : item)));
      setExclusionRuleStatus(isActive ? '已重新啟用寄件者排除規則。' : '已停用寄件者排除規則；不會自動恢復歷史郵件。');
    } catch (error) {
      setExclusionRuleStatus(error instanceof Error ? error.message : '更新寄件者排除規則失敗');
    }
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <h1>設定</h1>
          <p>平台授權、AI Key、提醒規則與部署環境設定。</p>
        </div>
      </header>

      <section className="settings-grid">
        <article className="page-card system-health-card">
          <h2>系統健康總覽</h2>
          <div className="health-grid">
            <div><span>Gmail</span><strong>{gmailConnected ? '已連接' : gmailConfigured ? '待授權' : '未設定'}</strong></div>
            <div><span>自動同步</span><strong>{gmailAutoPollEnabled ? `${gmailAutoPollInterval ?? 60} 秒` : '關閉'}</strong></div>
            <div><span>提醒規則</span><strong>{ruleStatus ? `${ruleStatus.mode} / ${ruleStatus.thresholdHours}h` : '讀取中'}</strong></div>
            <div><span>RAG 案例</span><strong>{ragExamples.filter((item) => item.isActive).length} 啟用</strong></div>
          </div>
          <p>{gmailConnected && gmailAutoPollEnabled ? '核心流程正常：Gmail 會自動同步並進入訊息工作台。' : '核心流程尚未完整，請先確認 Gmail 授權與自動同步設定。'}</p>
        </article>
        <article className="page-card integration-card">
          <h2>平台串接</h2>
          <div className="integration-row">
            <div>
              <strong>Gmail OAuth</strong>
              <p>{gmailStatus}</p>
              <small>{gmailSyncStatus}</small>
              <small>狀態：{gmailConfigured ? (gmailConnected ? '已連接，可同步' : '已設定，尚未授權') : '尚未設定 OAuth'}</small>
              {!gmailConnected && gmailConfigured ? <small>授權完成前，同步 Gmail 會維持停用。Google OAuth 設定剛儲存時可能需要數分鐘生效。</small> : null}
              <small>授權頁由 Casebee API 產生：{gmailRedirectUri || '尚未讀取'}</small>
            </div>
            <div className="integration-actions">
              <button type="button" onClick={handleGmailAuth} disabled={!gmailConfigured}>{gmailConnected ? '重新授權 Gmail' : '連接 Gmail'}</button>
              <button type="button" className="integration-actions__secondary" onClick={() => void refreshGmailStatus()}>重新整理狀態</button>
              <button type="button" className="integration-actions__secondary" onClick={handleGmailPoll} disabled={!gmailConnected}>同步 Gmail</button>
            </div>
          </div>
          <div className="integration-row integration-row--disabled">
            <div>
              <strong>LINE Messaging API</strong>
              <p>Webhook 架構已保留，正式 token 設定後再啟用。</p>
              <small>需要 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN。</small>
            </div>
            <span>待設定</span>
          </div>
        </article>
        <article className="page-card knowledge-card">
          <h2>提醒規則</h2>
          <p>可手動執行規則檢查，產生未回覆逾時提醒。預設門檻由 `REPLY_OVERDUE_HOURS` 控制。</p>
          <div className="knowledge-list">
            <div>
              <strong>未回覆逾時</strong>
              <span>{ruleRunStatus}</span>
            </div>
            <div>
              <strong>目前排程</strong>
              <span>{ruleStatus ? `${ruleStatus.mode === 'manual' ? '手動執行' : ruleStatus.mode}・門檻 ${ruleStatus.thresholdHours} 小時・下次執行 ${ruleStatus.nextRunAt ? new Date(ruleStatus.nextRunAt).toLocaleString('zh-TW') : '尚未設定'}` : '讀取中'}</span>
            </div>
          </div>
          <div className="integration-actions integration-actions--left">
            <button type="button" onClick={handleRunRules}>執行規則檢查</button>
          </div>
        </article>
        <article className="page-card knowledge-card">
          <h2>寄件者排除規則</h2>
          <p>{exclusionRuleStatus}</p>
          <p>停用規則只會停止未來自動略過，不會大量恢復歷史郵件。</p>
          <div className="rag-example-list">
            {exclusionRules.length > 0 ? exclusionRules.map((rule) => (
              <article key={rule.id} className={rule.isActive ? '' : 'rag-example--inactive'}>
                <strong>{displayText(rule.matchValue, '未知寄件者')}</strong>
                <span>{rule.platform}・{rule.matchType}・{rule.isActive ? '啟用' : '停用'}</span>
                <small>原因：{displayText(rule.reason, '未記錄原因')}</small>
                <small>來源訊息：{rule.sourceMessageId ?? '未記錄'}・更新 {new Date(rule.updatedAt).toLocaleString('zh-TW')}</small>
                <button type="button" onClick={() => void handleToggleExclusionRule(rule.id, !rule.isActive)}>{rule.isActive ? '停用規則' : '重新啟用'}</button>
              </article>
            )) : <p>目前沒有寄件者排除規則。</p>}
          </div>
        </article>
        <article className="page-card knowledge-card">
          <h2>相似案例知識庫</h2>
          <p>RAG 使用啟用中的歷史案例做相似度比對，可新增或停用案例來調整建議來源。</p>
          <p>{ragStatus}</p>
          <div className="rag-form">
            <input value={ragForm.title} onChange={(event) => setRagForm((current) => ({...current, title: event.target.value}))} placeholder="案例標題" />
            <select value={ragForm.platform} onChange={(event) => setRagForm((current) => ({...current, platform: event.target.value as Platform}))}>
              {platformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </select>
            <input value={ragForm.projectItem} onChange={(event) => setRagForm((current) => ({...current, projectItem: event.target.value}))} placeholder="專案項目" />
            <input inputMode="numeric" value={ragForm.quoteAmount} onChange={(event) => setRagForm((current) => ({...current, quoteAmount: event.target.value}))} placeholder="金額，可留空" />
            <input value={ragForm.caseType} onChange={(event) => setRagForm((current) => ({...current, caseType: event.target.value}))} placeholder="案例類型，例如 collaboration_invite" />
            <input value={ragForm.projectAliases} onChange={(event) => setRagForm((current) => ({...current, projectAliases: event.target.value}))} placeholder="專案別名，逗號分隔" />
            <input value={ragForm.typicalMissingFields} onChange={(event) => setRagForm((current) => ({...current, typicalMissingFields: event.target.value}))} placeholder="常見缺漏欄位，逗號分隔" />
            <input inputMode="numeric" value={ragForm.quoteRangeMin} onChange={(event) => setRagForm((current) => ({...current, quoteRangeMin: event.target.value}))} placeholder="報價下限，可留空" />
            <input inputMode="numeric" value={ragForm.quoteRangeMax} onChange={(event) => setRagForm((current) => ({...current, quoteRangeMax: event.target.value}))} placeholder="報價上限，可留空" />
            <input value={ragForm.outcome} onChange={(event) => setRagForm((current) => ({...current, outcome: event.target.value}))} placeholder="結果，例如 成交 / 流失" />
            <textarea value={ragForm.summary} onChange={(event) => setRagForm((current) => ({...current, summary: event.target.value}))} placeholder="案例摘要" />
            <textarea value={ragForm.replyExample} onChange={(event) => setRagForm((current) => ({...current, replyExample: event.target.value}))} placeholder="建議回覆範例" />
            <textarea value={ragForm.successPattern} onChange={(event) => setRagForm((current) => ({...current, successPattern: event.target.value}))} placeholder="成功處理模式，例如 先確認授權範圍與審稿流程" />
            <button type="button" onClick={handleCreateRagExample} disabled={savingRag || !ragForm.title.trim() || !ragForm.projectItem.trim() || !ragForm.outcome.trim() || !ragForm.summary.trim() || !ragForm.replyExample.trim()}>{savingRag ? '新增中...' : '新增歷史案例'}</button>
          </div>
          <div className="knowledge-list">
            <div>
              <strong>歷史案例資料</strong>
              <span>目前啟用 {ragExamples.filter((item) => item.isActive).length} 筆，停用 {ragExamples.filter((item) => !item.isActive).length} 筆</span>
            </div>
            <div>
              <strong>相似度規則</strong>
              <span>專案項目、別名、案例類型、金額距離、需求摘要關鍵字</span>
            </div>
            <div>
              <strong>管理方式</strong>
              <span>停用後保留紀錄，但不再參與相似案例比對</span>
            </div>
          </div>
          <div className="rag-example-list">
            {ragExamples.map((item) => (
              <article key={item.id} className={item.isActive ? '' : 'rag-example--inactive'}>
                <strong>{displayText(item.title, '未命名案例')}</strong>
                <span>{displayText(item.projectItem, '未命名專案')}・{displayText(item.caseType, '未分類')}・{item.quoteAmount ? `NT$ ${item.quoteAmount.toLocaleString('zh-TW')}` : '未定價'}・{displayText(item.outcome, '')}・{item.isActive ? '啟用' : '停用'}</span>
                {item.projectAliases.length > 0 ? <small>別名：{item.projectAliases.join('、')}</small> : null}
                {item.typicalMissingFields.length > 0 ? <small>常見缺漏：{item.typicalMissingFields.join('、')}</small> : null}
                <p>{displayText(item.summary, '尚無摘要')}</p>
                {item.isActive ? <button type="button" onClick={() => void handleDeactivateRagExample(item.id)}>停用</button> : null}
              </article>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
