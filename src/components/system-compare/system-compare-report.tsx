import { PrintButton } from './print-button';

/**
 * Internal market-comparison report: HSPA (our self-built POS) vs 13 mainstream
 * spa/salon POS systems. Static content compiled from a two-round multi-agent
 * deep-research pass (2026-06-09). Data lives in the arrays below so the numbers
 * are easy to refresh when vendor pricing changes.
 *
 * Theme-native: uses the app's semantic tokens (card / muted-foreground /
 * primary / border) so it adapts to light & dark mode, plus print:* rules so
 * "Save as PDF" produces a clean document.
 */

type Mark = 'y' | 'p' | 'n' | 'defer';

const MARK_GLYPH: Record<Mark, string> = { y: '●', p: '◐', n: '○', defer: '⏸' };
const MARK_CLASS: Record<Mark, string> = {
  y: 'text-emerald-600 dark:text-emerald-400',
  p: 'text-amber-600 dark:text-amber-400',
  n: 'text-red-600 dark:text-red-400',
  defer: 'text-amber-600 dark:text-amber-400',
};

function MarkCell({ v, t }: { v: Mark; t?: string }) {
  return (
    <span className={`font-bold ${MARK_CLASS[v]}`}>
      {MARK_GLYPH[v]}
      {t ? <span className="ml-1 text-xs font-medium text-muted-foreground">{t}</span> : null}
    </span>
  );
}

/* ---------------- Section ① — price table ---------------- */

type Visibility = 'pub' | 'part' | 'quote' | 'own';
const VIS_LABEL: Record<Visibility, string> = {
  pub: '公開列價',
  part: '部分公開',
  quote: '純洽詢',
  own: '自有',
};
const VIS_CLASS: Record<Visibility, string> = {
  pub: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  part: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  quote: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  own: 'bg-primary/15 text-primary',
};

interface PriceRow {
  sys: string;
  sub?: string;
  star?: boolean;
  you?: boolean;
  hl?: boolean;
  range: React.ReactNode;
  tier: React.ReactNode;
  perUnit: React.ReactNode;
  card: string;
  free: Mark | '-';
  freeText: string;
  setup: string;
  vis: Visibility;
}

