import type {ReactNode} from 'react';
import casebeeLogo from '../../assets/casebee.png';

export type PageId = 'dashboard' | 'kanban' | 'customers' | 'messages' | 'settings';

const navigationItems = [
  {id: 'kanban', label: '案件看板'},
  {id: 'customers', label: '客戶管理'},
  {id: 'messages', label: '訊息整合'},
  {id: 'dashboard', label: '統計分析'},
  {id: 'settings', label: '設定'},
] satisfies Array<{id: PageId; label: string}>;

interface AppShellProps {
  activePage: PageId;
  children: ReactNode;
  onNavigate: (page: PageId) => void;
}

const platformConnections = [
  {label: 'Gmail', status: '待串接'},
  {label: 'LINE', status: '待串接'},
  {label: 'Instagram', status: '保留'},
];

export function AppShell({activePage, children, onNavigate}: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__frame">
        <aside className="app-shell__sidebar">
          <div className="app-shell__brand">
            <img className="app-shell__brand-image" src={casebeeLogo} alt="Casebee" />
          </div>

          <div className="app-shell__section">
            <span className="app-shell__section-label">主選單</span>
            <nav className="app-shell__nav" aria-label="Primary navigation">
              {navigationItems.map((item) => (
                <button key={item.id} type="button" className={activePage === item.id ? 'app-shell__nav-link app-shell__nav-link--active' : 'app-shell__nav-link'} onClick={() => onNavigate(item.id)}>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="app-shell__section">
            <span className="app-shell__section-label">平台連接</span>
            <div className="app-shell__platforms">
              {platformConnections.map((item) => (
                <div key={item.label} className="app-shell__platform-row">
                  <span>{item.label}</span>
                  <span className="app-shell__platform-status">{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="app-shell__main">
          {children}
        </main>
      </div>
    </div>
  );
}
