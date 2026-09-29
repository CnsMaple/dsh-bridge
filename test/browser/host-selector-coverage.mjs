// 移动端宿主类名覆盖验收（跨 DSH 版本：0.1.x / 0.2.x）
//
// 用法：DSH_WEB_PORT=<端口> node test/browser/host-selector-coverage.mjs
//   - dsh web（0.1.x）：DSH_WEB_PORT=3080（默认）
//   - 桌面版 Electron 的 Web 端点（0.2.x）：DSH_WEB_PORT=19387
//
// 为什么独立成一套：其余套件驱动的是**已安装的插件**，因此只能验证"当前装的那版"；
// 本套件把仓库里的样式表直接注入页面，验证的是**即将发布的这份代码**，从而能在
// 桌面版（0.2.0-rc.2）上提前验收，而不必先重装插件。
//
// 断言分三类：
//   1. 样式表可解析：注入后 styleSheets 里能看到本样式表，且没有整条规则被丢弃
//   2. 锚点覆盖：host-classes.js 里登记的每条关键锚点，在**当前宿主的真实 DOM**上必须命中
//      （0.2 适配前，带旧前缀的选择器在 0.2 宿主上全部命中 0 —— 这正是"样式不生效"的根因）
//   3. 骨架生效：移动端框架重排（padding-top / 列宽让步）在两种宿主上都落地
import puppeteer from 'puppeteer-core';
import { connect, launchOptions, openGui, shotsDir } from './helpers.mjs';
import { HOST_CLASS_GROUPS, hostSel } from '../../client/host-classes.js';
import { MOBILE_STYLES_CSS } from '../../client/mobile-styles.js';

const SHOTS = shotsDir('host-selector-coverage');
const CHROME = launchOptions().executablePath;
const { port: PORT, cookie: c, cookieName: cn } = connect();

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const viewport = { width: 390, height: 844 };
await openGui(page, { port: PORT, cookie: c, cookieName: cn, cookieValue: c.slice(cn.length + 1) }, viewport);
await page.waitForSelector('[data-slot="root"]', { timeout: 20000 });
// 输入区（含模型/权限选择器）是惰性挂载的：等它就位再断言，避免把"还没渲染"误判成"选择器失效"
await page
  .waitForSelector('[data-slot="conversation.input.model"] button', { timeout: 15000 })
  .catch(() => console.log('提示：未等到模型选择器挂载，相关锚点可能因页面状态而非选择器失败'));

// 注入仓库里的样式表（页面可能同时挂着已安装插件的旧样式表，后注入的优先）
const styleHandle = await page.addStyleTag({ content: MOBILE_STYLES_CSS });

/** 统计当前 DOM 上命中「某分组 + 局部类名」的元素数（用的是仓库里的 :is() 展开） */
const countHits = (group, local, tag = '') =>
  page.evaluate((selector) => document.querySelectorAll(selector).length, hostSel(local, group, tag));

/** 当前宿主实际使用的前缀（用于打印宿主的代际，便于定位问题） */
const detected = await page.evaluate(() => {
  const probes = {
    conversation: ['wSkVaW_scrollBody', 'Dc7zOa_scrollBody'],
    composer: ['uV2eYG_card', 'RlGAzG_card'],
    sidebar: ['hHd-Xa_root', '_2H3hWW_root'],
  };
  const out = {};
  for (const [group, list] of Object.entries(probes)) {
    out[group] = list.find((cls) => document.querySelector(`[class*="${cls}"]`)) || null;
  }
  return out;
});
console.log(`宿主类名前缀探测：${JSON.stringify(detected)}`);

// ---- 1. 样式表可解析 ----
const sheetInfo = await page.evaluate((marker) => {
  const sheet = [...document.styleSheets].find((s) => s.ownerNode === marker);
  if (!sheet) return { found: false };
  // 顶层多为 @media 块，必须递归统计，否则会把"整表只看到几个媒体块"误判成样式丢失
  const countRules = (ruleList) => {
    let total = 0;
    for (const rule of ruleList) {
      total += 1;
      if (rule.cssRules) total += countRules(rule.cssRules);
    }
    return total;
  };
  try { return { found: true, rules: countRules(sheet.cssRules) }; } catch { return { found: true, rules: -1 }; }
}, styleHandle);
record(
  '仓库样式表注入且可解析',
  sheetInfo.found && sheetInfo.rules > 100,
  `rules=${sheetInfo.rules}`,
);

