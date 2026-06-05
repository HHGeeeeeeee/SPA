# 狀態機 + Shift/Folio 改造 — 定案 Plan

> 狀態:設計定案,尚未實作。測試資料可刪庫重建,migration 不需轉舊資料。
> 相關 Help 文章:`help_articles` slug `order-and-service-status`(描述的就是這份的目標行為)。

## 0. 總綱

1. **砍乾淨兩條狀態機** — Order 去掉 `open` 與死態 `reserved`/`posting`;Line 把 `unassigned`/`scheduled` 併成單一 `draft`,床/按摩師指派與狀態脫鉤。
2. **讓每一筆 posting 都有家** — 收入認列(服務進 `in_service`)與收款(`takePayment`)都寫成一列 **folio line**,當下綁定一個**開著的 shift**;沒有開班就擋下,關班後該 shift 不能再進。

---

## 1. Order 狀態機(目標)

```
draft ──第一條 line Start(需 open shift)──▶ in_service ──所有 line 結束──▶ completed
                                                 ▲                            │ 全額付清
                  reopen / redo / switch ────────┘                            ▼
                  (completed → in_service)                                  paid
                                                          每日 Revenue Confirm │
                                                                              ▼
                                                                           closed (終態)

  任何非終態 ──voidOrder──▶ void (終態, paid_cents 歸零)
```

- 狀態值:`draft, in_service, completed, paid, closed, void`(6 個)。
- 砍掉 `open`;`reopen`/`redo`/`switchService` 原本回 `open` → 改回 `in_service`。
- `ALLOWED_NEXT` 改為 `draft→in_service→completed`(拿掉 open 那層);`paid` 由 `takePayment`、`closed` 由 Revenue Confirm。

## 2. Line 狀態機(目標,6 態)

```
                指派/清空 床+按摩師「不改狀態」(只改 resource_id / therapist_id)
                                   ↕
  add ──▶ ┌───────┐  Start(需 service_item + open shift → 拋 folio revenue)  ╔════════════╗
          │ draft │──────────────────────────────────────────────────────────▶║ in_service ║──┐
          └───────┘                                                            ╚════════════╝  │ Finish
            │  │  │                                                  Interrupt        │         ▼
   Cancel ──┘  │  └── No-show                                        (做到一半停)      │  ┌───────────────────┐
   (開始前)     │     (沒來)                                           ───────────────┘  │ service_completed │ 鎖定·不可改·抽佣
              ▼  ▼                                                       ▼                └───────────────────┘
        ┌───────────┐ ┌─────────┐                              ┌─────────────┐
        │ cancelled │ │ no_show │                              │ interrupted │
        └───────────┘ └─────────┘                              └─────────────┘
         三個取消狀態:釋放床+按摩師「佔用」(別人可訂),resource_id/therapist_id 值保留
```

- 狀態值:`draft, in_service, service_completed, interrupted, cancelled, no_show`(6 個)。
- `unassigned` + `scheduled` → 合併成 `draft`,DEFAULT `draft`。**有沒有床/按摩師看 `resource_id`/`therapist_id` 欄位,不看狀態。**
- **三個取消狀態(interrupted / cancelled / no_show)**:不合併,維持三個值,但行為一致 —
  - **佔用釋放**:從可用性/排程佔用計算中放掉那張床、那位按摩師(別的單可訂)。
  - **資料保留**:line 上的 `resource_id`/`therapist_id` 值不清空(歷史看得到本來排了誰)。
- 名詞澄清:之前口語說的「取消家族」= 這三個狀態的合稱,不是系統實體。

## 3. 財務分層

| Line 狀態 | 進帳單(folio 預期) | 認列收入(拋 folio revenue) | 抽佣 |
|---|:---:|:---:|:---:|
| draft | ✅ 預期 | ❌ | ❌ |
| in_service | ✅ | ✅(拋一列 revenue) | ❌ |
| service_completed | ✅ | ✅ | ✅ |
| interrupted | ✅(保留已拋) | ✅(已拋,手動調) | ❌ |
| cancelled | ❌ 零 | ❌ | ❌ |
| no_show | ❌ 零 | ❌ | ❌ |

- `cancelled`/`no_show` 只能從 `draft` 來 → **從未拋收入 → 乾淨歸零**。
- `interrupted` 只能從 `in_service` 來 → **收入已拋,folio 上那列保留**,desk 手動補開 folio_line 調整(可能再給折扣)。
- 認列收入 = `in_service` 起;抽佣 = 只有 `service_completed`。

---

## 4. Shift 與 Folio 變成實體(posting 的家)

### 4.1 新 `shifts` 表(shift 為主,`cash_reconciliations` 逐步退役)
```
shifts
  id              UUID PK
  branch_id       FK → branches
  business_date   DATE
  label           TEXT          -- 班別名(沿用 cash_shift_config 的命名)
  status          'open' | 'closed'
  opened_by, opened_at
  closed_by, closed_at
  opening_float_cents
  -- 結班盤點(原 cash_reconciliations 的欄位併進來)
  closing_count_cents, variance_cents, variance_reason
  UNIQUE (branch_id, business_date, label)
```
- **開班** = 建一筆 `status='open'`(手動,見第 5 節 Shift Remittance 頁的按鈕)。
- `cash_reconciliations` 不再寫新資料,後續 migration 退役。

