const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const path = require('path');

// 用法：npm test（預設測專案根目錄的 HTML，也可用參數指定其他檔案）
const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const KEY = 'goddess-tower:history';
// saved：開啟前先放進 localStorage 的存檔（模擬重新整理）；brokenStorage：模擬無痕模式等存取會丟例外的情況
// hash：網址的 #；tab：預存的 tab；serverDate：假的伺服器 Date header（null 表示請求失敗）
const open = ({ saved, brokenStorage, hash = '', tab, serverDate } = {}) => new JSDOM(html, {
  url: 'https://goddess.test/' + hash, runScripts: 'dangerously',
  beforeParse(w) {
    if (saved !== undefined) w.localStorage.setItem(KEY, saved);
    if (tab !== undefined) w.localStorage.setItem('goddess-tower:tab', tab);
    if (serverDate !== undefined) w.fetch = async () => {
      if (serverDate === null) throw new Error('offline');
      return { headers: { get: h => (h.toLowerCase() === 'date' ? serverDate : null) } };
    };
    if (brokenStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('SecurityError'); } });
  },
}).window;
const settle = () => new Promise(r => setTimeout(r, 20)); // 等頁面的非同步校時完成
const load = opts => open(opts).document;

const all = [];
for (let a = 5; a >= 0; a--) for (let b = 5 - a; b >= 0; b--) all.push([a, b, 5 - a - b].join(''));
const correct = (x, y) => [...x].reduce((n, v, i) => n + (v === y[i]), 0);

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const $ = (d, id) => d.getElementById(id);
const click = (d, r) => d.querySelector(`[data-result="${r}"]`).click();
const guess = d => $(d, 'guess').textContent;
const btns = d => [...d.querySelectorAll('[data-result]')];
// 工具已推理出唯一答案：回合標籤會加上「正確答案」
const solved = d => $(d, 'round').textContent.includes('正確答案');

// 照著畫面玩到底：站對（通關）或工具判定已確定答案為止
function play(ans) {
  const d = load(), hist = [];
  while (guess(d) !== ans && !solved(d)) {
    const g = guess(d), r = correct(g, ans);
    hist.push([g, r]); click(d, r);
    assert.strictEqual(d.querySelectorAll('.history-line').length, hist.length, `${ans}：回報 ${g}=${r} 沒被記錄`);
    assert.ok(hist.length < 20, `${ans} 超過 20 步`);
  }
  return { d, steps: hist.length + 1, hist };
}
// 會被推理到「已確定答案」（而不是直接站中）的答案
const deduced = () => all.find(a => solved(play(a).d));

test('初始狀態：500、第 1 次測試、尚未測試', () => {
  const d = load();
  assert.strictEqual(guess(d), '500');
  assert.strictEqual($(d, 'round').textContent, '第 1 次測試');
  assert.strictEqual($(d, 'historyCount').textContent, '尚未測試');
  assert.strictEqual($(d, 'leftPeople').textContent, '●●●●●');
  assert.strictEqual($(d, 'middlePeople').textContent, '—');
  assert.ok(!solved(d));
  assert.ok(btns(d).every(b => !b.disabled));
});

test('已移除的功能不存在', () => {
  const d = load();
  for (const id of ['undo', 'win', 'done', 'copy', 'backRec', 'candidates', 'count']) assert.strictEqual($(d, id), null, id);
  assert.ok(!/上一步|已通關|複製|建議站位|剩餘可能答案/.test(d.body.textContent));
  assert.strictEqual(d.querySelectorAll('.toolbar button').length, 1);
});

const steps = {};
test('21 組答案都能在 5 次內解出，結束時站位就是答案', () => {
  for (const ans of all) {
    const { d, steps: n } = play(ans);
    assert.strictEqual(guess(d), ans, `${ans} 結束時站位是 ${guess(d)}`);
    steps[ans] = n;
  }
  const worst = Math.max(...Object.values(steps));
  assert.ok(worst <= 5, `最壞要 ${worst} 次，應 ≤ 5`);
});

test('測試紀錄與回合數隨回報更新', () => {
  const { d, hist } = play('050');
  const lines = [...d.querySelectorAll('.history-line')];
  assert.strictEqual(lines.length, hist.length);
  hist.forEach(([g, r], i) => {
    assert.ok(lines[i].textContent.includes(g));
    assert.ok(lines[i].textContent.includes(`${r} 個正確`));
  });
  assert.strictEqual($(d, 'round').textContent, `第 ${hist.length + 1} 次測試` + (solved(d) ? ' · 正確答案' : ''));
  assert.strictEqual($(d, 'historyCount').textContent, `${hist.length} 次紀錄`);
});

