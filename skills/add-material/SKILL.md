---
name: add-material
description: 為 E_learning Hub（公開 GitHub 倉庫 JPAnsonWong/e-learning-hub）新增或修改一份教材：建立單頁 HTML 教材和 meta.json，開 Pull Request 等爸爸審核。用於「新增教材」「上傳教材」「把這個 HTML 掛到學習網站」等請求。
---

# 新增教材到 E_learning Hub

這份說明不依賴任何特定 AI 工具，只需要 `git`、`gh`（GitHub CLI）和 Node.js 18+。

## 硬規則（先讀）
1. **倉庫是公開的。** 教材內容、檔名、meta.json、提交訊息、PR 說明中，**絕對不得出現孩子的真實姓名、暱稱、學校名稱或其他個人資料**。用「女兒」「兒子」代替。班別（如「3D」）可以出現。
2. **只能開 Pull Request，不得自己合併**，也不得直接推送到 `main`。合併由爸爸審核後決定。
3. 不要修改 `config/`、`scripts/`、`assets/`、`.github/`，除非爸爸明確要求（例如新增階段或科目）。

## 步驟

### 1. 取得倉庫
```
gh auth status          # 確認登入的是 JPAnsonWong；不是就停下來告訴爸爸
git clone https://github.com/JPAnsonWong/e-learning-hub.git
cd e-learning-hub
git checkout -b add-<教材id>
```

### 2. 讀取有效的分類 ID（不要憑記憶，一律讀檔）
- `config/students.json`：學生 `id`，以及每位學生可用的科目 `id`。
- `config/stages.json`：階段 `id`（如 `g3-3d-exam1`）。
- `config/types.json`：教材類型 `id`；`tags` 是可手動加的標籤（目前只有 `key` = 重點）。

如果需要的學生、科目或階段不存在，**停下來問爸爸**，不要自己亂填。

### 3. 建立教材資料夾
```
content/<id>/index.html
content/<id>/meta.json
```
- `<id>`：小寫英文、數字、連字號，全倉庫唯一，例如 `math-3d-fractions-01`。資料夾名必須等於 meta.json 的 `id`。

### 4. 製作 index.html
- **單頁自足**：CSS、JS 都寫在同一檔內，圖片用 `data:` URI 或同資料夾相對路徑，不依賴外部網路資源。
- 要能在手機、平板、電腦和 65 寸 4K 觸控大屏正常使用：用相對單位（`rem`、`vmin`、`clamp()`），按鈕和可點擊區域夠大（建議不小於 3rem），不依賴滑鼠懸停。
- 網站會用 iframe 顯示教材，上方有一條約 3.6rem 的工具列，頁面不要假設自己佔滿整個視窗高度以外的任何東西。
- 字體用系統字體（`"PingFang TC","Microsoft JhengHei",sans-serif`）。
- 內容用繁體中文，除非是語言科目需要其他語言。
- 設定 `<title>`，不含任何個人資料。

### 5. 撰寫 meta.json
```json
{
  "id": "math-3d-fractions-01",
  "student": "daughter",
  "subject": "math",
  "stage": "g3-3d-exam2",
  "type": "practice",
  "title": "分數專項練習",
  "unit": "分數",
  "tags": [],
  "difficulty": 2,
  "minutes": 20,
  "version": 1,
  "date": "2026-11-20"
}
```
- 必填：`id` `student` `subject` `stage` `type` `title` `date`（YYYY-MM-DD）`version`（正整數）。
- 選填：`unit`、`tags`（只能是 `config/types.json` 裡 `tags` 的 id）、`difficulty`（1、2、3）、`minutes`（正數）、`description`。
- 修改已發布的教材時，把 `version` 加 1。
- 要把教材搬到另一個階段，只改 `stage`。

### 6. 本機驗證
```
node scripts/build-catalog.mjs --check
```
必須輸出 `OK`。失敗時按訊息修正。（不要提交 `catalog.json`，它由部署流程自動生成。）

### 7. 提交並開 PR
```
git add content/<id>
git commit -m "新增教材：<標題>"
git push -u origin add-<教材id>
gh pr create --title "新增教材：<標題>" --body "學生：女兒／兒子；科目；階段；說明教材內容。"
```
PR 的 GitHub Actions 會自動重跑驗證。然後**停下來**，告訴爸爸 PR 連結，等待審核與合併。合併後網站會在 1 到 2 分鐘內自動更新，網址：`https://JPAnsonWong.github.io/e-learning-hub/`。

## 自我檢查清單
- [ ] 全檔搜尋過，沒有孩子真實姓名、暱稱、學校名稱
- [ ] id 唯一，且資料夾名 = id
- [ ] student / subject / stage / type 都取自 `config/` 現有的值
- [ ] `node scripts/build-catalog.mjs --check` 輸出 OK
- [ ] 只開了 PR，沒有合併、沒有推送到 main