### 4.2 新 `folio_lines` 表(一張 order 一個 folio,底下多列)
```
folio_lines
  id              UUID PK
  order_id        FK → orders          -- folio = 一張 order(不另開 folio 表)
  shift_id        FK → shifts          -- 每筆 posting 都綁一個開著的 shift
  kind            'revenue' | 'payment' | 'refund' | 'tip'
  amount_cents    INTEGER
  posted_at, posted_by
  -- kind=revenue --
  order_item_id   FK → order_items     -- 來源服務行
  -- kind=payment/refund/tip(收款細節直接併進來,payments 表逐步退役)--
  payment_method_id FK → payment_methods
  card_last4, auth_code, payment_ref
  stored_value_card_id
  tip_cents
```
- **決策(b)**:收款細節併進 `folio_lines`;`payments` 表停止寫入,之後退役。

### 4.3 Posting 寫入點(都要先有 open shift,否則擋)
- 服務 `draft → in_service`(Start):寫一列 `kind='revenue'`,`amount_cents = order_item.final_amount_cents`(含折扣整筆),`order_item_id` 指過去,`shift_id` = 當下 open shift。
- `takePayment`:寫一列 `kind='payment'`(+ method 等細節),`shift_id` = 當下 open shift。
- 退款 / 小費:同樣各寫一列。
- **找不到該 branch 當下開著的 shift → 動作擋下**(引導去 Shift Remittance 開班)。

### 4.4 關班即鎖
- `shifts.status='closed'` 後,不能再往該 shift 寫 `folio_lines`(現況是默默灌進已關窗變 variance,要修掉)。

---

## 5. 新頁面:Shift Remittance(取代現在 Shift Cash Count 的結構)

現在點進去直接是單一抽屜盤點 → 改成先看每一班、再點進去。
```
Shift Remittance — 選 branch + date
  ▼ 當天每個 shift 一張卡:
     ┌ Morning 09:00–17:00 · OPEN
     │   Revenue 合計 / Cash 收款 / Card / 應收抽屜 / variance
     │   [ 進去看明細 · 結班 ]
     └ Evening 17:00–24:00 · 尚未開班   [ 開班 ]
  ▼ 點進某一班 → 該班 folio_lines 明細(每筆 revenue/payment)+ 盤點 counted cash + 關班
```
- 「Counted cash / Close」那塊移到**點進單一 shift 之後**才出現。
- 班別時間窗沿用既有 `cash_shift_config`([shifts.ts](../src/app/(dashboard)/reconciliation/cash/shifts.ts)),但「這一班存不存在/開沒開」改由 `shifts` 表決定。

---

## 6. 定案決策(已鎖)

1. **folio_lines = 唯一帳本**,收款細節併入,`payments` 退役。【(b)】
2. **一張 order 一個 folio**(`folio_lines.order_id` 分組,不另開 folio 表)。
3. **`shifts` 為主**,盤點/結班欄位併進 shifts,`cash_reconciliations` 退役。
4. **revenue 拋帳金額 = `final_amount_cents`(含折扣)整筆**;後續調整再補開 folio_line。
5. **open shift = 手動按鈕**(在 Shift Remittance 頁)。
6. **open shift 的定義** = Shift Remittance / `shifts` 表那個開著的 cash shift(folio posting 的家)。
7. 測試資料可刪庫重建,migration 不需轉舊狀態值。

---

## 7. 要動的檔案(分層)

| 層 | 內容 | 主要檔案 |
|---|---|---|
| DB | `shifts`、`folio_lines` 兩張新表;`order_items`/`orders` CHECK 改 6 態(default draft) | 新 migration |
| Shift actions | 開班/關班;posting 解析 open shift + 守衛 | 新 `reconciliation/shift-remittance/actions.ts`、[cash/actions.ts](../src/app/(dashboard)/reconciliation/cash/actions.ts) |
| Folio/Order actions | `takePayment`→寫 payment folio_line;Start→寫 revenue folio_line + 串 open shift;add/update 恆 draft;finish 鎖定;interrupt 簡化(不自動算部分,保留已拋);markNoShow/skip 守衛 draft;maybeAutoComplete/ALLOWED_NEXT/reopen 對齊 | [sales-orders/actions.ts](../src/app/(dashboard)/sales-orders/actions.ts) |
| recon/報表 | cash/EOD 改讀 `folio_lines` + `shift_id`(不再 `paid_at` 時間分桶);EOD「未完成」守衛去掉 open;commission 維持 service_completed | end-of-day、commission、cash actions |
| 看板/可用性 | rail vs 床格改用 `resource_id` 有無;可用性排除三個取消狀態 | [shift-schedule/*](../src/components/shift-schedule/) |
| UI | order-workspace 狀態標籤/按鈕門檻對齊、編輯門檻 `['draft']`;新 Shift Remittance 頁 | [order-workspace.tsx](../src/components/sales-orders/order-workspace.tsx)、新頁 |

---

## 8. 施工順序(每步 build-green、可獨立 commit)

1. **地基**:`shifts` + `folio_lines` 兩表 + 開班/關班 action(行為中性,先不擋)。
2. **Shift Remittance 頁**:列班 → 開班 → 點入明細 → 結班。
3. **拋帳寫入點**:`takePayment` 寫 payment folio_line + open-shift 守衛(payments 先雙寫或直接切換)。
4. **狀態機 DB**:改兩個 CHECK(空庫直接換)。
5. **Line/Order actions 對齊** + Start 拋 revenue folio_line(接 1、3)。
6. **看板/可用性 repoint**:resource_id 分流、三個取消狀態釋放佔用。
7. **UI + recon/報表過濾校正**:cash/EOD 改讀 folio_lines + shift_id。

---

## 9. 之後再處理(deferred)
- `payments` / `cash_reconciliations` 兩張舊表的正式退役 migration(等新路徑穩定後)。
- 跨午夜班別的 minute-of-day 邊界(綁 shift_id 後歷史不再受設定變動影響,但開班當下仍要正確判斷現在屬哪一班)。
- folio_lines 的正負號約定(payment/refund 方向)實作時定。