test('確定答案時回報按鈕全部停用（不消失），回合標籤加上「正確答案」', () => {
  const ans = deduced();
  assert.ok(ans, '找不到會推理到確定答案的情況');
  const { d, hist } = play(ans);
  assert.strictEqual(guess(d), ans);
  assert.strictEqual($(d, 'round').textContent, `第 ${hist.length + 1} 次測試 · 正確答案`);
  assert.strictEqual(btns(d).length, 2);
  assert.ok(btns(d).every(b => b.disabled), '兩顆按鈕都應停用');
  assert.strictEqual($(d, 'single'), null, '不再有額外的提示區塊');
  // 重新開始改成主色：靠 body.solved 切換
  assert.ok(d.body.classList.contains('solved'));
  // jsdom 不解析 CSS 變數，無法比對實際顏色，改為確認換色規則存在
  const rule = [...d.styleSheets[0].cssRules].find(r => r.selectorText === '.solved #reset');
  assert.ok(rule && /background:\s*var\(--accent\)/.test(rule.style.cssText), '缺少 .solved #reset 的換色規則');
  // 還沒推理出答案時不會出現標籤
  const d0 = load(); click(d0, 1);
  assert.ok(!solved(d0));
  assert.ok(!d0.body.classList.contains('solved'));
});

const btn = (d, r) => d.querySelector(`[data-result="${r}"]`);

test('不可能出現的回報按鈕停用並半透明（不隱藏、不放說明）；可能的回報都能按', () => {
  let disabledSeen = 0;
  for (const ans of all) {
    const d = load(), hist = [];
    while (guess(d) !== ans && !solved(d)) {
      const g = guess(d);
      // 用工具外的方式重算剩餘可能答案
      const pool = all.filter(a => hist.every(([hg, hr]) => correct(hg, a) === hr));
      for (const r of [0, 1]) {
        const b = btn(d, r), possible = pool.some(a => correct(g, a) === r);
        assert.strictEqual(b.disabled, !possible, `${g} 回報 ${r}：disabled 應為 ${!possible}`);
        assert.ok(b.isConnected, '按鈕不可移除');
        assert.strictEqual(d.defaultView.getComputedStyle(b).opacity === '0.3', !possible, `${g} 回報 ${r}：停用時才半透明`);
        assert.strictEqual(b.textContent, `${r} 個正確`, '按鈕內不放說明');
        if (!possible) {
          disabledSeen++;
          const before = d.querySelectorAll('.history-line').length;
          b.click(); // 停用的按鈕點了不應有反應
          assert.strictEqual(guess(d), g);
          assert.strictEqual(d.querySelectorAll('.history-line').length, before);
        }
      }
      assert.ok(!(btn(d, 0).disabled && btn(d, 1).disabled), `${g} 兩顆按鈕都停用`);
      const r = correct(g, ans); hist.push([g, r]); click(d, r);
    }
  }
  assert.ok(disabledSeen > 0, '從沒出現過停用的按鈕，測不到');
  const d = load();
  assert.ok(!btn(d, 0).disabled && !btn(d, 1).disabled, '初始兩顆都可按');
  assert.ok(d.querySelector('.foot').textContent.includes('半透明的按鈕代表 NPC 這次不會這樣說'));
});

test('重新開始回到初始狀態並清除提示', () => {
  const { d } = play(deduced());
  $(d, 'reset').click();
  assert.ok(!d.body.classList.contains('solved'));
  assert.strictEqual(guess(d), '500');
  assert.strictEqual($(d, 'historyCount').textContent, '尚未測試');
  assert.strictEqual($(d, 'round').textContent, '第 1 次測試');
  assert.ok(!solved(d));
  assert.ok(btns(d).every(b => !b.disabled));
});

test('進度存進 localStorage，重新開啟後接續', () => {
  const w = open(), d = w.document;
  click(d, correct(guess(d), '050'));
  click(d, correct(guess(d), '050'));
  const saved = w.localStorage.getItem(KEY), g = guess(d);
  assert.strictEqual(JSON.parse(saved).length, 2);
  const d2 = load({ saved });
  assert.strictEqual(guess(d2), g);
  assert.strictEqual(d2.querySelectorAll('.history-line').length, 2);
  assert.strictEqual($(d2, 'round').textContent, '第 3 次測試');
  // 接續後照樣能解完
  while (guess(d2) !== '050' && !solved(d2)) click(d2, correct(guess(d2), '050'));
  assert.strictEqual(guess(d2), '050');
});

