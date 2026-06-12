# Transaction Code 重整 — 設計與實作紀錄

> 狀態：**第一階段已實作**（2026-06-12，migration `20260612110000`）。
> 未完：Tip 結構調整（見文末）。

## 設計原則

1. **GL 科目只存在 transaction_codes 上**，程式與 master data 不寫死科目。
2. **transaction_codes 是全域 master data**：可選擇性綁 branch（非必填），不再綁 payment method；type 只有 `revenue / payment / tip`。
3. **branch 與 code 都在交易當下決定**，寫進 folio line 的 `dr_branch` / `cr_branch`（自由文字 Acumatica branch segment）。到 Sales Remittance 過帳時，每條 line 的 DR branch/acct/sub 與 CR branch/acct/sub 都已就緒。

## Schema（migration 20260612110000）

| 表 | 變更 |
|---|---|
| `branches` | + `default_revenue_transaction_code_id`（手動 Add revenue / Adjust charge）<br>+ `default_tip_transaction_code_id`（tip line）<br>+ `royal_card_transaction_code_id`（儲值卡核銷） |
| `folio_lines` | + `dr_branch`、`cr_branch`（TEXT；舊資料 backfill 成 shift branch code） |
| `payment_methods` | + `transaction_code_id`（一般收款/退款的 code） |
| `transaction_codes` | − `payment_method_id`；type CHECK 縮為 `revenue/payment/tip`；舊 tip hack（payment + CR 20500）已轉型為 `tip`；settle/cost/adjust 死設定已刪 |

## 各情境的決定邏輯（已實作）

| 情境 | transaction code | dr_branch | cr_branch |
|---|---|---|---|
| 服務 finish / 收費 interrupt | service category 綁定 | **shift branch**（= order branch 的 open shift） | **station branch** ?? shift branch |
| Add revenue / Adjust charge | shift branch 的 default revenue code | shift branch | shift branch |
| 收款/退款 — AR | billing destination 綁定 | code 的 DR branch override ?? shift branch | shift branch |
| 收款/退款 — 儲值卡 | shift branch 的 royal card code | shift branch | shift branch |
| 收款/退款 — 其他 method | payment method 綁定 | shift branch | shift branch |
| 小費 tip | shift branch 的 default tip code | shift branch | shift branch |
| SOA settle / 部分收款 / 負數沖正 | **一般 payment**：操作者選 method（AR、儲值卡除外）→ 該 method 綁定的 code | 操作者選 branch | 同左 |

ERP（close shift）聚合：以 `(transaction_code, dr_branch, cr_branch)` 為 key 淨額，DR 腿 = code 的 DR acct/sub @ line 的 dr_branch、CR 腿 = code 的 CR acct/sub @ line 的 cr_branch；refund 反向；淨額為負時 DR/CR 對調。舊 line（無 dr/cr_branch）fallback：code 的 branch override → shift branch。

實作位置：[sales-orders/actions.ts](../src/app/(dashboard)/sales-orders/actions.ts)（`getBranchPostingInfo` / `resolvePaymentPosting` / `resolveServiceRevenuePosting`）、[soa/actions.ts](../src/app/(dashboard)/reconciliation/soa/actions.ts)、[shift-erp-posting.ts](../src/lib/shift-erp-posting.ts)。

## 設定面（已實作）

- Settings → Transaction Codes：branch 非必填（global）、無 payment method 欄、type 只剩三種、DR/CR 排序 Branch (override) → Account → Subaccount
- Settings → Payment Methods：每個 method 綁一顆 payment code
- Settings → Branches：三個 default code picker（Revenue / Tip / Royal Card）
- Settings → Billing Destinations：綁 AR 掛帳 code（picker 只列 payment 型）
- Settings → Service Categories：綁 revenue code（原本就有）

## SOA（已完成，純文書層）

SOA 本身**不產生任何傳票**：Generate 只建 `revenue_soa` ＋ 標記 AR lines；Void 只釋放標記。
唯一動到錢的是 Settle — 它就是一筆普通 folio payment（dialog 與訂單 Add payment 同款：
選 branch ＋ method，顯示綁定 code 與目標 open shift；金額可部分、可負數沖正），
由所選 branch 的 Sales Remittance 進 ERP。Unsettle 按 method×code×branch 分組鏡射沖回。

**科目純粹由 method 綁定決定**（master data 設定，非程式邏輯）。範例配置：
- 櫃檯現金 `cash` → DR 10108 / CR 40140
- AR 回收現金（另開 method）→ DR 10108 / CR 10200
- Metrobank → DR 10111 / CR 10200

## 待辦 / 已知未決

1. **Tip 結構調整** — 待討論。現況：tip 仍掛在收款動作上、payment line 記 gross（含 tip），TIP-PAYMAYA（DR 10121/CR 20500）聚合後 10121 與 40140 各多算 tip 金額。候選方案：tip code 改 DR 40140；或 payment line 改記淨額；或 tip 從收款拆出獨立動作。
2. **儲值卡購卡/加值**仍未寫 folio line（現金不進 shift / GL）。
3. kind=revenue 線的 code（如 REVENUE-SVC）若補上 DR 帳戶，會與 payment code 的 CR 40140 重複認列 — 收現制下 revenue 線不該過帳，目前仍靠「缺 DR 帳戶 → skip」這個隱性行為擋著，待 tip 討論時一併明確化。
