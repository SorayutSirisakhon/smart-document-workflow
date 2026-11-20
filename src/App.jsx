import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Copy,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  Filter,
  FolderOpen,
  LayoutDashboard,
  Link2,
  Mail,
  Menu,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
  Zap,
} from 'lucide-react';
import {
  addDays,
  canTransitionQuoteStatus,
  defaultSettings,
  quoteCanEdit,
  calculateQuote,
  dateLabel,
  lineAmount,
  lineParts,
  money,
  normalizeStore,
  numberValue,
  quantityMilli,
  todayISO,
} from './domain.mjs';
import { readLocalStore, writeLocalStore } from './storage.mjs';


const statusMeta = {
  draft: { label: 'ร่าง', tone: 'neutral' },
  sent: { label: 'รอตอบกลับ', tone: 'blue' },
  approved: { label: 'อนุมัติแล้ว', tone: 'green' },
  rejected: { label: 'ไม่อนุมัติ', tone: 'red' },
  expired: { label: 'หมดอายุ', tone: 'amber' },
};

function loadStore() {
  return readLocalStore(() => globalThis.localStorage);
}

function nextQuoteNumber(quotes, settings, sequences = {}) {
  const year = todayISO().slice(0, 4);
  const prefix = settings.quotePrefix || 'QT';
  const sameYear = quotes
    .map((quote) => quote.number || '')
    .filter((number) => number.startsWith(`${prefix}-${year}-`))
    .map((number) => Number(number.split('-').pop()))
    .filter(Number.isFinite);
  const sequenceKey = `${prefix}-${year}`;
  const next = Math.max(sameYear.length ? Math.max(...sameYear) + 1 : 1, Number(sequences[sequenceKey]) || 1);
  return `${prefix}-${year}-${String(next).padStart(3, '0')}`;
}

function cloneNewQuote(store) {
  const { quotes, settings, sequences = {} } = store;
  const issueDate = todayISO();
  const number = nextQuoteNumber(quotes, settings, sequences);
  return {
    id: `qt-${crypto.randomUUID()}`,
    number,
    customerId: '',
    status: 'draft',
    issueDate,
    validUntil: addDays(issueDate, settings.defaultValidity),
    followUpDate: '',
    note: '',
    items: [{ id: `line-${crypto.randomUUID()}`, name: '', description: '', qty: 1, unit: 'รายการ', price: 0, discount: 0, vat: true }],
    discount: 0,
    vatRate: Number(settings.defaultVat),
    createdAt: new Date().toISOString(),
  };
}

function StatusBadge({ status }) {
  const meta = statusMeta[status] || statusMeta.draft;
  return <span className={`status-badge status-${meta.tone}`}><span className="status-dot" />{meta.label}</span>;
}

function IconButton({ label, children, className = '', ...props }) {
  return <button type="button" aria-label={label} title={label} className={`icon-button ${className}`} {...props}>{children}</button>;
}