const PRICE_ROWS: PriceRow[] = [
  {
    sys: 'HSPA', sub: '你的自建', you: true,
    range: <span className="font-bold text-primary">零授權費</span>,
    tier: <><b>零授權費</b><br />僅雲費 Vercel+Supabase，約 $0–50/月級距</>,
    perUnit: '無（單一租戶，員工/分店不另收）',
    card: '—（金流策略性延後）', free: '-', freeText: '—', setup: '開發人力（已投入）', vis: 'own',
  },
  {
    sys: 'Zenoti', star: true, hl: true,
    range: <><span className="font-bold text-red-600 dark:text-red-400">洽詢制</span><div className="text-xs font-normal text-muted-foreground">~$300–600/店/月</div></>,
    tier: <><b>純洽詢</b>，無公開價<br />Growth / Hypergrowth / Complete 三層<br /><span className="text-xs text-muted-foreground">第三方估 $300–600/月/店；連鎖 $10k–15k+/月</span></>,
    perUnit: '按分店計（無 per-seat）。多項核心功能每店加購：2 向簡訊 $29–169、聲譽 $189、AI 聊天機器人 $150–400/店/月',
    card: '自有 Zenoti Pay，費率不公開（業界 2–4%）；BNPL 5.9%', free: 'n', freeText: '無', setup: '約 $2,000–5,000+（遷移+專業服務）', vis: 'quote',
  },
  {
    sys: 'SalesPlay', star: true,
    range: <span className="font-bold text-emerald-600 dark:text-emerald-400">免費起</span>,
    tier: <><b>核心 POS 免費</b>（含無限銷售歷史）<br />加購：員工管理 $4/人/月、進階庫存 $20/店/月</>,
    perUnit: '員工 $4/人/月；庫存 $20/店/月。免費層限 1 個 POS app',
    card: 'n/a（不自營金流，接第三方端末機 PAX/Teya）', free: 'y', freeText: '有（真免費）', setup: '無', vis: 'part',
  },
  {
    sys: 'Mangomint',
    range: '$165–375/月',
    tier: <>Essentials $165 / Standard $245 / Unlimited $375</>,
    perUnit: '員工含於方案（10/20/不限）；額外分店 +$95 / +$135 / +$175/月',
    card: '實體 2.45%+15¢；線上 2.9%+30¢（Stripe）', free: 'n', freeText: '僅試用', setup: '無（免費導入）', vis: 'pub',
  },
  {
    sys: 'Fresha',
    range: '$15–20/員工',
    tier: <>Independent $19.95；Team $14.95/<b>每員工</b>；Enterprise 洽詢<br /><span className="text-xs text-muted-foreground">2025 起取消永久免費版，剩 7 天試用</span></>,
    perUnit: 'Team 按可預約員工計；各分店獨立訂閱；多項加購按店/人',
    card: '實體 2.29%+20¢ / 線上 2.79% / 手key 3.30%；市集新客抽 20%', free: 'p', freeText: '已取消（剩試用）', setup: '無', vis: 'part',
  },
  {
    sys: 'Mindbody',
    range: '$99–699/月',
    tier: <>Starter $99 起 / Accelerate ~$259 / Ultimate ~$499 / Ultimate Plus ~$699<br /><span className="text-xs text-muted-foreground">僅 Starter 公開</span></>,
    perUnit: '按分店計，員工不限；品牌 App +$199/月',
    card: '實體 2.99%+30¢；線上 3.60%+30¢；市集新客 +20%', free: 'n', freeText: '無', setup: '小店含；大型導入第三方稱 $10,000+', vis: 'part',
  },
  {
    sys: 'Booker', sub: 'Mindbody 旗下',
    range: '$139–599/月',
    tier: <>Starter $139 / Accelerate ~$289 / Ultimate ~$469 / Ultimate Plus ~$599<br /><span className="text-xs text-muted-foreground">僅 Starter 公開</span></>,
    perUnit: '低階限員工檔案數；Accelerate+ 不限。多店另報價',
    card: '透過 Mindbody Pay：實體 ~2.75%；線上 ~3.5%+15¢；市集 +20%', free: 'n', freeText: '無（最少 12 個月約）', setup: '無公開（第三方估 $1k–7k）', vis: 'part',
  },
  {
    sys: 'Boulevard',
    range: '$176–410/月',
    tier: <>Essentials $176 / Premier $293 / Prestige $410（每店/月，年約）；醫美包 ~$421–468</>,
    perUnit: '按分店計；Essentials 限 5 人，Premier+ 不限。Forms 加購 $65/月起',
    card: '實體 ~2.6%+10¢；線上 ~3.5%。可開客付 3% 附加費', free: 'n', freeText: '無', setup: '無公開', vis: 'part',
  },
  {
    sys: 'Phorest',
    range: <><span className="font-bold text-red-600 dark:text-red-400">洽詢制</span><div className="text-xs font-normal text-muted-foreground">~$99–1000+/月</div></>,
    tier: <><b>純洽詢</b>。Starter / Grow / Complete / Elite 四層<br /><span className="text-xs text-muted-foreground">第三方估 ~$99–300/月，大型 $500–1000+</span></>,
    perUnit: '含不限員工/裝置；各層差在月含簡訊量（1k–27k）。多店另報價',
    card: '多數地區洽詢；澳 1.4%+A$0.10+月租 $30。線上預約另收 ~$1/筆', free: 'n', freeText: '無（明言不提供試用）', setup: '無（免費導入+訓練）', vis: 'quote',
  },
  {
    sys: 'Meevo', sub: 'Millennium',
    range: <><span className="font-bold text-red-600 dark:text-red-400">洽詢制</span><div className="text-xs font-normal text-muted-foreground">~$139–529/月</div></>,
    tier: <><b>純洽詢</b>。Lite / Essentials / Premier / Enterprise + 醫美 MeevoMD<br /><span className="text-xs text-muted-foreground">第三方估 ~$139–529/月；多店 $200–500/店</span></>,
    perUnit: 'Lite 限 5 人；Essentials+ 不限。多店約 $200–500/店（估）',
    card: 'MeevoPay，費率不公開（稱「透明低固定費率」）', free: 'n', freeText: '無', setup: '含訓練時數（4–6 hr）；另可能有導入費', vis: 'quote',
  },
  {
    sys: 'Vagaro',
    range: '$30–84/月',
    tier: <>$30/月（1 行事曆，促銷 $23.99）<br />每加 1 行事曆 +$10，上限 $83.99（7+）</>,
    perUnit: '~$10/月/員工(行事曆)；多店各自訂閱。品牌 App +$100、簡訊行銷 +$20 等',
    card: '小商家 2.6%+10¢；大商家 2.2%+19¢+月租$10；線上 3.5%+15¢', free: 'n', freeText: '30 天試用', setup: '無', vis: 'pub',
  },
  {
    sys: 'Timely',
    range: '$26–47/月',
    tier: <>Build $26 / Elevate $39 / Innovate $47（隨員工數級距上升）</>,
    perUnit: '不固定 per-seat，依員工數級距漲價；各店獨立帳號',
    card: 'TimelyPay（Stripe）：美 2.8%+30¢；英 1.95%+20p；澳 1.75%+A$0.30', free: 'n', freeText: '14 天試用', setup: '無', vis: 'pub',
  },
  {
    sys: 'GlossGenius',
    range: '$24–148/月',
    tier: <>Standard $24 / Gold $48 / Platinum $148（年付）</>,
    perUnit: '無 per-seat（2 / 9 / 不限 人）。Payroll +$40+$6/人',
    card: '全方案統一 2.6%（無每筆固定費）；即時撥款 +1.8%', free: 'n', freeText: '14 天試用', setup: '無（免費遷移）', vis: 'pub',
  },
  {
    sys: 'Square', sub: 'Appointments',
    range: '$0–149/月',
    tier: <>Free $0 / Plus $49 / Premium $149（每店/月）</>,
    perUnit: '按分店計，員工不限',
    card: '免費版 2.6%+15¢；Plus 2.5%+15¢；Premium 2.4%+15¢（實體）', free: 'y', freeText: '有（個人免費）', setup: '無', vis: 'pub',
  },
];

