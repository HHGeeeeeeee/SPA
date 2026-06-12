# HHG-SPA POS — Claude Code 工作指南

這是 H Hospitality Group 旗下 SPA 事業體的 POS 系統。

## 設計來源

完整設計文件在 OneDrive 同步資料夾：
`c:\Users\j8967\OneDrive - H Hospitality Group Corporation\AI\SPA\`

包含：
- `SPA_POS_ER_Schema.md` — 完整 45+ 表 ER schema (source of truth)
- `SPA_POS_Create_Sales_Order_Flow.md` — 建單 UI 流程
- `SPA_POS_Reconciliation_UI.md` — 結帳 / SOA / Commission UI
- `SPA_POS_Stored_Value_Card_UI.md` — 儲值卡 UI
- `SPA_POS_Master_Data_UI.md` — Master Data 管理頁
- `SPA_POS_Dashboard_UI.md` — Dashboard 設計
- `SPA request.xlsx` — 原始業務需求

完整 22+ 記憶檔在 `C:\Users\j8967\.claude\projects\...\memory\`，新 session 自動載入。

## 技術選型

- **Next.js 16** (App Router, React 19, TypeScript, Tailwind 4)
- **Supabase** (PostgreSQL + Auth + Storage)
- **Acumatica ERP** (Contract REST API, GL Journal Transaction)
- **jose** for JWT session signing
- **bcryptjs** for Manager PIN hashing
- **zod** for input validation
- **date-fns** for date manipulation

## 整合 Pattern（取自集團現有專案）

來自 `elnidogotravel/st-center` 與 `HHGeeeeeeee/ENGO`：

1. **Acumatica GL Push**：兩階段 PUT (Hold:true → Hold:false release)
2. **Subaccount 不能有 dash**：DB constraint + 程式端 strip
3. **嚴格過帳模式**：ERP 成功才 flip 本地 status，失敗自動 rollback
4. **Per-line BranchID 覆蓋**：每行 GL detail 可獨立指定 branch
5. **雙 cookie**：hhg_spa_session (JWT) + acu_session (Acumatica REST)
6. **Recovery SQL**：ERP 成功但本地 sync 失敗時印 SQL 給 admin 補登

## 業務核心約束

- **抽成**：Commission Class % 為主 + **60-90 分鐘第一次 0%** 規則（每日跨 branch 不重置）
- **小費**：現金小費**不入系統**（客人直接給技師）；只 PAYMAYA 多刷部分入 Tip 表
- **過帳節點**：Shift Remittance（close shift）為唯一 ERP 入帳節點 — 從 folio_lines 依 transaction code 聚合成一張 GL journal。Revenue Confirm 功能已移除（不符 SPA 產業）
- **AR 訂單分流**：Completed (AR) 跳過 Paid 直接 Closed；非 AR Paid → Closed
- **折扣 line level**：每位客人可不同折扣（DIS-00 ~ DIS-99）
- **Service Category 同單可混**：按摩 + 美髮 + 美甲 + 休息可同單

## 核心檔案

- `src/lib/supabase/server.ts` — Server-side Supabase client (含 service role)
- `src/lib/supabase/client.ts` — Browser-side Supabase client
- `src/lib/acumatica.ts` — Acumatica REST 整合
- `src/lib/session.ts` — JWT session 管理 (含 acu_session cookie)
- `src/lib/utils.ts` — 通用 helpers (formatPHP, dateSeqPrefix)

## 開發環境

- Node.js 24
- npm (not pnpm — corepack 在這台機器無 admin)
- 開發目錄：`C:\Users\j8967\dev\hhg-spa-pos`（**不要**在 OneDrive 下開發，node_modules 會同步爆）

## 常用指令

```bash
npm run dev        # 開發伺服器
npm run build      # 編譯
npm run lint       # ESLint

# Supabase CLI 透過 npx (不全域安裝)
npx supabase db push   # 推 migration 到雲端
npx supabase gen types typescript --linked > src/types/database.ts
```

## 上線前待補

- Acumatica 連線資訊（base URL, company, branch, service account）
- Vercel 部署設定
- 真實 Master Data（員工 / 服務項目 / 定價 / 床位）
- Help Articles 內容
- Production SESSION_SECRET（替換 .env.local 的開發用值）