test('已確定答案的進度也能還原', () => {
  const ans = deduced();
  const w = open();
  while (guess(w.document) !== ans && !solved(w.document)) click(w.document, correct(guess(w.document), ans));
  const d2 = load({ saved: w.localStorage.getItem(KEY) });
  assert.strictEqual(guess(d2), ans);
  assert.ok(solved(d2));
  assert.ok(btns(d2).every(b => b.disabled));
});

test('重新開始會清掉存檔', () => {
  const w = open();
  click(w.document, 1);
  $(w.document, 'reset').click();
  assert.deepStrictEqual(JSON.parse(w.localStorage.getItem(KEY)), []);
  assert.strictEqual(guess(load({ saved: w.localStorage.getItem(KEY) })), '500');
});

test('壞掉或互相矛盾的存檔：從頭開始並覆蓋存檔', () => {
  const bad = ['{not json', '"x"', '[["999",0]]', '[["500",2]]', '[["500",1],["500",0]]', '[null]'];
  for (const saved of bad) {
    const w = open({ saved }), d = w.document;
    assert.strictEqual(guess(d), '500', `存檔 ${saved} 應從 500 開始`);
    assert.strictEqual($(d, 'historyCount').textContent, '尚未測試', saved);
    click(d, 0); // 還能正常操作
    assert.strictEqual(d.querySelectorAll('.history-line').length, 1, saved);
  }
});

test('localStorage 無法使用時頁面照常運作', () => {
  const d = load({ brokenStorage: true });
  assert.strictEqual(guess(d), '500');
  click(d, correct(guess(d), '122'));
  assert.strictEqual(d.querySelectorAll('.history-line').length, 1);
  $(d, 'reset').click();
  assert.strictEqual(guess(d), '500');
});

test('<title> 與 <h1> 一致', () => {
  const d = load();
  assert.strictEqual(d.title, d.querySelector('h1').textContent);
});

test('站位有 aria-live', () => {
  assert.strictEqual($(load(), 'guess').getAttribute('aria-live'), 'polite');
});

const tab = (d, name) => d.getElementById('tab-' + name);
const panel = (d, name) => d.getElementById('panel-' + name);
const shown = d => ['seal', 'cd'].filter(n => !panel(d, n).hidden);

test('tab：預設顯示封印之室', () => {
  const d = load();
  assert.deepStrictEqual(shown(d), ['seal']);
  assert.strictEqual(tab(d, 'seal').getAttribute('aria-selected'), 'true');
  assert.strictEqual(tab(d, 'cd').getAttribute('aria-selected'), 'false');
  assert.ok(d.querySelector('nav.tabbar [role=tablist], nav.tabbar[role=tablist]'), 'tab 列在底部 nav');
});

test('tab：點擊切換，記住選擇並更新網址', () => {
  const w = open(), d = w.document;
  tab(d, 'cd').click();
  assert.deepStrictEqual(shown(d), ['cd']);
  assert.strictEqual(tab(d, 'cd').getAttribute('aria-selected'), 'true');
  assert.strictEqual(w.location.hash, '#cd');
  assert.strictEqual(w.localStorage.getItem('goddess-tower:tab'), 'cd');
  tab(d, 'seal').click();
  assert.deepStrictEqual(shown(d), ['seal']);
  assert.strictEqual(w.location.hash, '#seal');
});

test('tab：網址 #cd 直接開啟，且優先於上次的選擇', () => {
  assert.deepStrictEqual(shown(load({ hash: '#cd' })), ['cd']);
  assert.deepStrictEqual(shown(load({ hash: '#cd', tab: 'seal' })), ['cd']);
  assert.deepStrictEqual(shown(load({ tab: 'cd' })), ['cd']);
  assert.deepStrictEqual(shown(load({ hash: '#xyz', tab: 'oops' })), ['seal']);
});

test('tab：localStorage 無法使用時照常切換', () => {
  const d = load({ brokenStorage: true });
  tab(d, 'cd').click();
  assert.deepStrictEqual(shown(d), ['cd']);
});

