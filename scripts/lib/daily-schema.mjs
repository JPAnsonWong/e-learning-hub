// 每日打卡相關的 Notion 資料庫結構（純資料，不做任何網絡操作）。
// 規則：寫入權以註解標示；網站永遠不覆蓋「積分」；勾選框預設是「沒勾」，所以用「隱藏／停用」而不是「顯示／可用」，新增一列預設就是顯示、可用。

export const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const opts = (names, colors = []) => ({ select: { options: names.map((name, i) => ({ name, ...(colors[i] ? { color: colors[i] } : {}) })) } });

export const DAILY_SCHEMAS = {
  // 每天每個孩子每個任務一列
  daily: {
    title: '每日任務',
    props: {
      任務: { title: {} },                                   // 系統／爸爸
      日期: { date: {} },                                    // 系統（香港時間）
      孩子: opts(['女兒', '兒子'], ['pink', 'blue']),         // 系統／爸爸
      分類: opts(['學習任務', '日常習慣', '每周任務']),         // 系統
      選填: { checkbox: {} },                                // 系統：來自 Routine Items 的「選填」；選填任務不影響「全部完成」慶祝
      排序: { number: {} },                                  // 系統：任務顯示順序（Routine Items 的順序）
      '範本 Key': { rich_text: {} },                         // 系統：對應 Routine Items，防止重複生成
      打卡: { checkbox: {} },                                // 網站（同步寫入）；爸爸取消＝更正
      打卡時間: { date: {} },                                // 網站，精確到秒
      積分: { number: {} },                                  // 系統預設＝任務分數；爸爸可改；空白＝待評分；網站永不覆蓋
      備註: { rich_text: {} },                               // 爸爸：更正原因，網站會顯示
      '⚠ 連續快速打卡': { checkbox: {} },                     // 系統：只給爸爸看
      Key: { rich_text: {} },                                // 系統：內部去重
    },
  },
  // 倒數日
  days: {
    title: '重要日子',
    props: {
      事項: { title: {} },
      日期: { date: {} },
      對象: opts(['女兒', '兒子', '全家'], ['pink', 'blue', 'gray']),
      說明: { rich_text: {} },
      隱藏: { checkbox: {} },                                // 勾選＝暫時不顯示（預設顯示）
      類型: opts(['考試', '假期', '生日', '活動', '其他']),
    },
  },
  rewards: {
    title: '獎勵',
    props: {
      名稱: { title: {} },
      所需積分: { number: {} },
      停用: { checkbox: {} },                                // 勾選＝暫時下架（預設可兌換）
      每週上限: { number: {} },
      圖示: { rich_text: {} },
      說明: { rich_text: {} },
    },
  },
  redemptions: {
    title: '兌換記錄',
    props: {
      獎勵: { title: {} },
      孩子: opts(['女兒', '兒子'], ['pink', 'blue']),
      日期: { date: {} },
      扣除積分: { number: {} },
      狀態: opts(['申請中', '已批准', '已拒絕'], ['yellow', 'green', 'red']),
      備註: { rich_text: {} },
      Key: { rich_text: {} },
    },
  },
};

// 既有「Routine Items」要補的欄位（空白＝每天）
export const ROUTINE_TITLE = 'Routine Items';
export const ROUTINE_EXTRA = {
  適用星期: { multi_select: { options: WEEKDAYS.map((name) => ({ name })) } },
  選填: { checkbox: {} },                                  // 勾選＝選填任務（例如「若有」的補習功課），不影響「全部完成」
};

export const isTitleProp = (def) => Object.prototype.hasOwnProperty.call(def, 'title');
