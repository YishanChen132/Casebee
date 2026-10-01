import {useState} from 'react';
import {AppShell, type PageId} from './components/layout/AppShell';
import {CustomersPage} from './pages/CustomersPage';
import {DashboardPage} from './pages/DashboardPage';
import {KanbanPage} from './pages/KanbanPage';
import {MessagesPage} from './pages/MessagesPage';
import {SettingsPage} from './pages/SettingsPage';

export interface NavigationTarget {
  messageId?: string;
  caseId?: string;
  customerId?: string;
}

export type NavigateToPage = (page: PageId, target?: NavigationTarget) => void;

export function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget>({});

  const handleNavigate: NavigateToPage = (page, target = {}) => {
    setActivePage(page);
    setNavigationTarget(target);
  };

  return (
    <AppShell activePage={activePage} onNavigate={(page) => handleNavigate(page)}>
      {activePage === 'dashboard' ? <DashboardPage onNavigate={handleNavigate} /> : null}
      {activePage === 'kanban' ? <KanbanPage onNavigate={handleNavigate} targetCaseId={navigationTarget.caseId} /> : null}
      {activePage === 'customers' ? <CustomersPage onNavigate={handleNavigate} targetCustomerId={navigationTarget.customerId} /> : null}
      {activePage === 'messages' ? <MessagesPage onNavigate={handleNavigate} targetMessageId={navigationTarget.messageId} /> : null}
      {activePage === 'settings' ? <SettingsPage /> : null}
    </AppShell>
  );
}
