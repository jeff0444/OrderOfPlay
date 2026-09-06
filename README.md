# 羽球排場次

單一 HTML 檔案的羽球排場工具，資料只存在使用者裝置的瀏覽器（`localStorage`），沒有後端、沒有帳號。

## 功能

- 球員管理：姓名、程度 (1-5)、固定搭檔、在場/休息狀態
- 場地設定：可調整場地數量、單打/雙打模式
- 自動排場：
  - 依「已上場次數」與「等待輪數」優先安排較少上場的人
  - 同一組會依程度平衡配對（強配弱 vs 中配中）
  - 固定搭檔一定會被排在同一隊
  - 盡量避免短期內重複遇到同一對手/搭檔
- 記錄勝負、查看每人上場次數與勝率、歷史對戰紀錄
- 匯出/匯入 JSON 備份

## 使用方式（兩種都可以）

1. **線上使用**：直接開啟 GitHub Pages 網址（見下方設定步驟）。
2. **離線使用**：下載 [`index.html`](index.html)，雙擊用瀏覽器開啟即可，不需要網路。

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新 repository（public 或 private 皆可，Pages 免費方案 public 較方便）。
2. 把這個資料夾的內容 push 上去：
   ```bash
   git remote add origin <你的 repo 網址>
   git branch -M main
   git push -u origin main
   ```
3. 到 repo 的 **Settings → Pages**，Source 選擇 `Deploy from a branch`，Branch 選 `main` / `(root)`，儲存。
4. 幾分鐘後即可用 `https://<你的帳號>.github.io/<repo名稱>/` 開啟。
5. 若有自己的網域，也可以在 Pages 設定加上 Custom domain。

## 資料備份提醒

所有資料都只存在瀏覽器的 `localStorage`，換裝置、清瀏覽器資料都會遺失。建議定期在「球員」頁按「匯出備份 (JSON)」保存檔案。
