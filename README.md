# 🏐 排球揪團雷達

即時掌握台北各場館的排球場次，快速找到缺人的場，讓每一場都能順利開打。

---

## 🚀 部署到 Vercel（免費）完整教學

### 事前準備

你需要：
- 一個 [GitHub 帳號](https://github.com)（免費）
- 一個 [Vercel 帳號](https://vercel.com)（免費，可用 GitHub 登入）

### 步驟一：上傳到 GitHub

1. 登入 GitHub，點右上角 **+** → **New repository**
2. Repository name 填 `volleyball-radar`
3. 選 **Public** 或 **Private** 都可以
4. 點 **Create repository**
5. 把這整個資料夾的檔案上傳到這個 repo：
   - 最簡單的方式：在 repo 頁面點 **uploading an existing file**，把整個資料夾裡的檔案拖進去
   - 或者用 Git 指令：
     ```bash
     cd volleyball-radar
     git init
     git add .
     git commit -m "初始版本"
     git branch -M main
     git remote add origin https://github.com/你的帳號/volleyball-radar.git
     git push -u origin main
     ```

### 步驟二：在 Vercel 部署

1. 前往 [vercel.com](https://vercel.com)，用 GitHub 帳號登入
2. 點 **Add New...** → **Project**
3. 找到剛剛建立的 `volleyball-radar` repo，點 **Import**
4. Vercel 會自動偵測這是 Vite 專案，設定不需要改
5. 點 **Deploy**
6. 等待約 30 秒，部署完成後會得到一個網址，例如：
   `https://volleyball-radar.vercel.app`

### 步驟三：嵌入 WordPress

1. 在 WordPress 後台，進入你要放這個功能的 **頁面** 或 **文章**
2. 新增一個 **自訂 HTML** 區塊（在區塊編輯器中搜尋 "HTML"）
3. 貼上以下程式碼（把網址換成你的 Vercel 網址）：

```html
<div style="width:100%; max-width:800px; margin:0 auto;">
  <iframe
    src="https://你的網址.vercel.app"
    width="100%"
    height="900"
    style="border:none; border-radius:12px; overflow:hidden;"
    loading="lazy"
    title="排球揪團雷達"
  ></iframe>
</div>
```

4. 發佈頁面，完成！

---

## 💻 本機開發（選用）

如果你想在自己的電腦上修改程式碼：

```bash
# 安裝套件
npm install

# 啟動開發伺服器
npm run dev

# 打包成靜態檔案
npm run build
```

---

## 📁 專案結構

```
volleyball-radar/
├── index.html          ← 網頁入口
├── package.json        ← 套件設定
├── vite.config.js      ← Vite 打包設定
├── README.md           ← 你正在看的這個檔案
└── src/
    ├── main.jsx        ← React 啟動點
    └── App.jsx         ← 主要功能程式碼
```

---

## 📝 功能列表

- ✅ 即時顯示各場館排球場次與報名狀態
- ✅ 四種狀態分色：募集中 / 即將成團 / 已成團 / 已滿
- ✅ 主揪可自由開場（自訂場地、人數、費用等）
- ✅ 主揪密碼驗證後可編輯所有欄位
- ✅ 支援外部報名連結（FB 社團、個人網站等）
- ✅ 依日期、地區、程度篩選
- ✅ 依缺人優先、時間、費用排序
