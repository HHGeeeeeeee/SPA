# Transaction Code 全面重整計畫

> 狀態：**待確認** — 看完後拍板，再動工。
> 前情：Revenue Confirm 已刪除，ERP 唯一過帳節點 = Shift Remittance（close shift 時從 folio_lines 依 transaction code 聚合成一張 GL journal）。

## 設計原則（本次重整的三條鐵律）

1. **GL 科目只存在 transaction_codes 上。** 程式碼、master data、UI 一律不寫死科目（40140 / 20500 / 50170 全部移除）。
2. **transaction_codes 是全域 master data，不綁 branch。** 一套 code 全集團共用；開新店零設定。
3. **Branch 與 code 都在交易當下決定。** Branch = 這筆 folio line 掛的 shift 的 branch；code = 從交易來源（payment method / billing destination / service category）綁的 code 直接拿，不再用「科目反查」。

## 現況問題（review 結論回顧）

| # | 問題 | 位置 |
|---|---|---|
| 1 | payment vs tip code 靠 `credit_account=20500` 區分；手動 revenue 靠 `credit_account=40140` 反查 | `sales-orders/actions.ts` `resolveTxCodeId` / `resolvePaymentTxCodeId`、`folio-actions.tsx` 預覽 |
| 2 | 小費 AP Bill 科目 `20500` 寫死在程式 | `reconciliation/tips/actions.ts:57` |
| 3 | `billing_destinations.intercompany_account/sub` 把科目綁在 master data | schema + seed |
| 4 | `transaction_codes.branch_id` 把 code 切成每店一套 | schema、settings UI、所有 resolver |
| 5 | SOA settle 跟 AR 掛帳共用同一顆 bill-to code → 結清變成再掛一次帳（AR 清不掉、營收 double） | `soa/actions.ts settleSOA` |
| 6 | 小費分錄：payment line 記 gross（含小費）且 code CR 40140，tip code 又 DR 10121 → 10121 與 40140 都多算小費 | seed `PAYMENT-TIP-PAYMAYA` |
| 7 | 儲值卡核銷抓到「購卡」方向的 code（DR 現金/CR 20510）；購卡收的真現金完全不寫 folio、不進 shift / GL | `resolvePaymentTxCodeId` + `stored-value-cards/actions.ts` |
| 8 | `settle` 型 code（SETTLE-AR-*、SETTLE-SVC、SETTLE-TIP-TO-AP）runtime 沒有任何地方使用 — 死設定 | seed vs 全 codebase |
| 9 | kind=revenue 線靠「REVENUE-SVC 沒填 DR」才沒過帳；哪天補上 DR 整天營收 double | `shift-erp-posting.ts:71` |
| 10 | 兩個收款入口（結帳卡片 + folio tab Add payment）重複 | `customer-payment-card.tsx` / `folio-actions.tsx` |

## 目標設計

### A. Schema

**transaction_codes（全域化）**

```
保留：id, code, transaction_type, debit_account, debit_subaccount,
      credit_account, credit_subaccount, active, created_at/updated_at
刪除：branch_id（含 branch unique index / logical key index）
刪除：payment_method_id（綁定反轉到 payment_methods 上）
待定：debit_branch_id / credit_branch_id（DR/CR branch override，見「決策點 2」）
新增 constraint：code 全域唯一；active code 必須 DR、CR 帳戶皆填
```

資料遷移：同名 code（HSPA1/HSPA2 各一份）合併為一筆 → repoint `folio_lines.transaction_code_id`、`service_categories.revenue_transaction_code_id`、`billing_destinations.transaction_code_id` → 刪重複列 → drop 欄位。

**payment_methods（新增三個 code 綁定）**

| 欄位 | 用途 | 範例 |
|---|---|---|
| `transaction_code_id` | 一般收款/退款 | cash → PAYMENT-CASH (DR 10108/CR 40140) |
| `tip_transaction_code_id` | 小費（沒綁 = 該方式不能收小費） | paymaya → TIP-PAYMAYA |
| `topup_transaction_code_id` | 儲值卡購卡/加值收款（沒綁 = 不能用來買卡） | cash → TOPUP-CASH (DR 10108/CR 20510) |

**billing_destinations**

| 欄位 | 用途 |
|---|---|
| `transaction_code_id`（語意=掛帳 charge code） | AR 掛帳：DR 10200/CR 40140（可全 destination 共用一顆） |
| `settle_transaction_code_id`（**新增**） | SOA 結清：intercompany → DR 50170/CR 10200；third-party → DR 10111(銀行)/CR 10200 |
| `intercompany_account` / `intercompany_sub` | **刪除**（被 code 綁定取代） |

**folio_lines**：結構不動（user 確認 folio 模型正確）。順手刪死欄位 `tip_cents`。`branch_id` 保留，但規則明文化：**永遠 = shift 的 branch**（insert 時由 shift 推導，不再讓各 action 自己傳）。

**service_categories**：不動（`revenue_transaction_code_id` 已是正確 pattern）。

### B. 各情境交易時的決定邏輯（After）