function App() {
  const [initialLoad] = useState(loadStore);
  const [store, setStore] = useState(initialLoad.store);
  const [storageIssue, setStorageIssue] = useState(initialLoad.error);
  const [persistenceBlocked, setPersistenceBlocked] = useState(initialLoad.blocked);
  const [page, setPage] = useState('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [editorQuote, setEditorQuote] = useState(null);
  const [detailQuoteId, setDetailQuoteId] = useState(null);
  const [printQuote, setPrintQuote] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (persistenceBlocked) return;
    const result = writeLocalStore(() => globalThis.localStorage, store);
    setStorageIssue(result.error);
  }, [store, persistenceBlocked]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!printQuote) return undefined;
    const timeout = setTimeout(() => window.print(), 80);
    const clearPrint = () => setPrintQuote(null);
    window.addEventListener('afterprint', clearPrint);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('afterprint', clearPrint);
    };
  }, [printQuote]);

  const selectedQuote = store.quotes.find((quote) => quote.id === detailQuoteId) || null;
  const showToast = (message, tone = 'success') => setToast({ message, tone });

  const applyStore = (candidate) => {
    try {
      setStore(normalizeStore(candidate));
      return true;
    } catch (error) {
      showToast(error.message || 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบก่อนบันทึก', 'error');
      return false;
    }
  };

  const saveQuote = (quote) => {
    const customerSnapshot = store.customers.find((customer) => customer.id === quote.customerId);
    const companySnapshot = { ...store.settings };
    const existing = store.quotes.find((item) => item.id === quote.id);
    if (existing && !quoteCanEdit(existing)) {
      showToast('เอกสารที่ออกแล้วแก้ไขไม่ได้ กรุณาสร้างฉบับแก้ไข', 'error');
      return;
    }
    if (quote.status !== 'draft' && !companySnapshot.companyName.trim()) {
      showToast('กรอกชื่อกิจการในหน้าตั้งค่าก่อนออกใบเสนอราคา', 'error');
      return;
    }
    const savedQuote = {
      ...quote,
      issuedAt: quote.issuedAt || (quote.status !== 'draft' ? new Date().toISOString() : null),
      customerSnapshot: customerSnapshot ? { ...customerSnapshot } : quote.customerSnapshot,
      companySnapshot,
    };
    if (!applyStore({
      ...store,
      quotes: existing ? store.quotes.map((item) => item.id === quote.id ? savedQuote : item) : [savedQuote, ...store.quotes],
    })) return;
    setEditorQuote(null);
    setDetailQuoteId(quote.id);
    showToast(`${quote.number} บันทึกแล้ว`);
  };

  const updateQuoteStatus = (quoteId, status) => {
    const quote = store.quotes.find((item) => item.id === quoteId);
    if (!quote || !canTransitionQuoteStatus(quote, status)) {
      showToast('เอกสารที่ออกแล้วกลับเป็นร่างไม่ได้ กรุณาสร้างฉบับแก้ไข', 'error');
      return;
    }
    const next = { ...quote, status };
    if (quoteCanEdit(quote) && status !== 'draft') {
      if (!store.settings.companyName.trim()) {
        showToast('กรอกชื่อกิจการในหน้าตั้งค่าก่อนออกใบเสนอราคา', 'error');
        return;
      }
      next.issuedAt = new Date().toISOString();
      next.companySnapshot = { ...store.settings };
      const customer = store.customers.find((item) => item.id === quote.customerId);
      if (customer) next.customerSnapshot = { ...customer };
    }
    if (!applyStore({ ...store, quotes: store.quotes.map((item) => item.id === quoteId ? next : item) })) return;
    showToast(`เปลี่ยนสถานะเป็น “${statusMeta[status].label}” แล้ว`);
  };

  const deleteQuote = (quoteId) => {
    const quote = store.quotes.find((item) => item.id === quoteId);
    if (!quote || !window.confirm(`ลบ ${quote.number} หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
    setStore((current) => ({ ...current, quotes: current.quotes.filter((item) => item.id !== quoteId) }));
    setDetailQuoteId(null);
    showToast('ลบใบเสนอราคาแล้ว', 'neutral');
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `smart-document-backup-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('ส่งออกข้อมูลสำรองแล้ว');
  };

  const handleImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const normalized = normalizeStore(imported, defaultSettings);
        if (!window.confirm('นำเข้าข้อมูลจะแทนที่ข้อมูลปัจจุบันทั้งหมด ดำเนินการต่อหรือไม่?')) return;
        setPersistenceBlocked(false);
        setStore(normalized);
        showToast('นำเข้าข้อมูลสำเร็จแล้ว');
      } catch {
        showToast('ไฟล์สำรองไม่ถูกต้อง', 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const openNewQuote = () => {
    setPage('quotes');
    const quote = cloneNewQuote(store);
    const sequenceKey = `${store.settings.quotePrefix || 'QT'}-${todayISO().slice(0, 4)}`;
    setStore((current) => ({ ...current, sequences: { ...current.sequences, [sequenceKey]: Number(quote.number.split('-').pop()) + 1 } }));
    setEditorQuote(quote);
    setMobileNav(false);
  };

  const openRevision = (source) => {
    const next = cloneNewQuote(store);
    const sequenceKey = `${store.settings.quotePrefix || 'QT'}-${todayISO().slice(0, 4)}`;
    setStore((current) => ({ ...current, sequences: { ...current.sequences, [sequenceKey]: Number(next.number.split('-').pop()) + 1 } }));
    setDetailQuoteId(null);
    setEditorQuote({
      ...next,
      customerId: source.customerId,
      note: source.note,
      items: source.items.map((item) => ({ ...item, id: `line-${crypto.randomUUID()}` })),
      discount: source.discount,
      vatRate: source.vatRate,
    });
  };

  const openQuote = (quote) => {
    setDetailQuoteId(quote.id);
    setMobileNav(false);
  };

  const navItems = [
    { id: 'overview', label: 'ภาพรวม', icon: LayoutDashboard },
    { id: 'quotes', label: 'ใบเสนอราคา', icon: FileText, count: store.quotes.length },
    { id: 'customers', label: 'ลูกค้า', icon: UsersRound, count: store.customers.length },
    { id: 'catalog', label: 'สินค้าและบริการ', icon: Package },
  ];

  const pageTitle = { overview: 'ภาพรวม', quotes: 'ใบเสนอราคา', customers: 'ลูกค้า', catalog: 'สินค้าและบริการ', settings: 'ตั้งค่าระบบ' }[page];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Zap size={17} strokeWidth={2.5} /></div>
          <div><strong>Auto<span>work</span></strong><small>Smart Document Workflow</small></div>
          <IconButton label="ปิดเมนู" className="mobile-close" onClick={() => setMobileNav(false)}><X size={18} /></IconButton>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">AW</div>
          <div><strong>{store.settings.companyName || 'ตั้งค่ากิจการของคุณ'}</strong><small>พื้นที่ทำงานในเบราว์เซอร์</small></div>
          <ChevronDown size={16} />
        </div>
        <nav className="primary-nav" aria-label="เมนูหลัก">
          <span className="nav-label">จัดการงาน</span>
          {navItems.map(({ id, label, icon: Icon, count }) => (
            <button key={id} type="button" className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => { setPage(id); setMobileNav(false); }}>
              <Icon size={18} strokeWidth={page === id ? 2.3 : 1.8} /><span>{label}</span>{count ? <em>{count}</em> : null}
            </button>
          ))}
          <span className="nav-label nav-label-spaced">ระบบ</span>
          <button type="button" className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => { setPage('settings'); setMobileNav(false); }}><Settings size={18} /><span>ตั้งค่า</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-box"><div className="help-icon"><CircleHelp size={17} /></div><div><strong>ข้อมูลอยู่ในเบราว์เซอร์</strong><span>สำรอง JSON ได้ที่หน้าตั้งค่า</span></div><ArrowUpRight size={15} /></div>
          <div className="user-profile"><div className="profile-avatar"><UserRound size={14} /></div><div><strong>พื้นที่ทำงานส่วนตัว</strong><small>ยังไม่มีระบบล็อกอิน</small></div><MoreHorizontal size={17} /></div>
        </div>
      </aside>
      {mobileNav ? <button type="button" className="sidebar-scrim" aria-label="ปิดเมนู" onClick={() => setMobileNav(false)} /> : null}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left"><IconButton label="เปิดเมนู" className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={20} /></IconButton><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{pageTitle}</strong></div></div>
          <div className="topbar-actions"><button type="button" className="icon-button notification-button" aria-label="เปิดใบเสนอราคา" onClick={() => setPage('quotes')}><Bell size={18} /></button><div className="topbar-divider" /><div className="avatar-button" aria-label="พื้นที่ทำงานในเครื่อง" style={{display:"grid",placeItems:"center"}}><UserRound size={16} /></div></div>
        </header>
        <div className="content-wrap">
          {storageIssue ? <div role="alert" className="storage-warning"><strong>ยังบันทึกข้อมูลไม่ได้</strong><span>{storageIssue} ข้อมูลต้นฉบับที่อ่านไม่ได้จะไม่ถูกเขียนทับ คุณยังส่งออกข้อมูลที่กำลังทำงานได้จากหน้าตั้งค่า</span></div> : null}
          {page === 'overview' && <Dashboard store={store} onNew={openNewQuote} onOpen={openQuote} onPage={setPage} />}
          {page === 'quotes' && <QuotesPage store={store} onNew={openNewQuote} onOpen={openQuote} onEdit={(quote) => setEditorQuote(quote)} onPrint={setPrintQuote} onStatus={updateQuoteStatus} />}
          {page === 'customers' && <CustomersPage store={store} onChange={(customers) => applyStore({ ...store, customers })} showToast={showToast} />}
          {page === 'catalog' && <CatalogPage store={store} onChange={(products) => applyStore({ ...store, products })} showToast={showToast} />}
          {page === 'settings' && <SettingsPage store={store} onSettings={(settings) => applyStore({ ...store, settings })} onExport={handleExport} onImport={handleImport} showToast={showToast} />}
        </div>
      </main>
      {editorQuote ? <QuoteEditor quote={editorQuote} store={store} onClose={() => setEditorQuote(null)} onSave={saveQuote} /> : null}
      {selectedQuote ? <QuoteDetail quote={selectedQuote} store={store} onClose={() => setDetailQuoteId(null)} onEdit={() => { setDetailQuoteId(null); setEditorQuote(selectedQuote); }} onRevise={() => openRevision(selectedQuote)} onPrint={() => setPrintQuote(selectedQuote)} onStatus={updateQuoteStatus} onDelete={deleteQuote} showToast={showToast} /> : null}
      {printQuote ? <PrintSheet quote={printQuote} store={store} onClose={() => setPrintQuote(null)} /> : null}
      {toast ? <div className={`toast toast-${toast.tone}`}><span>{toast.tone === 'error' ? <X size={16} /> : <Check size={16} />}</span>{toast.message}</div> : null}
    </div>
  );
}

