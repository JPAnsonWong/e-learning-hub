# 啟用 Firebase 同步與 Notion 彙整（一次性設定）

程式已經寫好，網站在 `config/firebase.json` 的 `enabled` 為 `false` 時只用本機儲存。
照下面步驟取得設定值後，把 `enabled` 改成 `true` 並填入設定，網站就會開始同步。

## A. Firebase（約 10 分鐘）

1. 打開 <https://console.firebase.google.com>，用 Google 帳號登入，**新增專案**，名稱例如 `e-learning-hub`，Google Analytics 選**停用**。
2. 左側 **建構 → Firestore Database → 建立資料庫**：選**正式版模式**，位置選 `asia-east2`（香港）。
3. Firestore 的 **規則** 分頁：把倉庫根目錄 `firestore.rules` 的全部內容貼上，按**發布**。
4. 左側 **建構 → Authentication → 開始使用 → 登入方法**：啟用 **電子郵件/密碼**。
5. **Authentication → 使用者 → 新增使用者**：
   - 電子郵件填 `family@elh.app`（必須與 `config/firebase.json` 的 `familyEmail` 和 `firestore.rules` 一致）
   - 密碼自訂一個**夠長的家庭密碼**（孩子每部裝置第一次打開時輸入一次）
6. **Authentication → 設定 → 使用者動作**：取消勾選「啟用建立（註冊）」。
7. **Authentication → 設定 → 已授權網域**：新增 `jpansonwong.github.io`。
8. **專案設定（齒輪）→ 一般 → 你的應用程式 → 網頁（</>）**：暱稱隨意，**不要**勾選 Firebase Hosting，註冊後會看到設定值，記下
   `apiKey`、`authDomain`、`projectId`、`appId`（這些值本來就會出現在網頁裡，不是秘密）。
9. **專案設定 → 服務帳戶 → 產生新的私密金鑰**：下載 JSON 檔，存在你電腦上。**這個檔案是秘密，不要貼給任何人、不要放進倉庫。**

## B. Notion

1. 打開 <https://www.notion.so/profile/integrations>，**新增整合（Internal）**，名稱 `E_learning Hub`，複製 **Internal Integration Secret**（token）。
2. 打開要存放資料的 Notion 頁面 → 右上 **⋯ → 連線（Connections）→ 加入** 剛建立的整合。
   整合只能看到被明確分享的頁面。
3. 記下該頁面網址最後那段 32 位英數字（頁面 ID）。

## C. GitHub Secrets（在終端執行，值不會顯示在日誌）

```
gh secret set NOTION_TOKEN --repo JPAnsonWong/e-learning-hub
gh secret set NOTION_PARENT_PAGE_ID --repo JPAnsonWong/e-learning-hub
gh secret set FIREBASE_SERVICE_ACCOUNT --repo JPAnsonWong/e-learning-hub < 下載的金鑰.json
```
前兩條執行後貼上值再按 Enter。

## D. 啟用

1. 把 A8 的四個值填進 `config/firebase.json`，並把 `"enabled"` 改成 `true`，提交並合併。
2. 打開網站，輸入家庭密碼；右下角出現「☁ 已連線」即成功。
3. 玩幾題後到 GitHub → Actions → **Sync to Notion** → **Run workflow**，檢查 Notion 頁面下是否出現四個資料庫：
   學生概況、教材進度、作答記錄、錯題跟進。之後每天香港時間 06:00 和 18:00 自動同步。

## 注意

- 公開倉庫若 60 天沒有任何活動，GitHub 會自動停用定時任務；收到通知時到 Actions 頁按啟用即可。
- Notion「錯題跟進」的「已跟進」勾選框由你手動勾，同步不會覆蓋。
- Firestore 免費額度（每天 2 萬次寫入、5 萬次讀取）對家用綽綽有餘。