| 情境 (kind) | transaction code | branch |
|---|---|---|
| 服務收入 revenue（finish/interrupt） | `service_category.revenue_transaction_code_id` | station branch ?? order branch → 該 branch open shift |
| 手動 Add revenue / Adjust charge | dialog 下拉選 revenue 型 code（不再寫死 40140） | 操作者選 branch → open shift |
| 收款 / 退款 payment/refund | `payment_method.transaction_code_id` | 操作者選 branch → open shift |
| 小費 tip | `payment_method.tip_transaction_code_id` | 同收款 |
| AR 掛帳（method=ar） | `billing_destination.transaction_code_id` | 同收款 |
| SOA settle / unsettle | `billing_destination.settle_transaction_code_id` | SOA branch → open shift |
| 儲值卡核銷（拿卡付帳） | stored_value_card method 的 `transaction_code_id` = REDEEM-SVC (DR 20510/CR 40140) | 同收款 |
| 儲值卡購卡/加值（**新增 folio line**） | 付款方式的 `topup_transaction_code_id` | 操作者 branch → open shift（現金進 drawer count） |

### C. 全域 code 清單（取代現有 seed）

| code | type | DR | CR | 用途 |
|---|---|---|---|---|
| PAYMENT-CASH | payment | 10108 | 40140 | 現金收款 |
| PAYMENT-PAYMAYA | payment | 10121 | 40140 | PAYMAYA 收款（gross 含小費） |
| CHARGE-AR | payment | 10200 | 40140 | AR 掛帳 |
| TIP-PAYMAYA | tip（新 type） | **40140** | 20500 | 小費自營收轉列負債（見決策點 1） |
| REDEEM-SVC | payment | 20510 | 40140 | 儲值卡核銷 |
| TOPUP-CASH / TOPUP-PAYMAYA | topup（新 type） | 10108 / 10121 | 20510 | 購卡/加值 |
| SETTLE-AR-IC | settle | 50170 | 10200 | intercompany SOA 結清 |
| SETTLE-AR-3P | settle | 10111 | 10200 | third-party SOA 結清（bank） |
| REVENUE-SVC（等） | revenue | —（不過帳） | — | 服務認列線，僅供營運報表 |

transaction_type 集合改為：`revenue / payment / tip / settle / topup`（`cost`、`adjust` 無人使用 → 刪）。

### D. ERP 聚合（shift-erp-posting.ts）

1. **白名單過帳**：只聚合 kind ∈ {payment, refund, tip, settle 對應的 lines, topup}；**kind=revenue 明確排除**（收現制 — GL 營收由收款 code 的 CR 40140 入帳；AR 由掛帳 code 入帳）。不再靠「code 缺 DR 所以 skip」這種隱性行為。
2. revenue 型 code 不再要求 GL 帳戶；其他 type 的 active code 缺 DR/CR → **聚合時報錯**（擋下 close shift），不再沉默跳過。
3. 每行 GL 的 branch = folio line 的 branch（= shift branch）；code 的 DR/CR branch override 依決策點 2。

### E. 程式改動清單

| 檔案 | 改動 |
|---|---|
| `sales-orders/actions.ts` | 刪 `TX_REVENUE_ACCOUNT`/`TX_TIPS_PAYABLE`/`resolveTxCodeId`/`resolvePaymentTxCodeId`；takePayment/recordRefund/tip 改讀 method 綁定；addRevenue/adjustCharge 接受 dialog 傳入的 revenue code id（server 驗證 type） |
| `soa/actions.ts` | settle/unsettle 改用 `settle_transaction_code_id` |
| `reconciliation/tips/actions.ts` | AP Bill 科目改讀 SETTLE-TIP-TO-AP code（20500 不再寫死） |
| `stored-value-cards/actions.ts` | 購卡/加值寫 folio line（掛 shift）；核銷走 method 綁定 |
| `reconciliation/cash/actions.ts` | expected cash 改用 `folio_lines.branch_id` 過濾（不再 join orders — order_id null 的 top-up / settle 現金才算得進 drawer） |
| `shift-erp-posting.ts` | 上節 D |
| Settings UI | transaction-codes 頁：拿掉 branch/method 欄位；payment-methods 頁：三個 code picker；billing-destinations 頁：charge + settle 兩個 picker |
| `folio-actions.tsx` / `customer-payment-card.tsx` | code 預覽改讀綁定；依決策點 3 刪 folio tab Add payment |
| seeds | `seed-billing-sources.mjs` 改為上面的全域 code 清單 + 綁定 |

## 決策點（請拍板）

1. **小費分錄**（建議方案 a）
   - (a) payment line 維持 gross，TIP-PAYMAYA = DR 40140/CR 20500。folio 不動、對 PAYMAYA 終端機對帳最直觀（payment line = 實際刷卡額）。
   - (b) payment line 改記淨額，TIP-PAYMAYA = DR 10121/CR 20500。每條 line = 一筆真實金流，但 order total/paid 計算邏輯要重寫。
2. **code 上的 DR/CR branch override**（建議保留）：預設空 = 用交易 branch；只有 intercompany 這類「某一腿固定過總部/對方 segment」的分錄才填。若刪掉，需另想 intercompany 對方 branch 的來源。
3. **folio tab 的 Add payment**（建議刪除，保留 Add refund）：收款只走結帳卡片（含小費、per-guest cap），消除雙入口。

## 實作順序

1. Migration（transaction_codes 全域化 + 綁定欄位 + 資料合併/repoint + seed 重建）
2. Server actions（resolver 反轉）
3. shift-erp-posting（白名單 + 報錯）
4. 儲值卡 folio 化 + cash recon 改 branch 過濾
5. Settings / dialog UI
6. `npx supabase gen types` + `tsc` + 手動走流程驗證（各付款方式 / AR→SOA→settle / 儲值購卡核銷 / tip / close shift dump GL lines）