/* ---------------- Section ③ — feature matrix ---------------- */

const MATRIX_COLS = ['HSPA', 'Zenoti', 'SalesPlay', 'Mangomint', 'Mindbody', 'Fresha', 'Vagaro'];

interface MatrixRow {
  label: string;
  note?: string;
  hl?: boolean;
  you?: boolean;
  vals: { v: Mark; t?: string }[];
}

const MATRIX_ROWS: MatrixRow[] = [
  { label: '預約排程', vals: [{ v: 'y' }, { v: 'y' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
  { label: '床位+療師雙視圖拖拉指派', hl: true, vals: [{ v: 'y', t: '強' }, { v: 'p' }, { v: 'n' }, { v: 'p' }, { v: 'p' }, { v: 'p' }, { v: 'p' }] },
  { label: '多分店共用 CRM', vals: [{ v: 'y' }, { v: 'y', t: '強' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'p' }] },
  { label: 'POS 結帳', vals: [{ v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
  { label: '員工佣金 / 小費', vals: [{ v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
  { label: '庫存零售', vals: [{ v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
  { label: '會員 / 儲值 / 套票', vals: [{ v: 'y' }, { v: 'y' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
  { label: '報表分析', vals: [{ v: 'y', t: '強' }, { v: 'y' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'p' }, { v: 'p' }] },
  { label: '佔用率 / RevPATH（每療師工時淨營收）', you: true, vals: [{ v: 'y', t: '罕見' }, { v: 'p' }, { v: 'n' }, { v: 'n' }, { v: 'p' }, { v: 'n' }, { v: 'n' }] },
  { label: 'Shift+Folio 帳本（無開班不能收款）', you: true, vals: [{ v: 'y', t: '罕見' }, { v: 'p' }, { v: 'n' }, { v: 'n' }, { v: 'p' }, { v: 'n' }, { v: 'n' }] },
  { label: '多語 Kiosk 健康問診+電子簽名', you: true, vals: [{ v: 'y', t: '8 語' }, { v: 'p' }, { v: 'n' }, { v: 'p' }, { v: 'p' }, { v: 'n' }, { v: 'p' }] },
  { label: '療師缺勤 block + 每日 line-up 排序', you: true, vals: [{ v: 'y', t: '罕見' }, { v: 'p' }, { v: 'n' }, { v: 'n' }, { v: 'n' }, { v: 'n' }, { v: 'n' }] },
  { label: '外送 / 飯店 dispatch + 房號', you: true, vals: [{ v: 'y', t: '罕見' }, { v: 'n' }, { v: 'n' }, { v: 'n' }, { v: 'n' }, { v: 'n' }, { v: 'n' }] },
  { label: 'AR 應收 / 飯店掛帳 → SOA', vals: [{ v: 'y' }, { v: 'p' }, { v: 'n' }, { v: 'n' }, { v: 'p' }, { v: 'n' }, { v: 'n' }] },
  { label: '角色權限 RBAC', vals: [{ v: 'y', t: '4 級' }, { v: 'y' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'p' }, { v: 'p' }] },
  { label: '行銷自動化（SMS/email blast）', note: '← 值得補', hl: true, vals: [{ v: 'n' }, { v: 'y', t: '強' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'p' }, { v: 'y' }] },
  { label: '行動 POS（療師平板現場結帳）', note: '← 值得補', hl: true, vals: [{ v: 'n' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
  { label: 'AI 客服 / 漏接電話挽回', vals: [{ v: 'defer' }, { v: 'y', t: '獨家' }, { v: 'n' }, { v: 'p' }, { v: 'n' }, { v: 'n' }, { v: 'n' }] },
  { label: '線上自助預約（終端客）', vals: [{ v: 'defer', t: '延後' }, { v: 'y' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'y', t: '強' }, { v: 'y' }] },
  { label: '實體信用卡金流整合', vals: [{ v: 'defer', t: '延後' }, { v: 'y' }, { v: 'p' }, { v: 'y', t: '美加' }, { v: 'y', t: '美加' }, { v: 'p', t: '限區' }, { v: 'y', t: '美加' }] },
  { label: '原生 App / 客製化', vals: [{ v: 'n' }, { v: 'y' }, { v: 'p' }, { v: 'y' }, { v: 'y' }, { v: 'y' }, { v: 'y' }] },
];

/* ---------------- Section ⑤ — Asia availability ---------------- */

interface AsiaRow { sys: string; ph: Mark; phT?: string; hk: Mark; hkT?: string; tw: Mark; twT?: string; note: string; }
const ASIA_ROWS: AsiaRow[] = [
  { sys: 'Zenoti', ph: 'p', phT: '清單有列', hk: 'p', hkT: '有列', tw: 'n', twT: '未列', note: '官方 47 國清單含 PH/HK，但當地金流支援未公開承諾，需洽詢' },
  { sys: 'SalesPlay', ph: 'p', phT: '可用', hk: 'p', hkT: '可用', tw: 'p', twT: '可用', note: '多幣別、雲端可用；刷卡靠第三方端末機，非原生' },
  { sys: 'Fresha', ph: 'n', hk: 'y', tw: 'n', note: '整合金流亞洲僅星、港' },
  { sys: 'Mindbody / Booker', ph: 'n', hk: 'n', tw: 'n', note: '金流限美加（+英澳歐部分）' },
  { sys: 'Mangomint', ph: 'n', phT: '不可用', hk: 'n', tw: 'n', note: '僅美加，註冊需 US EIN' },
  { sys: 'Boulevard', ph: 'n', phT: '不可用', hk: 'n', tw: 'n', note: '純美國' },
  { sys: 'Vagaro', ph: 'n', phT: '不可用', hk: 'n', tw: 'n', note: '僅美加英澳' },
  { sys: 'Timely', ph: 'n', hk: 'n', tw: 'n', note: '僅紐澳英愛美' },
  { sys: 'GlossGenius', ph: 'n', phT: '不可用', hk: 'n', tw: 'n', note: '純美國，需 US 稅號+銀行' },
  { sys: 'Square', ph: 'n', hk: 'n', tw: 'n', note: '亞洲僅日本' },
  { sys: 'Phorest / Meevo', ph: 'n', phT: '未支援', hk: 'n', tw: 'n', note: '歐美為主，亞洲金流無' },
];

/* ---------------- shared bits ---------------- */

function SectionHeading({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="mt-12 mb-4 flex items-center gap-3 border-b-2 border-primary pb-2 text-xl font-bold break-after-avoid">
      <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">{n}</span>
      {children}
    </h2>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-card p-5 text-card-foreground ring-1 ring-foreground/10 ${className}`}>{children}</div>;
}

function Callout({ tone = 'brand', children }: { tone?: 'brand' | 'warn' | 'bad'; children: React.ReactNode }) {
  const tones = {
    brand: 'border-primary bg-primary/5',
    warn: 'border-amber-500 bg-amber-50 dark:bg-amber-950/30',
    bad: 'border-red-500 bg-red-50 dark:bg-red-950/30',
  } as const;
  return <div className={`my-4 rounded-r-lg border-l-4 px-4 py-3 ${tones[tone]}`}>{children}</div>;
}

const thBase = 'bg-primary px-3 py-2.5 text-left text-xs font-semibold text-primary-foreground';
const tdBase = 'border-b border-border px-3 py-2.5 align-top';

export function SystemCompareReport() {
  return (
    <div className="mx-auto max-w-[1180px] pb-16 text-[15px] leading-relaxed text-foreground">
      {/* hero */}
      <div className="-mx-6 -mt-6 mb-6 bg-gradient-to-br from-primary to-primary/70 px-6 py-9 text-primary-foreground print:bg-primary">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-bold tracking-wide md:text-3xl">SPA POS 系統市場比較報告</h1>
            <p className="text-sm opacity-90">HSPA（自建系統） vs 市面 13 套主流美業／水療 POS &nbsp;|&nbsp; 聚焦：價格 · 功能 · 菲律賓可用性</p>
            <p className="text-sm opacity-90">H Hospitality Group Corporation</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {['報告日期 2026-06-09', '多來源查證（3-0 對抗式表決）', '13 系統現行定價', '幣別：USD（HSPA 營運為 ₱ PHP）'].map((b) => (
                <span key={b} className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">{b}</span>
              ))}
            </div>
          </div>
          <PrintButton />
        </div>
      </div>

      {/* TLDR */}
      <Callout>
        <strong>一句話總結：</strong>市面系統分兩極 —— <b>Zenoti</b> 是貴而全（不公開報價、AI 客服+行銷、企業連鎖級），<b>SalesPlay</b> 是免費但陽春（通用零售 POS，非專業美業）。但對你最關鍵的事實是：
        <b className="text-red-600 dark:text-red-400">這 13 套裡，沒有任何一套在菲律賓能跑整合刷卡金流</b>。因此在菲律賓，<b>「買套裝」其實省不掉你最在意的金流串接</b>，自建 HSPA 反而是合理選擇。
      </Callout>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-semibold text-primary">💰 價格三檔分布</h3>
          <ul className="ml-4 list-disc space-y-1 text-sm">
            <li><b>免費／極低價：</b>SalesPlay（免費）、Square（免費起）、GlossGenius $24、Timely $26、Vagaro $30</li>
            <li><b>專業中價：</b>Mangomint $165–375、Boulevard $176–410、Mindbody $99–699、Booker $139–599</li>
            <li><b>企業洽詢制：</b>Zenoti、Phorest、Meevo（均不公開、年約、導入費另計）</li>
          </ul>
        </Card>
        <Card>
          <h3 className="mb-2 font-semibold text-primary">🎯 對 HSPA 的策略意涵</h3>
          <ul className="ml-4 list-disc space-y-1 text-sm">
            <li>金流 + 線上自助預約是你<b>策略性延後</b>，不是落後 → 不該被算成缺口。</li>
            <li>真正值得補的是<b>行銷自動化（SMS/email）</b>與<b>行動 POS</b>，成本低、ROI 高。</li>
            <li>HSPA 獨有：<b>folio/shift 帳本、RevPATH、8 語 kiosk 問診、飯店 dispatch</b> —— 套裝軟體幾乎都沒有。</li>
          </ul>
        </Card>
      </div>

      {/* ① price */}
      <SectionHeading n="①">價格總表（現行 2026，USD）</SectionHeading>
      <p className="mb-3 text-sm text-muted-foreground">
        所有金額為 2026 年 6 月擷取之官方或第三方公開價。刷卡抽成多為美國費率，亞洲不一定適用。Zenoti / Phorest / Meevo 的金額皆為第三方聚合站估算，非官方數字，僅供量級參考。
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr>
              {['系統', '月費區間（USD）', '方案明細', '每員工 / 每分店加價', '刷卡抽成（美國）', '免費版', '導入費', '定價透明度'].map((h) => (
                <th key={h} className={thBase}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRICE_ROWS.map((r) => (
              <tr key={r.sys} className={r.you ? 'bg-primary/5' : r.hl ? 'bg-amber-50 dark:bg-amber-950/20' : 'odd:bg-transparent even:bg-muted/30'}>
                <td className={`${tdBase} font-bold whitespace-nowrap ${r.you ? 'text-primary' : r.hl ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                  {r.sys}{r.star ? ' ★' : ''}
                  {r.sub ? <div className="text-xs font-normal text-muted-foreground">{r.sub}</div> : null}
                </td>
                <td className={`${tdBase} text-[14px] font-semibold whitespace-nowrap ${r.you ? 'text-primary' : ''}`}>{r.range}</td>
                <td className={`${tdBase} text-muted-foreground`}>{r.tier}</td>
                <td className={tdBase}>{r.perUnit}</td>
                <td className={tdBase}>{r.card}</td>
                <td className={tdBase}>{r.free === '-' ? '—' : <MarkCell v={r.free} t={r.freeText} />}</td>
                <td className={tdBase}>{r.setup}</td>
                <td className={tdBase}><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${VIS_CLASS[r.vis]}`}>{VIS_LABEL[r.vis]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">★ = 你特別點名的系統。</p>

      {/* ② positioning */}
      <SectionHeading n="②">各系統定位一覽</SectionHeading>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { t: 'Zenoti — 企業連鎖巨獸 ★', d: <>30,000+ 商家、50+ 國家。賣點不是 POS，而是整套 <b>AI Workforce</b>（AI 接待員 24/7 接電話、AI 數位行銷、AI 禮賓上銷售、AI 排班）。AI 須升級 <b>AI Plus</b> 套餐。缺點：貴、不透明、核心功能多為每店加購、12–24 月綁約、小店大材小用。</> },
          { t: 'SalesPlay — 免費通用 POS ★', d: <>斯里蘭卡起家，100+ 國家。核心 POS 免費含無限歷史，只有員工/庫存加購。雖列「Spa &amp; Salons」業種與預約模組，但本質是<b>橫向零售/餐飲收銀</b>，排班與床位/療師指派深度遠不及專業美業系統。</> },
          { t: 'Mangomint — 美國中高階沙龍/醫美', d: <>公開透明定價、體驗精緻、自動化強。<b className="text-red-600 dark:text-red-400">致命點</b>：只服務美加，註冊需 US EIN，菲律賓完全不可用。</> },
          { t: 'Fresha — 全球量最大、靠抽成', d: <>軟體幾乎免費、靠刷卡與市集抽成獲利，120+ 國家可用「日曆」。<b className="text-red-600 dark:text-red-400">致命點</b>：整合金流亞洲只有星、港，菲律賓/台灣不支援；市集新客抽 20%。</> },
          { t: 'Mindbody / Booker — 老牌、龐大', d: <>功能全、有消費者市集導客。缺點：貴、報價不透明、綁約、App 評價差；金流限美加，亞洲不支援本地付款。</> },
          { t: 'Boulevard / Phorest / Meevo — 中高端垂直', d: <>Boulevard（美國高端體驗）、Phorest（歐美行銷強）、Meevo（老牌連鎖）。共同點：偏貴、偏歐美、亞洲金流皆無支援。</> },
          { t: 'Vagaro / Timely / GlossGenius / Square — 平價小店', d: <>價格友善、好上手。<b className="text-red-600 dark:text-red-400">致命點</b>：全部不支援菲律賓/台灣/香港金流（Square 亞洲只有日本；GlossGenius/Vagaro 純美國），只能當參考，無法當主系統。</> },
          { t: 'HSPA — 你的自建系統', d: <>單一租戶、零授權費、完全貼合 H Hospitality 的「飯店+水療」混合流程。獨有 folio/shift 帳本、RevPATH、8 語 kiosk 問診、療師排輪、飯店 dispatch。金流與線上自助預約為<b>策略性延後</b>。</>, you: true },
        ].map((c) => (
          <Card key={c.t} className={c.you ? 'ring-primary/40' : ''}>
            <h3 className={`mb-1.5 font-semibold ${c.you ? 'text-primary' : 'text-primary'}`}>{c.t}</h3>
            <p className="text-sm text-muted-foreground">{c.d}</p>
          </Card>
        ))}
      </div>

      {/* ③ matrix */}
      <SectionHeading n="③">功能對照矩陣</SectionHeading>
      <p className="mb-3 text-sm text-muted-foreground">
        圖例：<span className="font-bold text-emerald-600 dark:text-emerald-400">●</span> 完整
        <span className="font-bold text-amber-600 dark:text-amber-400">◐</span> 部分／陽春
        <span className="font-bold text-red-600 dark:text-red-400">○</span> 無　|
        <span className="font-bold text-amber-600 dark:text-amber-400">⏸</span> = HSPA 策略性延後（非缺口）
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`${thBase} min-w-[230px]`}>功能維度</th>
              {MATRIX_COLS.map((c) => <th key={c} className={`${thBase} text-center`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((r) => (
              <tr key={r.label} className={r.you ? 'bg-primary/5' : r.hl ? 'bg-amber-50 dark:bg-amber-950/20' : 'odd:bg-transparent even:bg-muted/30'}>
                <td className={`${tdBase} font-medium`}>
                  {r.label}
                  {r.note ? <span className="text-xs text-muted-foreground"> {r.note}</span> : null}
                </td>
                {r.vals.map((v, i) => (
                  <td key={i} className={`${tdBase} text-center`}><MarkCell v={v.v} t={v.t} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ④ HSPA */}
      <SectionHeading n="④">HSPA 的優勢與取捨</SectionHeading>
      <h3 className="mt-5 mb-2 font-semibold text-primary">✅ HSPA 真正勝出（套裝軟體大多沒有或很弱）</h3>
      <Card>
        <ul className="ml-4 list-disc space-y-1.5 text-sm">
          <li><b>流程完全貼合你的營運</b> —— 預約與銷售單合一的 order_item 狀態機、飯店 dispatch+房號、AR 掛帳走 folio→SOA。為「飯店+水療」混合模式量身打造，沒有套裝軟體會這樣做。</li>
          <li><b>Shift + Folio 強制帳本</b> —— 每筆營收/收款都綁「已開啟班別」，無開班不能收款。是會計級「事中強制」稽核，連 Zenoti/Mindbody 都只做「事後對帳」。</li>
          <li><b>RevPATH / 床位+療師佔用率</b> —— 用每療師可用工時算淨營收，是飯店收益管理（RevPAR）的水療版，幾乎沒有美業 SaaS 內建。</li>
          <li><b>8 語 Kiosk 健康問診+電子簽名同意書</b> —— 多語問診+法律同意+簽名，市售多半只有陽春 intake 表單。</li>
          <li><b>療師缺勤多段 block + 每日 line-up 排序</b> —— 對應亞洲水療「按鐘/排輪」文化，西方沙龍軟體完全沒有此概念。</li>
          <li><b>零授權費</b> —— 同規模多分店用 Zenoti/Mangomint，一年授權費輕鬆 $5,000–50,000+；你只付雲費。</li>
        </ul>
      </Card>

      <h3 className="mt-6 mb-2 font-semibold text-amber-700 dark:text-amber-400">⏸ 策略性延後（不是落後，是你主動選擇不做）</h3>
      <Callout tone="warn">
        <ul className="ml-4 list-disc space-y-1 text-sm">
          <li><b>實體信用卡金流整合</b> —— 在菲律賓本來就沒有套裝軟體能幫你做（見下節），延後完全合理，等需要時自串本地金流即可。</li>
          <li><b>線上自助預約（終端客自訂）</b> —— 你已有 <code className="rounded bg-muted px-1">/book</code> 內部訂房流程，要開放給終端客是「打開既有頁面」而非從零開發，隨時可啟用。</li>
        </ul>
      </Callout>

      <h3 className="mt-6 mb-2 font-semibold text-amber-700 dark:text-amber-400">🟠 真正值得補的缺口（低成本、高 ROI）</h3>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>{['缺口', '誰做得好', '建議補法（自建路線）', '影響'].map((h) => <th key={h} className={thBase}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {[
              ['行銷自動化（SMS/email、再預約、評價邀請）', 'Zenoti / Mangomint', '接 Twilio / SendGrid，做排程觸發；成本極低', '回客率 · 口碑'],
              ['行動 POS（療師平板現場結帳）', '幾乎全部', '你已是 web app，做 responsive/PWA 即可在平板用', '前台體驗'],
              ['AI 接待員 / 漏接電話挽回', 'Zenoti（獨家）', '若痛點明確，外掛第三方語音 AI 即可，不必自建', '非急迫'],
              ['原生 App', '多數', 'PWA 先頂著；待品牌推播需求出現再做', '非急迫'],
            ].map((row) => (
              <tr key={row[0]} className="odd:bg-transparent even:bg-muted/30">
                <td className={`${tdBase} font-semibold`}>{row[0]}</td>
                <td className={tdBase}>{row[1]}</td>
                <td className={tdBase}>{row[2]}</td>
                <td className={tdBase}>{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ⑤ asia */}
      <SectionHeading n="⑤">菲律賓／亞洲可用性（關鍵發現）</SectionHeading>
      <Callout tone="bad">
        <strong>核心發現：</strong>在這 13 套裡，<b className="text-red-600 dark:text-red-400">沒有任何一套能在菲律賓提供整合刷卡金流</b>。多數連用都不行。這代表 —— <b>就算你買套裝，也省不掉「自己串菲律賓本地金流」這件事</b>，反而要再多付一筆授權費。這是支持「續用 HSPA」最有力的理由。
      </Callout>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>{['系統', '菲律賓金流', '香港', '台灣', '說明'].map((h) => <th key={h} className={thBase}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {ASIA_ROWS.map((r) => (
              <tr key={r.sys} className="odd:bg-transparent even:bg-muted/30">
                <td className={`${tdBase} font-bold whitespace-nowrap`}>{r.sys}</td>
                <td className={tdBase}><MarkCell v={r.ph} t={r.phT} /></td>
                <td className={tdBase}><MarkCell v={r.hk} t={r.hkT} /></td>
                <td className={tdBase}><MarkCell v={r.tw} t={r.twT} /></td>
                <td className={tdBase}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card className="mt-4">
        <h3 className="mb-2 font-semibold text-primary">建議：菲律賓本地金流（自串進 HSPA folio 流程）</h3>
        <p className="mb-2 text-sm text-muted-foreground">因為你是 Next.js + Supabase 自建，要補金流時把這些 API 接進現有的 <code className="rounded bg-muted px-1">folio_line</code> 收款流程、綁 shift 即可 —— 比換系統省太多，又能保留你最強的帳本稽核：</p>
        <ul className="ml-4 list-disc space-y-1 text-sm">
          <li><b>PayMongo</b> —— 菲律賓本土、開發者友善，收卡 + GCash + Maya + GrabPay。</li>
          <li><b>Xendit</b> —— 東南亞區域龍頭，菲律賓覆蓋完整，多支付方式、可多幣別。</li>
          <li><b>Maya Business / GCash for Business</b> —— 在地錢包滲透率最高，水療客最常用。</li>
          <li><b>2C2P / DragonPay</b> —— 在地老牌，銀行轉帳 + OTC。</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">最高 ROI 路徑：刷卡/錢包收款可直接寫成現有 <code className="rounded bg-muted px-1">payment</code> folio_line、綁 shift，零稽核損失。</p>
      </Card>

      {/* ⑥ verdict */}
      <SectionHeading n="⑥">自建 vs 採購 — 成本與取捨結論</SectionHeading>
      <Callout>
        <strong>結論：以目前狀況，「續用自建 HSPA + 用 API 補幾個模組」優於整套換成 Zenoti 或任何套裝。</strong>
      </Callout>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-semibold text-primary">💵 成本面</h3>
          <p className="text-sm text-muted-foreground">Zenoti 多分店企業級一年授權+導入，第三方估可達 $10k–50k；HSPA 只付雲費+自己的開發人力。換系統還要付遷移、重訓、流程重塑的隱形成本，並把已做好的 folio/shift/dispatch/RevPATH/kiosk 全部丟掉或退化成套裝的標準功能。</p>
        </Card>
        <Card>
          <h3 className="mb-2 font-semibold text-primary">🎯 貼合面</h3>
          <p className="text-sm text-muted-foreground">你的飯店掛帳、外送房號、按鐘排輪、多語問診 —— 這些是 H Hospitality 的競爭差異，套裝軟體只會逼你遷就它的標準流程。自建的價值正在這裡。</p>
        </Card>
      </div>
      <Card className="mt-4">
        <h3 className="mb-2 font-semibold text-primary">🛠 該買的不是「系統」，是「模組」</h3>
        <p className="mb-2 text-sm text-muted-foreground">與其換平台，不如把市售系統的長處當待辦清單，用 API 補進 HSPA：</p>
        <ul className="ml-4 list-disc space-y-1 text-sm">
          <li><b className="text-primary">優先 1</b> 行銷自動化：接 Twilio/SendGrid 做再預約+評價邀請（成本極低，立即提升回客）。</li>
          <li><b className="text-primary">優先 2</b> 行動 POS：把現有 web app 做成 responsive/PWA，療師可平板現場結帳。</li>
          <li><b className="text-primary">待定</b> 金流 / 線上自助預約：策略性延後，需要時自串本地金流 + 開放 <code className="rounded bg-muted px-1">/book</code>。</li>
          <li><b className="text-primary">非急迫</b> AI 接待員：若漏接電話真的痛，外掛第三方語音 AI 而非自建。</li>
        </ul>
      </Card>
      <Callout tone="warn">
        <strong>什麼時候才該認真考慮買 Zenoti？</strong> 當門市暴增到<b>數十家</b>、且要靠 AI 行銷/AI 客服<b>規模化獲客</b>時，自建的維護人力會比授權費貴 —— 那時 Zenoti 的 AI Workforce 才划算。在那之前，自建是對的。
      </Callout>

      {/* notes */}
      <h2 className="mt-12 mb-3 border-b border-border pb-2 text-lg font-bold">資料來源與註記</h2>
      <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
        <li>本報告經兩輪多代理人查證：第一輪對 Zenoti / SalesPlay / Mangomint / Fresha 做 3-0 對抗式表決（共驗證 25 條主張）；第二輪對 13 系統逐一抓取現行定價（官方頁 + Capterra/G2/GetApp + 廠商部落格）。</li>
        <li><b>定價時效：</b>所有價格為 2026 年 6 月擷取，廠商定價（尤其刷卡費率、分店加價、促銷）變動頻繁，採購前請以官網最新報價為準。</li>
        <li><b>Zenoti / Phorest / Meevo 無公開列價：</b>表中金額皆為第三方聚合站估算，非官方數字，僅供量級參考。</li>
        <li><b>AI 效益數字為廠商自報：</b>Zenoti「1/3 漏接電話轉換」「每月挽回約 $11K」「30,000+ 商家」皆為 Zenoti 行銷/自報數據，未經獨立稽核。</li>
        <li>主要來源：各廠商官網 + Capterra / G2 / GetApp / Pabau / thesalonbusiness.com 等第三方比價站。</li>
      </ul>
      <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
        由多代理人深度研究產出　|　H Hospitality Group Corporation　|　2026-06-09
      </p>
    </div>
  );
}