function Dashboard({ store, onNew, onOpen, onPage }) {
  const counts = useMemo(() => store.quotes.reduce((result, quote) => { result[quote.status] = (result[quote.status] || 0) + 1; return result; }, {}), [store.quotes]);
  const totalValue = store.quotes.reduce((sum, quote) => sum + calculateQuote(quote).total, 0);
  const followUps = store.quotes.filter((quote) => quote.status === 'sent' && quote.followUpDate).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  const latest = [...store.quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />{new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</div><h1>ภาพรวมการทำงาน</h1><p>ติดตามใบเสนอราคาและงานเอกสารทั้งหมดของคุณในที่เดียว</p></div><button type="button" className="button button-primary" onClick={onNew}><Plus size={17} />สร้างใบเสนอราคา</button></div>
    <div className="sample-notice"><div><ShieldCheck size={16} /><span><strong>พื้นที่ทำงานในเบราว์เซอร์</strong> เริ่มต้นด้วยข้อมูลว่าง ฐานข้อมูลและบริการภายนอกยังไม่เชื่อมต่อ</span></div><button type="button" onClick={() => onPage('settings')}>ตั้งค่ากิจการ <ArrowUpRight size={14} /></button></div>
    <div className="kpi-grid">
      <KpiCard label="มูลค่าใบเสนอราคาทั้งหมด" value={`฿${money(totalValue)}`} caption="รวมทุกสถานะ" icon={ReceiptText} tone="green" trend={`${store.quotes.length} ใบ`} />
      <KpiCard label="รอตอบกลับ" value={String(counts.sent || 0).padStart(2, '0')} caption="ใบเสนอราคาที่ส่งแล้ว" icon={Send} tone="blue" trend="ต้องติดตาม" />
      <KpiCard label="อนุมัติแล้ว" value={String(counts.approved || 0).padStart(2, '0')} caption="ปิดการขายสำเร็จ" icon={Check} tone="purple" trend="อัปเดตล่าสุด" />
      <KpiCard label="ต้องติดตามวันนี้" value={String(followUps.filter((item) => item.followUpDate <= todayISO()).length).padStart(2, '0')} caption="รายการที่ถึงกำหนด" icon={Bell} tone="amber" trend="ดูรายการ" />
    </div>
    <div className="dashboard-grid">
      <section className="panel recent-panel"><div className="panel-heading"><div><h2>ใบเสนอราคาล่าสุด</h2><p>รายการที่มีการสร้างหรือแก้ไขล่าสุด</p></div><button type="button" className="text-button" onClick={() => onPage('quotes')}>ดูทั้งหมด <ArrowUpRight size={15} /></button></div><QuoteTable quotes={latest} store={store} onOpen={onOpen} compact /></section>
      <section className="panel followup-panel"><div className="panel-heading"><div><h2>กำหนดติดตาม</h2><p>อย่าปล่อยให้โอกาสหลุดมือ</p></div><div className="panel-icon"><CalendarDays size={18} /></div></div>{followUps.length ? <div className="followup-list">{followUps.slice(0, 4).map((quote) => { const customer = quote.customerSnapshot || store.customers.find((item) => item.id === quote.customerId); return <button key={quote.id} type="button" className="followup-item" onClick={() => onOpen(quote)}><div className="followup-date"><strong>{quote.followUpDate.slice(8, 10)}</strong><span>{dateLabel(quote.followUpDate, { year: undefined }).split(' ')[1]}</span></div><div className="followup-copy"><strong>{customer?.name || 'ยังไม่เลือกลูกค้า'}</strong><span>{quote.number} · {dateLabel(quote.followUpDate)}</span></div><ArrowUpRight size={15} /></button>; })}</div> : <EmptyState icon={CalendarDays} title="ยังไม่มีรายการติดตาม" description="กำหนดวันติดตามในใบเสนอราคาได้เลย" />}</section>
    </div>
    <div className="workflow-section"><div className="section-heading"><div><h2>ขั้นตอนการทำงาน</h2><p>ดูสถานะของเอกสารตั้งแต่เริ่มต้นจนปิดงาน</p></div><button type="button" className="text-button" onClick={onNew}>เริ่มเอกสารใหม่ <ArrowUpRight size={15} /></button></div><div className="workflow-track"><WorkflowStep number="01" title="สร้างร่าง" caption={`${counts.draft || 0} ใบเสนอราคา`} active /><div className="workflow-line" /><WorkflowStep number="02" title="ส่งให้ลูกค้า" caption={`${counts.sent || 0} รอตอบกลับ`} /><div className="workflow-line" /><WorkflowStep number="03" title="อนุมัติ" caption={`${counts.approved || 0} ปิดการขาย`} /><div className="workflow-line" /><WorkflowStep number="04" title="สำรองข้อมูล" caption="ส่งออก JSON ได้" /></div></div>
  </>;
}

function KpiCard({ label, value, caption, icon: Icon, tone, trend }) {
  return <div className="kpi-card"><div className={`kpi-icon kpi-${tone}`}><Icon size={18} /></div><div className="kpi-content"><span>{label}</span><strong>{value}</strong><small>{caption}</small></div><span className={`kpi-trend trend-${tone}`}>{trend}</span></div>;
}

function WorkflowStep({ number, title, caption, active }) {
  return <div className={`workflow-step ${active ? 'workflow-active' : ''}`}><div className="workflow-number">{active ? <Check size={15} /> : number}</div><div><strong>{title}</strong><span>{caption}</span></div></div>;
}

function QuotesPage({ store, onNew, onOpen, onEdit, onPrint, onStatus }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('recent');
  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return [...store.quotes].filter((quote) => {
      const customer = quote.customerSnapshot || store.customers.find((item) => item.id === quote.customerId);
      const matchesSearch = !normalized || quote.number.toLowerCase().includes(normalized) || customer?.name.toLowerCase().includes(normalized);
      return matchesSearch && (status === 'all' || quote.status === status);
    }).sort((a, b) => sort === 'value' ? calculateQuote(b).total - calculateQuote(a).total : b.createdAt.localeCompare(a.createdAt));
  }, [search, sort, status, store]);
  return <>
    <div className="page-heading"><div><div className="eyebrow">จัดการเอกสาร</div><h1>ใบเสนอราคา</h1><p>สร้าง ติดตาม และจัดการใบเสนอราคาของธุรกิจ</p></div><button type="button" className="button button-primary" onClick={onNew}><Plus size={17} />สร้างใบเสนอราคา</button></div>
    <div className="page-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเลขที่เอกสารหรือชื่อลูกค้า" /></div><div className="toolbar-actions"><div className="select-wrap"><Filter size={15} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">ทุกสถานะ</option><option value="draft">ร่าง</option><option value="sent">รอตอบกลับ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ไม่อนุมัติ</option><option value="expired">หมดอายุ</option></select><ChevronDown size={15} /></div><div className="select-wrap"><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">ล่าสุดก่อน</option><option value="value">มูลค่าสูงสุด</option></select><ChevronDown size={15} /></div></div></div>
    <section className="panel quotes-list-panel"><div className="panel-heading table-heading"><div><h2>รายการใบเสนอราคา <span className="count-chip">{filtered.length}</span></h2><p>คลิกที่รายการเพื่อดูรายละเอียดเอกสาร</p></div><button type="button" className="button button-secondary button-small" onClick={onNew}><FilePlus2 size={15} />สร้างรายการ</button></div><QuoteTable quotes={filtered} store={store} onOpen={onOpen} onEdit={onEdit} onPrint={onPrint} onStatus={onStatus} /></section>
  </>;
}

