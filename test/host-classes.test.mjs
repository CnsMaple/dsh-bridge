// 回归测试：宿主 DOM 类名的跨版本兼容层（DSH 0.1.x / 0.2.x）
//
// 背景：DSH 客户端包的 CSS module 类名形如 `<构建哈希>_<局部类名>`，局部类名稳定、
// 哈希前缀随版本变化（0.1.x 的 wSkVaW_scrollBody 在 0.2.x 是 Dc7zOa_scrollBody）。
// 桥曾把前缀硬编码进选择器，导致桌面版（DSH 0.2.0-rc.2）上移动端样式大面积静默失效。
//
// 本文件覆盖两层：
//   1. 行为断言：分组表、hostSel 的 :is() 并集、展开器对复合选择器结构的保持
//   2. 覆盖断言：移动端样式表里每条关键锚点都必须同时含新旧两代前缀
//   3. 产物同步断言：client/client.js 必须包含展开器与 0.2.x 前缀表
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_CLASS_GROUPS,
  HOST_PREFIX_TO_GROUP,
  hostSel,
  expandHostClassSelectors,
} from '../client/host-classes.js';
import { MOBILE_STYLES_CSS, MOBILE_STYLES_TEMPLATE } from '../client/mobile-styles.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = readFileSync(resolve(repoRoot, 'client/client.js'), 'utf8');
const unescapedBundle = bundle.replace(
  /\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
  (_, u, x) => String.fromCharCode(parseInt(u ?? x, 16)),
);

test('分组表登记了两代宿主前缀，且每个前缀只归属一个分组', () => {
  const pairs = [
    ['settings', 'VOzbGW', 'wCInkW'],
    ['conversation', 'wSkVaW', 'Dc7zOa'],
    ['composer', 'uV2eYG', 'RlGAzG'],
    ['sidebar', 'hHd-Xa', '_2H3hWW'],
    ['model', '_7KE1Ra', 'wq12jW'],
    ['permission', 'iWlSmW', 'dlU_AG'],
    ['sidebarList', 'bhn1Oq', '_9lTDKa'],
  ];
  for (const [group, oldPrefix, newPrefix] of pairs) {
    const prefixes = HOST_CLASS_GROUPS[group];
    assert.ok(Array.isArray(prefixes) && prefixes.length >= 2, `分组 ${group} 至少要有两代前缀`);
    assert.ok(prefixes.includes(oldPrefix), `分组 ${group} 缺少 0.1.x 前缀 ${oldPrefix}`);
    assert.ok(prefixes.includes(newPrefix), `分组 ${group} 缺少 0.2.x 前缀 ${newPrefix}`);
  }
  // 反查表：每个前缀恰好属于一个分组（重复登记会在模块加载时抛错）
  assert.equal(HOST_PREFIX_TO_GROUP.get('wCInkW'), 'settings');
  assert.equal(HOST_PREFIX_TO_GROUP.get('Dc7zOa'), 'conversation');
  for (const [group, prefixes] of Object.entries(HOST_CLASS_GROUPS)) {
    for (const prefix of prefixes) assert.equal(HOST_PREFIX_TO_GROUP.get(prefix), group);
  }
});

test('hostSel 生成 :is() 并集；单前缀分组不加包装', () => {
  assert.equal(
    hostSel('panel', 'settings', 'div'),
    ':is(div[class*="VOzbGW_panel"],div[class*="wCInkW_panel"])',
  );
  assert.equal(
    hostSel('scrollBody', 'conversation', 'div'),
    ':is(div[class*="wSkVaW_scrollBody"],div[class*="Dc7zOa_scrollBody"])',
  );
  assert.equal(hostSel('trigger', 'sessionLog', 'button'), 'button[class*="nL4_yW_trigger"]');
});

test('展开器保留复合选择器结构（祖先约束不被拆散）', () => {
  assert.equal(
    expandHostClassSelectors('body.dsh-drawer-open div[class*="hHd-Xa_root"]'),
    'body.dsh-drawer-open :is(div[class*="hHd-Xa_root"],div[class*="_2H3hWW_root"])',
  );
  assert.equal(
    expandHostClassSelectors('div[class*="hHd-Xa_collapsed"] button[class*="hHd-Xa_toggle"]'),
    ':is(div[class*="hHd-Xa_collapsed"],div[class*="_2H3hWW_collapsed"]) :is(button[class*="hHd-Xa_toggle"],button[class*="_2H3hWW_toggle"])',
  );
  assert.equal(
    expandHostClassSelectors('div[class*="nArs4W_panel"]:not([class*="panelHidden"])'),
    ':is(div[class*="nArs4W_panel"],div[class*="workbench_panel"]):not([class*="panelHidden"])',
  );
});

test('未登记前缀与单前缀分组保持原样', () => {
  for (const untouched of [
    '[class*="whatever_thing"]',
    '.dsh-mobile-app-header',
    'button[class*="nL4_yW_sessionLogButton"]',
    'div[class*="h8S2Va_menu"]',
  ]) {
    assert.equal(expandHostClassSelectors(untouched), untouched);
  }
});

test('移动端样式关键锚点在新旧两代宿主上都能命中', () => {
  const required = [
    ['settings', 'panel'], ['settings', 'nav'], ['settings', 'navCell'], ['settings', 'navList'],
    ['settings', 'navTitle'], ['settings', 'navLabel'], ['settings', 'options'], ['settings', 'content'],
    ['settings', 'close'], ['settings', 'overlay'],
    ['conversation', 'titleRow'], ['conversation', 'scrollBody'], ['conversation', 'composerSeat'],
    ['conversation', 'headerUtilities'],
    ['composer', 'card'], ['composer', 'row'], ['composer', 'tools'], ['composer', 'modes'],
    ['composer', 'trailing'],
    ['sidebar', 'root'], ['sidebar', 'collapsed'], ['sidebar', 'toggle'], ['sidebar', 'logoRow'],
    ['sidebar', 'newSession'], ['sidebar', 'regionArea'],
    ['model', 'trigger'], ['model', 'triggerLabel'],
    ['permission', 'trigger'],
    ['sidebarList', 'root'],
  ];
  for (const [group, local] of required) {
    for (const prefix of HOST_CLASS_GROUPS[group]) {
      const needle = `[class*="${prefix}_${local}"]`;
      assert.ok(
        MOBILE_STYLES_CSS.includes(needle),
        `移动端样式缺少 ${needle}（分组 ${group}）：面板/输入区/抽屉在该宿主版本上会静默失效`,
      );
    }
  }
  // 模板保持历史前缀写法（便于检索与结构断言），展开只发生在导出时
  assert.ok(MOBILE_STYLES_TEMPLATE.includes('[class*="VOzbGW_panel"]'));
  assert.ok(!MOBILE_STYLES_TEMPLATE.includes('wCInkW_'));
  assert.ok(MOBILE_STYLES_CSS.includes('[class*="wCInkW_panel"]'));
});

test('产物与源码同步（展开器与 0.2.x 前缀表已打包）', () => {
  assert.ok(
    unescapedBundle.includes(MOBILE_STYLES_TEMPLATE),
    '产物内嵌的移动端 CSS 与源码不一致，请运行 npm run build:client',
  );
  for (const marker of ['wCInkW', '_2H3hWW', '_9lTDKa', 'dlU_AG', 'wq12jW', 'expandHostClassSelectors']) {
    assert.ok(
      unescapedBundle.includes(marker),
      `产物缺少跨版本兼容层标记 ${marker}，请运行 npm run build:client`,
    );
  }
});
