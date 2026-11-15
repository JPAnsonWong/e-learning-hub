# 新增、修改或刪除右上角「連結」選單

選單內容全部在一個檔案：[config/links.json](../config/links.json)。不用改任何程式碼。

## 格式
```json
{
  "links": [
    { "name": "拔河遊戲", "url": "https://timhing.github.io/SnakeGame/tug-of-war/" },
    { "name": "貪食蛇遊戲", "url": "https://timhing.github.io/SnakeGame/" },
    { "name": "Vocabulary Practice", "url": "https://timhing.github.io/Vocabulary/" }
  ]
}
```
- `name`：選單裡顯示的名稱。
- `url`：必須以 `https://` 或 `http://` 開頭，不能有空格。
- 選單的順序就是檔案裡的順序；點名稱會在**新分頁**打開。
- 行與行之間要有逗號，**最後一項後面不要加逗號**。

## 新增一個連結（在 GitHub 網頁上操作，最簡單）
1. 打開 <https://github.com/JPAnsonWong/e-learning-hub/blob/main/config/links.json>，點右上角的鉛筆圖示（Edit）。
2. 複製其中一整行 `{ "name": ..., "url": ... }`，貼在下面，改成新的名稱和網址。上一行的結尾要補逗號。
3. 點 **Commit changes**，選 **Create a new branch for this commit and start a pull request**，再按 **Propose changes**，最後在 PR 頁面按 **Create pull request**。
4. 等頁面上的檢查（validate）變成綠色勾，按 **Merge pull request**。
5. 約 1 到 2 分鐘後網站更新，重新整理就看到新連結。

走 PR 的好處是：寫錯格式（漏逗號、網址不是 http 開頭等）時，檢查會失敗並指出哪一項有問題，不會影響線上的網站。

## 修改或刪除
同樣打開 `config/links.json`，改掉名稱或網址，或刪掉整行 `{ ... }`（注意逗號）。

## 也可以請 AI 幫忙
把要新增的名稱和網址告訴 AI，請它修改 `config/links.json` 並開 Pull Request，你再合併。

## 注意
- 連結只是跳到別的網站，不會記錄學習時間和積分。
- 這個選單目前顯示在首頁、學生頁和學習記錄頁的右上角；教材開啟頁（有工具列的那頁）沒有。