function QuoteTable({ quotes, store, onOpen, compact = false, onEdit, onPrint, onStatus }) {
  if (!quotes.length) return <EmptyState icon={FileText} title="ยังไม่มีใบเสนอราคา" description="เริ่มสร้างใบเสนอราคาใบแรกของคุณ" />;
  return <div className={`data-table-wrap ${compact ? 'table-compact' : ''}`}><table className="data-table"><thead><tr><th>เลขที่</th><th>ลูกค้า</th><th>วันที่ออก</th><th>มูลค่ารวม</th><th>สถานะ</th><th className="actions-col"><span className="sr-only">การทำงาน</span></th></tr></thead><tbody>{quotes.map((quote) => { const customer = quote.customerSnapshot || store.customers.find((item) => item.id === quote.customerId); const total = calculateQuote(quote).total; return <tr key={quote.id} onClick={() => onOpen(quote)}><td><button type="button" className="document-link" onClick={(event) => { event.stopPropagation(); onOpen(quote); }}>{quote.number}</button><small>{quote.items.length} รายการ</small></td><td><div className="customer-cell"><div className="customer-avatar">{(customer?.name || '?').slice(0, 1)}</div><div><strong>{customer?.name || 'ยังไม่เลือกลูกค้า'}</strong><small>{customer?.contact || 'เพิ่มข้อมูลลูกค้า'}</small></div></div></td><td><span className="date-cell">{dateLabel(quote.issueDate)}</span></td><td><strong className="amount-cell">฿{money(total)}</strong></td><td><StatusBadge status={quote.status} /></td><td className="actions-col" onClick={(event) => event.stopPropagation()}><div className="row-actions"><IconButton label="เปิดรายละเอียด" onClick={() => onOpen(quote)}><ArrowUpRight size={16} /></IconButton>{onEdit && quoteCanEdit(quote) ? <IconButton label="แก้ไขใบเสนอราคา" onClick={() => onEdit(quote)}><Pencil size={15} /></IconButton> : null}{onPrint ? <IconButton label="พิมพ์ใบเสนอราคา" onClick={() => onPrint(quote)}><Printer size={15} /></IconButton> : null}{onStatus ? <select className="row-status-select" aria-label="เปลี่ยนสถานะ" value={quote.status} onChange={(event) => onStatus(quote.id, event.target.value)}>{quoteCanEdit(quote) ? <option value="draft">ร่าง</option> : null}<option value="sent">รอตอบกลับ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ไม่อนุมัติ</option><option value="expired">หมดอายุ</option></select> : null}</div></td></tr>; })}</tbody></table></div>;
}

function EmptyState({ icon: Icon, title, description }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={21} /></div><strong>{title}</strong><span>{description}</span></div>;
}