// ---- 2. 锚点覆盖（空会话页面就能看到的那些） ----
const baseAnchors = [
  ['conversation', 'scrollBody'], ['conversation', 'titleRow'], ['conversation', 'composerSeat'],
  ['composer', 'card'], ['composer', 'row'], ['composer', 'tools'], ['composer', 'modes'],
  ['composer', 'trailing'],
  ['model', 'trigger'], ['model', 'triggerLabel'],
  ['permission', 'trigger'],
  ['sidebar', 'root'], ['sidebar', 'toggle'], ['sidebar', 'newSession'], ['sidebar', 'regionArea'],
  ['sidebarList', 'root'],
];
for (const [group, local] of baseAnchors) {
  const hits = await countHits(group, local);
  record(
    `锚点命中 ${group}.${local}`,
    hits > 0,
    `命中 ${hits} 个元素（前缀：${HOST_CLASS_GROUPS[group].join(' / ')}）`,
  );
}

// ---- 3. 打开设置弹窗后的锚点覆盖 ----
// 用真实鼠标点击（React 的 onPointerDown/onClick 对合成 .click() 不总是响应），
// 并在候选入口间轮换重试：设置弹窗挂载后立即退出重试循环。
const settingsCandidates = [
  '[data-slot="settings.trigger"] button',
  '[data-slot="settings.trigger"]',
  '[data-slot="sidebar.settings"] button',
  'button[aria-label*="设置"]',
  'button[aria-label*="Settings"]',
];
let settingsOpened = null;
for (const sel of settingsCandidates) {
  // 手机视口下侧边栏被抽屉盖住，真实鼠标点击（page.click）会因不可见而抛错，
  // 因此退回合成 click()——宿主按钮对两者都会响应（插件自身也是这么点的）。
  const clicked = await page
    .click(sel)
    .then(() => true)
    .catch(() =>
      page
        .evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return false;
          (el.matches('button') ? el : el.querySelector('button') || el).click();
          return true;
        }, sel)
        .catch(() => false),
    );
  if (!clicked) continue;
  settingsOpened = sel;
  const ok = await page
    .waitForSelector(hostSel('overlay', 'settings'), { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 800));
const settingsAnchors = [
  ['settings', 'overlay'], ['settings', 'panel'], ['settings', 'nav'], ['settings', 'navCell'],
  ['settings', 'navList'], ['settings', 'navTitle'], ['settings', 'navLabel'], ['settings', 'options'],
  ['settings', 'content'], ['settings', 'close'], ['settings', 'header'],
];
for (const [group, local] of settingsAnchors) {
  const hits = await countHits(group, local);
  record(`设置弹窗锚点命中 ${group}.${local}`, hits > 0, `命中 ${hits} 个元素（触发：${settingsOpened || '未找到入口'}`);
}
await page.screenshot({ path: `${SHOTS}/settings-${PORT}.png` });

// ---- 4. 几何生效：≤480px 的「两级钻取」必须真的落地 ----
// 只断言"选择器命中"不够——规则命中但被更高优先级覆盖时，界面依旧是坏的。
// 390px 宽下宿主默认是「88px 图标轨道 + 内容列」，桥把它改成整宽分类列表：
// 列表页隐藏内容区、导航占满面板宽度，通过这条断言才能证明样式确实生效。
const geometry = await page.evaluate(
  (navSel, optionsSel) => {
    const nav = document.querySelector(navSel);
    const options = document.querySelector(optionsSel);
    const px = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);
    return {
      gate: document.documentElement.getAttribute('data-dshbr-drilldown'),
      navWidth: px(nav),
      optionsDisplay: options ? getComputedStyle(options).display : null,
    };
  },
  hostSel('nav', 'settings'),
  hostSel('options', 'settings'),
);
record(
  '≤480px 两级钻取生效（列表页整宽 + 内容区收起）',
  geometry.gate === 'ready' && (geometry.navWidth ?? 0) >= 250 && geometry.optionsDisplay === 'none',
  JSON.stringify(geometry),
);

// ---- 4. 骨架生效：框架为顶栏让位 ----
const frame = await page.evaluate(() => {
  const el = document.querySelector('[data-slot="root"] > div[class*="_frame"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { paddingTop: cs.paddingTop, height: Math.round(el.getBoundingClientRect().height), viewportH: window.innerHeight };
});
record(
  '移动端框架为顶栏让位（padding-top: 52px）',
  Boolean(frame) && frame.paddingTop === '52px',
  frame ? JSON.stringify(frame) : '未找到 [data-slot="root"] > *[_frame]',
);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n———— 覆盖验收：${results.length - failed.length}/${results.length} 通过（端口 ${PORT}）————`);
if (failed.length) {
  console.log('失败项：');
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exit(1);
}