test('tab：切換不影響封印之室進度', () => {
  const d = load();
  click(d, 1);
  const g = guess(d);
  tab(d, 'cd').click(); tab(d, 'seal').click();
  assert.strictEqual(guess(d), g);
  assert.strictEqual(d.querySelectorAll('.history-line').length, 1);
});

// 台灣時間 → Date header（UTC）。例：2026-10-19 是星期一
const header = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h - 8, mi)).toUTCString();
const cd = async when => { const d = load({ serverDate: when }); await settle(); return d; };
const cdText = (d, id) => $(d, id).textContent;

test('CD：每天下午 1 點換日（換日前仍是前一天的顏色）', async () => {
  const cases = [
    // [台灣時間, 今天的顏色, 屬於星期幾, 下一個顏色, 今天/明天]
    [[2026, 10, 19, 12, 59], '紅色', '星期日', '橘色', '今天'],
    [[2026, 10, 19, 13, 0], '橘色', '星期一', '黃色', '明天'],
    [[2026, 10, 20, 0, 30], '橘色', '星期一', '黃色', '今天'],
    [[2026, 10, 20, 13, 1], '黃色', '星期二', '紫色', '明天'],
    [[2026, 10, 21, 18, 0], '紫色', '星期三', '深藍色', '明天'],
    [[2026, 10, 22, 14, 0], '深藍色', '星期四', '淺藍色', '明天'],
    [[2026, 10, 23, 13, 30], '淺藍色', '星期五', '綠色', '明天'],
    [[2026, 10, 24, 23, 59], '綠色', '星期六', '紅色', '明天'],
    [[2026, 10, 25, 13, 0], '紅色', '星期日', '橘色', '明天'],
  ];
  for (const [t, color, day, next, when] of cases) {
    const d = await cd(header(...t));
    const label = t.join('/');
    assert.strictEqual(cdText(d, 'cdName'), color, `${label} 顏色`);
    assert.strictEqual(cdText(d, 'cdDay'), `${day}的唱片`, `${label} 星期`);
    assert.strictEqual(cdText(d, 'cdNext'), `${when}下午 1:00 換成${next}`, `${label} 下一個`);
    assert.strictEqual(cdText(d, 'cdSource'), '伺服器時間');
  }
});

test('CD：倒數時間', async () => {
  assert.strictEqual(cdText(await cd(header(2026, 10, 19, 12, 59)), 'cdLeft'), '還有 0 小時 1 分');
  assert.strictEqual(cdText(await cd(header(2026, 10, 19, 13, 0)), 'cdLeft'), '還有 24 小時 0 分');
  assert.strictEqual(cdText(await cd(header(2026, 10, 19, 20, 30)), 'cdLeft'), '還有 16 小時 30 分');
});

test('CD：每週顏色表從星期一排到星期日，標出今天', async () => {
  const d = await cd(header(2026, 10, 22, 14, 0)); // 星期四
  const rows = [...d.querySelectorAll('#cdWeek .week-row')].map(r => r.textContent);
  assert.deepStrictEqual(rows, ['星期一橘色', '星期二黃色', '星期三紫色', '星期四深藍色（今天）', '星期五淺藍色', '星期六綠色', '星期日紅色']);
  assert.strictEqual(d.querySelectorAll('#cdWeek .today').length, 1);
});

test('CD：伺服器時間拿不到時改用裝置時間', async () => {
  for (const serverDate of [null, 'not a date']) {
    const d = await cd(serverDate);
    assert.strictEqual(cdText(d, 'cdSource'), '裝置時間');
    // 與用裝置時間獨立算出的結果一致
    const now = new Date(Date.now() + 8 * 3600e3 - 13 * 3600e3).getUTCDay();
    assert.strictEqual(cdText(d, 'cdName'), ['紅色', '橘色', '黃色', '紫色', '深藍色', '淺藍色', '綠色'][now]);
  }
  // jsdom 沒有 fetch（等同舊瀏覽器）也要能顯示
  assert.strictEqual(cdText(load(), 'cdSource'), '裝置時間');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
  }
  const max = Math.max(...Object.values(steps));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (Object.keys(steps).length) console.log(`最多 ${max} 次站位通關（含最後站對那次），平均 ${(Object.values(steps).reduce((a, b) => a + b) / 21).toFixed(2)} 次`);
  process.exit(fail ? 1 : 0);
})();