function QuoteEditor({ quote: initialQuote, store, onClose, onSave }) {
  const [quote, setQuote] = useState(() => JSON.parse(JSON.stringify(initialQuote)));
  const [errors, setErrors] = useState({});
  const totals = calculateQuote(quote);
  const update = (key, value) => setQuote((current) => ({ ...current, [key]: value }));
  const updateItem = (id, key, value) => setQuote((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, [key]: value } : item) }));
  const addItem = () => setQuote((current) => ({ ...current, items: [...current.items, { id: `line-${crypto.randomUUID()}`, name: '', description: '', qty: 1, unit: 'รายการ', price: 0, discount: 0, vat: true }] }));
  const removeItem = (id) => setQuote((current) => current.items.length > 1 ? { ...current, items: current.items.filter((item) => item.id !== id) } : current);
  const chooseProduct = (id, productId) => {
    const product = store.products.find((item) => item.id === productId);
    if (!product) return;
    updateItem(id, 'name', product.name);
    setQuote((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, name: product.name, unit: product.unit, price: product.price, vat: product.vat } : item) }));
  };
  const validate = () => {
    const nextErrors = {};
    if (!quote.customerId) nextErrors.customerId = 'เลือกลูกค้าก่อนบันทึก';
    if (!quote.issueDate) nextErrors.issueDate = 'ระบุวันที่ออกเอกสาร';
    if (!quote.validUntil) nextErrors.validUntil = 'ระบุวันหมดอายุ';
    else if (quote.issueDate && quote.validUntil < quote.issueDate) nextErrors.validUntil = 'วันหมดอายุต้องไม่ก่อนวันที่ออก';
    if (!quote.items.some((item) => item.name.trim() && Number(item.qty) > 0 && Number(item.price) > 0)) nextErrors.items = 'เพิ่มรายการที่มีชื่อ จำนวน และราคาอย่างน้อย 1 รายการ';
    if (quote.items.some((item) => !item.name.trim() || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0 || Number(item.qty) > 1000000 || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 || Number(item.price) > 10000000000 || !Number.isFinite(Number(item.discount)) || Number(item.discount) < 0)) nextErrors.items = 'ตรวจจำนวน ราคา และส่วนลดของแต่ละรายการ';
    if (quote.vatRate === '' || !Number.isInteger(Number(quote.vatRate)) || Number(quote.vatRate) < 0 || Number(quote.vatRate) > 100) nextErrors.vatRate = 'VAT ต้องเป็นจำนวนเต็มระหว่าง 0-100%';
    setErrors(nextErrors);
    return !Object.keys(nextErrors).length;
  };
  const isExistingQuote = store.quotes.some((item) => item.id === initialQuote.id);
  const savedStatus = isExistingQuote && initialQuote.status !== 'draft' ? initialQuote.status : 'sent';
  const submit = () => { if (validate()) onSave({ ...quote, status: savedStatus, items: quote.items.map((item) => ({ ...item, qty: quantityMilli(item.qty) / 1000, price: numberValue(item.price), discount: numberValue(item.discount) })) , discount: numberValue(quote.discount), vatRate: numberValue(quote.vatRate) }); };
  const saveDraft = () => { if (validate()) onSave({ ...quote, status: store.quotes.some((item) => item.id === initialQuote.id) ? initialQuote.status : 'draft', items: quote.items.map((item) => ({ ...item, qty: Number(item.qty) || 0, price: numberValue(item.price), discount: numberValue(item.discount) })), discount: numberValue(quote.discount), vatRate: numberValue(quote.vatRate) }); };
  return <div className="modal-backdrop"><div className="modal editor-modal"><div className="modal-header"><div><span className="modal-kicker">{isExistingQuote ? 'แก้ไขเอกสาร' : 'เอกสารใหม่'}</span><h2>{quote.number}</h2></div><IconButton label="ปิดหน้าต่าง" onClick={onClose}><X size={19} /></IconButton></div><div className="modal-body editor-body"><div className="editor-main"><section className="editor-section"><div className="editor-section-title"><div><h3>ข้อมูลลูกค้า</h3><p>รายละเอียดจะถูกบันทึกเป็น snapshot ในเอกสารนี้</p></div></div><div className="form-grid form-grid-customer"><label className={errors.customerId ? 'has-error' : ''}><span>ลูกค้า <b>*</b></span><select value={quote.customerId} onChange={(event) => update('customerId', event.target.value)}><option value="">เลือกลูกค้า</option>{store.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>{errors.customerId ? <em>{errors.customerId}</em> : null}</label><label className={errors.issueDate ? 'has-error' : ''}><span>วันที่ออก</span><input type="date" value={quote.issueDate} onChange={(event) => update('issueDate', event.target.value)} />{errors.issueDate ? <em>{errors.issueDate}</em> : null}</label><label className={errors.validUntil ? 'has-error' : ''}><span>ใช้ได้ถึง <b>*</b></span><input type="date" value={quote.validUntil} onChange={(event) => update('validUntil', event.target.value)} />{errors.validUntil ? <em>{errors.validUntil}</em> : null}</label><label><span>วันติดตาม</span><input type="date" value={quote.followUpDate} onChange={(event) => update('followUpDate', event.target.value)} /></label></div></section><section className="editor-section"><div className="editor-section-title"><div><h3>รายการสินค้าและบริการ</h3><p>เพิ่มรายการและราคาที่ต้องการเสนอให้ลูกค้า</p></div><button type="button" className="text-button" onClick={addItem}><Plus size={15} />เพิ่มรายการ</button></div><div className="line-items"><div className="line-item-head"><span>รายละเอียด</span><span>จำนวน</span><span>หน่วย</span><span>ราคาต่อหน่วย</span><span>ส่วนลด</span><span>รวม</span><span /></div>{quote.items.map((item, index) => <div className="line-item" key={item.id}><div className="line-name"><select value="" onChange={(event) => chooseProduct(item.id, event.target.value)} aria-label={`เลือกสินค้าสำเร็จรูป ${index + 1}`}><option value="">เลือกจากรายการ...</option>{store.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input maxLength={500} value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} placeholder="ชื่อสินค้า/บริการ" /><input maxLength={2000} value={item.description} onChange={(event) => updateItem(item.id, 'description', event.target.value)} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" /><label className="item-tax-toggle"><input type="checkbox" checked={item.vat} onChange={(event) => updateItem(item.id, 'vat', event.target.checked)} /><span>คิด VAT</span></label></div><input className="number-input" type="number" min="0.001" max="1000000" step="0.001" value={item.qty} onChange={(event) => updateItem(item.id, 'qty', event.target.value)} /><input maxLength={100} value={item.unit} onChange={(event) => updateItem(item.id, 'unit', event.target.value)} placeholder="หน่วย" /><div className="money-input"><span>฿</span><input type="number" min="0" step="0.01" value={(numberValue(item.price) / 100).toFixed(2)} onChange={(event) => updateItem(item.id, 'price', Math.round(Number(event.target.value || 0) * 100))} /></div><div className="money-input"><span>฿</span><input type="number" min="0" step="0.01" value={(numberValue(item.discount) / 100).toFixed(2)} onChange={(event) => updateItem(item.id, 'discount', Math.round(Number(event.target.value || 0) * 100))} /></div><strong className="line-total">฿{money(lineAmount(item))}</strong><IconButton label="ลบรายการ" className="delete-line" onClick={() => removeItem(item.id)}><Trash2 size={15} /></IconButton></div>)}</div>{errors.items ? <div className="form-error form-error-block">{errors.items}</div> : null}</section><section className="editor-section"><div className="editor-section-title"><div><h3>หมายเหตุและเงื่อนไข</h3><p>ข้อความนี้จะแสดงในเอกสารที่ส่งให้ลูกค้า</p></div></div><textarea className="note-input" rows="3" maxLength={10000} value={quote.note} onChange={(event) => update('note', event.target.value)} placeholder="เช่น เงื่อนไขการชำระเงิน, ระยะเวลาส่งมอบงาน หรือขอบเขตงาน" /></section></div><aside className="editor-summary"><div className="summary-label">สรุปใบเสนอราคา</div><div className="summary-number">{quote.number}</div><div className="summary-status"><span>สถานะเอกสาร</span><StatusBadge status={quote.status} /></div><div className="summary-divider" /><div className="summary-row"><span>รวมรายการ</span><strong>฿{money(totals.itemSubtotal)}</strong></div><label className="summary-discount"><span>ส่วนลดท้ายบิล</span><div className="money-input"><span>฿</span><input type="number" min="0" step="0.01" value={(numberValue(quote.discount) / 100).toFixed(2)} onChange={(event) => update('discount', Math.round(Number(event.target.value || 0) * 100))} /></div></label><div className="summary-row"><span>มูลค่าก่อน VAT</span><strong>฿{money(totals.beforeVat)}</strong></div><label className="summary-vat"><span>VAT</span><div className="vat-input"><input type="number" min="0" max="100" value={quote.vatRate} onChange={(event) => update('vatRate', event.target.value)} /><span>%</span></div><strong>฿{money(totals.vat)}</strong>{errors.vatRate ? <em className="form-vat-error">{errors.vatRate}</em> : null}</label><div className="summary-total"><span>ยอดรวมทั้งสิ้น</span><strong>฿{money(totals.total)}</strong></div><div className="summary-hint"><ShieldCheck size={15} /><span>ยอดเงินคำนวณจากหน่วยสตางค์<br />เพื่อป้องกันความคลาดเคลื่อน</span></div></aside></div><div className="modal-footer"><button type="button" className="button button-ghost" onClick={onClose}>ยกเลิก</button><div className="footer-actions">{!isExistingQuote || initialQuote.status === 'draft' ? <button type="button" className="button button-secondary" onClick={saveDraft}>บันทึกร่าง</button> : null}<button type="button" className="button button-primary" onClick={submit}><Send size={16} />{savedStatus === 'sent' ? 'บันทึกเป็นรอตอบกลับ' : 'บันทึกการแก้ไข'}</button></div></div></div></div>;
}

function QuoteDetail({ quote, store, onClose, onEdit, onRevise, onPrint, onStatus, onDelete, showToast }) {
  const customer = quote.customerSnapshot || store.customers.find((item) => item.id === quote.customerId);
  const totals = calculateQuote(quote);
  const shareText = `ใบเสนอราคา ${quote.number}\n${customer?.name || ''}\nยอดรวม ฿${money(totals.total)}\nใช้ได้ถึง ${dateLabel(quote.validUntil)}`;
  const copyShare = async () => { try { await navigator.clipboard.writeText(shareText); showToast('คัดลอกข้อความสำหรับส่ง LINE แล้ว'); } catch { showToast('ไม่สามารถคัดลอกข้อความได้', 'error'); } };
  return <div className="modal-backdrop detail-backdrop"><div className="detail-drawer"><div className="drawer-header"><div><span className="modal-kicker">รายละเอียดใบเสนอราคา</span><h2>{quote.number}</h2></div><IconButton label="ปิดรายละเอียด" onClick={onClose}><X size={19} /></IconButton></div><div className="drawer-actions">{quoteCanEdit(quote) ? <button type="button" className="button button-secondary button-small" onClick={onEdit}><Pencil size={15} />แก้ไขร่าง</button> : <button type="button" className="button button-secondary button-small" onClick={onRevise}><Copy size={15} />สร้างฉบับแก้ไข</button>}<button type="button" className="button button-secondary button-small" onClick={onPrint}><Printer size={15} />พิมพ์ / PDF</button><button type="button" className="icon-button" onClick={() => onDelete(quote.id)} aria-label="ลบใบเสนอราคา"><Trash2 size={16} /></button></div><div className="drawer-scroll"><div className="detail-hero"><StatusBadge status={quote.status} /><strong>฿{money(totals.total)}</strong><span>ยอดรวมทั้งสิ้น · ออกเมื่อ {dateLabel(quote.issueDate)}</span></div><div className="detail-status-control"><span>เปลี่ยนสถานะ</span><select value={quote.status} onChange={(event) => onStatus(quote.id, event.target.value)}>{quoteCanEdit(quote) ? <option value="draft">ร่าง</option> : null}<option value="sent">รอตอบกลับ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ไม่อนุมัติ</option><option value="expired">หมดอายุ</option></select><ChevronDown size={15} /></div>{!quoteCanEdit(quote) ? <p className="issued-note"><ShieldCheck size={14} />เอกสารที่ส่งแล้วแก้ไขไม่ได้ หากต้องเปลี่ยนราคาให้สร้างฉบับแก้ไข</p> : null}<section className="detail-section"><div className="detail-section-title"><h3>ลูกค้า</h3><button type="button" className="text-button" onClick={copyShare}><Copy size={14} />คัดลอกสรุป</button></div><div className="detail-customer"><div className="large-customer-avatar">{(customer?.name || '?').slice(0, 1)}</div><div><strong>{customer?.name || 'ยังไม่เลือกลูกค้า'}</strong><span>{customer?.contact || '-'}</span><span>{customer?.email || '-'} · {customer?.phone || '-'}</span></div></div></section><section className="detail-section"><div className="detail-section-title"><h3>รายการ</h3><span>{quote.items.length} รายการ</span></div><div className="detail-line-list">{quote.items.map((item) => <div className="detail-line" key={item.id}><div><strong>{item.name || 'ไม่มีชื่อรายการ'}</strong><span>{item.description || `${item.qty} ${item.unit}`}</span></div><strong>฿{money(lineAmount(item))}</strong></div>)}</div><div className="detail-totals"><div><span>รวมรายการ</span><strong>฿{money(totals.itemSubtotal)}</strong></div><div><span>ส่วนลด</span><strong>-฿{money(totals.discount)}</strong></div><div><span>VAT {quote.vatRate}%</span><strong>฿{money(totals.vat)}</strong></div><div className="detail-total"><span>ยอดรวม</span><strong>฿{money(totals.total)}</strong></div></div></section><section className="detail-section"><div className="detail-section-title"><h3>ข้อมูลเอกสาร</h3></div><div className="meta-grid"><div><span>วันที่ออก</span><strong>{dateLabel(quote.issueDate)}</strong></div><div><span>ใช้ได้ถึง</span><strong>{dateLabel(quote.validUntil)}</strong></div><div><span>วันติดตาม</span><strong>{dateLabel(quote.followUpDate)}</strong></div></div>{quote.note ? <div className="detail-note"><FileText size={15} /><span>{quote.note}</span></div> : null}</section></div><div className="drawer-footer"><button type="button" className="button button-secondary" onClick={() => { const email = customer?.email; if (email) window.location.href = `mailto:${email}?subject=${encodeURIComponent(`ใบเสนอราคา ${quote.number}`)}&body=${encodeURIComponent(shareText)}`; else showToast('ลูกค้ายังไม่มีอีเมล', 'error'); }}><Mail size={16} />เปิดร่างอีเมล</button><button type="button" className="button button-primary" onClick={copyShare}><Link2 size={16} />คัดลอกสำหรับ LINE</button></div></div></div>;
}

function PrintSheet({ quote, store }) {
  const customer = quote.customerSnapshot || store.customers.find((item) => item.id === quote.customerId);
  const company = quote.companySnapshot || store.settings;
  const totals = calculateQuote(quote);
  return <div className="print-sheet"><div className="print-header"><div><div className="print-brand"><span className="brand-mark"><Zap size={15} /></span><strong>{company.companyName}</strong></div><p>{company.companyAddress}</p><p>โทร {company.companyPhone} · {company.companyEmail}</p><p>เลขประจำตัวผู้เสียภาษี {company.companyTaxId}</p></div><div className="print-title"><span>ใบเสนอราคา</span><strong>{quote.number}</strong><small>วันที่ {dateLabel(quote.issueDate)}</small></div></div><div className="print-customer"><div><span>เรียน</span><strong>{customer?.name || '-'}</strong><small>{customer?.contact || ''}</small></div><div><span>ใช้ได้ถึง</span><strong>{dateLabel(quote.validUntil)}</strong></div></div><table className="print-table"><thead><tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>หน่วยละ</th><th>ส่วนลด</th><th>จำนวนเงิน</th></tr></thead><tbody>{quote.items.map((item, index) => { const { discount: lineDiscount, net: lineNet } = lineParts(item); return <tr key={item.id}><td>{index + 1}</td><td><strong>{item.name || '-'}</strong><small>{item.description}</small></td><td>{item.qty} {item.unit}</td><td>฿{money(item.price)}</td><td>฿{money(lineDiscount)}</td><td>฿{money(lineNet)}</td></tr>; })}</tbody></table><div className="print-bottom"><div className="print-note"><strong>หมายเหตุ</strong><p>{quote.note || 'ขอบคุณที่ให้โอกาสเราได้นำเสนอราคา'}</p></div><div className="print-totals"><div><span>รวมรายการ</span><strong>฿{money(totals.itemSubtotal)}</strong></div><div><span>ส่วนลด</span><strong>-฿{money(totals.discount)}</strong></div><div><span>VAT {quote.vatRate}%</span><strong>฿{money(totals.vat)}</strong></div><div className="print-grand-total"><span>ยอดรวมทั้งสิ้น</span><strong>฿{money(totals.total)}</strong></div></div></div><div className="print-signatures"><div><span>ผู้เสนอราคา</span><i /> <small>วันที่ _____ / _____ / _____</small></div><div><span>ผู้อนุมัติ / ลูกค้า</span><i /><small>วันที่ _____ / _____ / _____</small></div></div></div>;
}

function CustomersPage({ store, onChange, showToast }) {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const customers = store.customers.filter((customer) => !search.trim() || `${customer.name} ${customer.contact} ${customer.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const openForm = (customer = null) => { setEditing(customer || { id: `cus-${crypto.randomUUID()}`, name: '', contact: '', email: '', phone: '', address: '' }); setFormOpen(true); };
  const save = (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const customer = { ...editing, name: data.get('name').trim(), contact: data.get('contact').trim(), email: data.get('email').trim(), phone: data.get('phone').trim(), address: data.get('address').trim() }; if (!customer.name) return; const saved = onChange(store.customers.some((item) => item.id === customer.id) ? store.customers.map((item) => item.id === customer.id ? customer : item) : [customer, ...store.customers]); if (!saved) return; setFormOpen(false); showToast('บันทึกข้อมูลลูกค้าแล้ว'); };
  return <><div className="page-heading"><div><div className="eyebrow">ฐานข้อมูลลูกค้า</div><h1>ลูกค้า</h1><p>ข้อมูลติดต่อที่ใช้กับเอกสารทั้งหมดของคุณ</p></div><button type="button" className="button button-primary" onClick={() => openForm()}><Plus size={17} />เพิ่มลูกค้า</button></div><div className="page-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อลูกค้า ผู้ติดต่อ หรืออีเมล" /></div><span className="toolbar-count">{customers.length} รายการ</span></div><section className="panel"><div className="customer-grid">{customers.map((customer) => <article className="customer-card" key={customer.id}><div className="customer-card-top"><div className="large-customer-avatar">{customer.name.slice(0, 1)}</div><IconButton label="แก้ไขลูกค้า" onClick={() => openForm(customer)}><Pencil size={15} /></IconButton></div><h3>{customer.name}</h3><span className="customer-contact">{customer.contact || 'ยังไม่มีผู้ติดต่อ'}</span><div className="customer-card-meta"><span><Mail size={14} />{customer.email || '-'}</span><span><BriefcaseBusiness size={14} />{customer.phone || '-'}</span></div><div className="customer-card-footer"><span>{store.quotes.filter((quote) => quote.customerId === customer.id).length} ใบเสนอราคา</span><ArrowUpRight size={15} /></div></article>)}{!customers.length ? <EmptyState icon={UsersRound} title="ไม่พบข้อมูลลูกค้า" description="ลองค้นหาด้วยคำอื่น หรือเพิ่มลูกค้าใหม่" /> : null}</div></section>{formOpen ? <div className="modal-backdrop"><form className="modal small-modal" onSubmit={save}><div className="modal-header"><div><span className="modal-kicker">ฐานข้อมูล</span><h2>{store.customers.some((item) => item.id === editing.id) ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้า'}</h2></div><IconButton label="ปิดหน้าต่าง" onClick={() => setFormOpen(false)}><X size={19} /></IconButton></div><div className="modal-body"><div className="form-stack"><label><span>ชื่อลูกค้า / บริษัท <b>*</b></span><input name="name" defaultValue={editing.name} required placeholder="เช่น บริษัท ตัวอย่าง จำกัด" /></label><label><span>ชื่อผู้ติดต่อ</span><input name="contact" defaultValue={editing.contact} placeholder="ชื่อและนามสกุล" /></label><div className="form-grid"><label><span>อีเมล</span><input name="email" type="email" defaultValue={editing.email} placeholder="name@company.co.th" /></label><label><span>โทรศัพท์</span><input name="phone" defaultValue={editing.phone} placeholder="08x-xxx-xxxx" /></label></div><label><span>ที่อยู่</span><textarea name="address" rows="3" defaultValue={editing.address} placeholder="ที่อยู่ออกเอกสาร" /></label></div></div><div className="modal-footer"><button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>ยกเลิก</button><button type="submit" className="button button-primary"><Check size={16} />บันทึกข้อมูล</button></div></form></div> : null}</>;
}

function CatalogPage({ store, onChange, showToast }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const products = store.products.filter((product) => !search.trim() || `${product.name} ${product.code}`.toLowerCase().includes(search.trim().toLowerCase()));
  const openForm = (product = null) => { setEditing(product || { id: `prd-${crypto.randomUUID()}`, code: '', name: '', unit: 'รายการ', price: 0, vat: true }); setFormOpen(true); };
  const save = (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const product = { ...editing, code: data.get('code').trim(), name: data.get('name').trim(), unit: data.get('unit').trim(), price: Math.round(Number(data.get('price') || 0) * 100), vat: data.get('vat') === 'on' }; if (!product.name) return; const saved = onChange(store.products.some((item) => item.id === product.id) ? store.products.map((item) => item.id === product.id ? product : item) : [product, ...store.products]); if (!saved) return; setFormOpen(false); showToast('บันทึกสินค้า/บริการแล้ว'); };
  return <><div className="page-heading"><div><div className="eyebrow">รายการที่ใช้ซ้ำ</div><h1>สินค้าและบริการ</h1><p>สร้างรายการสำเร็จรูปเพื่อออกเอกสารได้เร็วขึ้น</p></div><button type="button" className="button button-primary" onClick={() => openForm()}><Plus size={17} />เพิ่มสินค้า/บริการ</button></div><div className="page-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาชื่อหรือรหัสรายการ" /></div><span className="toolbar-count">{products.length} รายการ</span></div><section className="panel"><div className="data-table-wrap"><table className="data-table catalog-table"><thead><tr><th>รหัส</th><th>ชื่อสินค้าและบริการ</th><th>หน่วย</th><th>ราคาตั้งต้น</th><th>ภาษี</th><th /></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><span className="code-chip">{product.code || '-'}</span></td><td><strong>{product.name}</strong></td><td>{product.unit}</td><td><strong>฿{money(product.price)}</strong></td><td>{product.vat ? <span className="tax-yes">คิด VAT ตามเอกสาร</span> : <span className="tax-no">ยกเว้น</span>}</td><td className="actions-col"><IconButton label="แก้ไขรายการ" onClick={() => openForm(product)}><Pencil size={15} /></IconButton></td></tr>)}</tbody></table></div></section>{formOpen ? <div className="modal-backdrop"><form className="modal small-modal" onSubmit={save}><div className="modal-header"><div><span className="modal-kicker">รายการสำเร็จรูป</span><h2>{store.products.some((item) => item.id === editing.id) ? 'แก้ไขรายการ' : 'เพิ่มสินค้า/บริการ'}</h2></div><IconButton label="ปิดหน้าต่าง" onClick={() => setFormOpen(false)}><X size={19} /></IconButton></div><div className="modal-body"><div className="form-stack"><div className="form-grid"><label><span>รหัสรายการ</span><input name="code" defaultValue={editing.code} placeholder="เช่น SRV-006" /></label><label><span>หน่วย</span><input name="unit" defaultValue={editing.unit} placeholder="งาน / ชุด / เดือน" /></label></div><label><span>ชื่อสินค้า/บริการ <b>*</b></span><input name="name" defaultValue={editing.name} required placeholder="ชื่อรายการ" /></label><label><span>ราคาตั้งต้น (บาท)</span><input name="price" type="number" min="0" step="0.01" defaultValue={(editing.price || 0) / 100} /></label><label className="checkbox-label"><input name="vat" type="checkbox" defaultChecked={editing.vat} /><span>คิด VAT ตามอัตราของเอกสาร</span></label></div></div><div className="modal-footer"><button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>ยกเลิก</button><button type="submit" className="button button-primary"><Check size={16} />บันทึกรายการ</button></div></form></div> : null}</>;
}

function SettingsPage({ store, onSettings, onExport, onImport, showToast }) {
  const [draft, setDraft] = useState(store.settings);
  useEffect(() => setDraft(store.settings), [store.settings]);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const save = (event) => { event.preventDefault(); const saved = onSettings({ ...draft, defaultVat: numberValue(draft.defaultVat), defaultValidity: numberValue(draft.defaultValidity) }); if (!saved) return; showToast('บันทึกการตั้งค่าแล้ว'); };
  return <><div className="page-heading"><div><div className="eyebrow">Workspace configuration</div><h1>ตั้งค่าระบบ</h1><p>ข้อมูลกิจการและค่าเริ่มต้นสำหรับเอกสารใหม่</p></div><button type="submit" form="settings-form" className="button button-primary"><Check size={16} />บันทึกการตั้งค่า</button></div><form id="settings-form" onSubmit={save} className="settings-layout"><div className="settings-main"><section className="panel settings-section"><div className="panel-heading"><div><h2>ข้อมูลกิจการ</h2><p>ข้อมูลชุดนี้จะแสดงบนใบเสนอราคาและเอกสารที่พิมพ์</p></div><div className="panel-icon"><BriefcaseBusiness size={18} /></div></div><div className="form-stack"><label><span>ชื่อกิจการ</span><input value={draft.companyName} onChange={(event) => update('companyName', event.target.value)} /></label><div className="form-grid"><label><span>เลขประจำตัวผู้เสียภาษี</span><input value={draft.companyTaxId} onChange={(event) => update('companyTaxId', event.target.value)} /></label><label><span>เบอร์โทรศัพท์</span><input value={draft.companyPhone} onChange={(event) => update('companyPhone', event.target.value)} /></label></div><label><span>อีเมล</span><input type="email" value={draft.companyEmail} onChange={(event) => update('companyEmail', event.target.value)} /></label><label><span>ที่อยู่</span><textarea rows="3" value={draft.companyAddress} onChange={(event) => update('companyAddress', event.target.value)} /></label></div></section><section className="panel settings-section"><div className="panel-heading"><div><h2>ค่าเริ่มต้นเอกสาร</h2><p>ช่วยลดการกรอกข้อมูลซ้ำเมื่อสร้างใบเสนอราคาใหม่</p></div><div className="panel-icon"><FileText size={18} /></div></div><div className="form-grid"><label><span>คำนำหน้าเลขที่เอกสาร</span><input maxLength={8} pattern="[A-Z0-9]{1,8}" required value={draft.quotePrefix} onChange={(event) => update('quotePrefix', event.target.value.toUpperCase())} /></label><label><span>VAT เริ่มต้น (%)</span><input type="number" min="0" max="100" value={draft.defaultVat} onChange={(event) => update('defaultVat', event.target.value)} /></label><label><span>อายุใบเสนอราคา (วัน)</span><input type="number" min="1" max="3650" value={draft.defaultValidity} onChange={(event) => update('defaultValidity', event.target.value)} /></label></div></section></div><aside className="settings-side"><section className="panel integration-card"><div className="panel-heading"><div><h2>การเชื่อมต่อ</h2><p>สถานะบริการภายนอก</p></div><div className="panel-icon"><Link2 size={18} /></div></div><IntegrationRow icon={FolderOpen} name="พื้นที่จัดเก็บในเครื่อง" detail="ข้อมูลถูกเก็บในเบราว์เซอร์นี้" status="เชื่อมต่อแล้ว" tone="green" /><IntegrationRow icon={Zap} name="LINE Messaging API" detail="มี server adapter • ผู้ติดตั้งต้องเชื่อมเอง" status="ยังไม่เชื่อมต่อ" tone="amber" /><IntegrationRow icon={Upload} name="Google Sheets" detail="ผู้ติดตั้งต้องพัฒนา workflow เชื่อมเอง" status="ยังไม่เชื่อมต่อ" tone="neutral" /></section><section className="panel backup-card"><div className="panel-heading"><div><h2>สำรองข้อมูล</h2><p>ข้อมูลของคุณอยู่ภายใต้การควบคุมของคุณ</p></div><ShieldCheck size={20} className="backup-shield" /></div><p className="backup-description">ส่งออกข้อมูลทั้งหมดเป็นไฟล์ JSON เพื่อเก็บไว้หรือย้ายไปยังระบบอื่น</p><button type="button" className="button button-secondary full-button" onClick={onExport}><Download size={16} />ส่งออกข้อมูลสำรอง</button><label className="button button-ghost full-button import-button"><Upload size={16} />นำเข้าข้อมูลสำรอง<input type="file" accept="application/json" onChange={onImport} /></label><small className="local-note"><ShieldCheck size={13} />ข้อมูลในรุ่นนี้เก็บในเบราว์เซอร์ ยังไม่ใช่ระบบหลายผู้ใช้</small></section></aside></form></>;
}

function IntegrationRow({ icon: Icon, name, detail, status, tone }) {
  return <div className="integration-row"><div className="integration-icon"><Icon size={16} /></div><div><strong>{name}</strong><span>{detail}</span></div><span className={`integration-status integration-${tone}`}>{status}</span></div>;
}

export default App;
