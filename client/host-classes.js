// 宿主 DOM 类名跨版本兼容层（DSH 0.1.x / 0.2.x）
//
// 背景：DSH 客户端包用 CSS module 生成 `<构建哈希>_<局部类名>` 形式的类名，
// **局部类名稳定、哈希前缀随宿主版本变化**：
//   DSH 0.1.x：wSkVaW_scrollBody / hHd-Xa_root / VOzbGW_panel / _7KE1Ra_trigger
//   DSH 0.2.x：Dc7zOa_scrollBody / _2H3hWW_root / wCInkW_panel / wq12jW_trigger
//
// 因此桥的源码只按「局部类名」描述选择器（保留历史前缀是为了可检索），由本模块在
// 运行时展开成**多前缀并集**，同一份代码在新旧宿主上都能命中；新增宿主版本时，
// 只需往对应分组补一个前缀，不必逐个改规则。
//
// 展开一律包在 `:is(...)` 里，而不是简单拼接选择器列表：规则里的类名往往出现在
// 复合/后代选择器中间（`body.x div[class*="A_y"] div[class*="B_z"]`），直接拼列表会让
// 后续分支丢掉祖先约束。`:is()` 保持整条选择器的结构，特异性也不变（取参数中最高的，
// 与本展开的 [class*=…] / tag 同源）。构建目标 chrome100 支持该语法。
//
// 分组内的前缀按宿主版本从旧到新排列；前缀取自已安装宿主包的真实类名清单
// （0.1.7 与 0.2.0 的 DOM 与 CSS module 命名均已核对）。

/** 逻辑分组 → 各版本前缀（选择器取并集） */
export const HOST_CLASS_GROUPS = {
  /** 设置弹窗（@deepseek-ai/dsh-client-ui-settings-general） */
  settings: ['VOzbGW', 'wCInkW'],
  /** 会话区外壳与头部（dsh-client-ui-conversation） */
  conversation: ['wSkVaW', 'Dc7zOa'],
  /** 输入区（composer）与底部工具栏 */
  composer: ['uV2eYG', 'RlGAzG'],
  /** 侧边栏内部（dsh-client-ui-sidebar） */
  sidebar: ['hHd-Xa', '_2H3hWW'],
  /** 侧边栏的工作区/会话列表（dsh-client-ui-workspace） */
  sidebarList: ['qDHVXG', 'bhn1Oq', '_9lTDKa'],
  /** 模型选择器（dsh-client-ui-model-selection） */
  model: ['_7KE1Ra', 'wq12jW'],
  /** 权限预设选择器（dsh-client-ui-permission-presets） */
  permission: ['Sh0Q9G', 'iWlSmW', 'dlU_AG'],
  /** 工作区面板 / Tab 栏（第三方面板插件与历史版本，两套前缀都保留） */
  panels: ['nArs4W', 'workbench'],
  /** Session 导出按钮（0.2 起该按钮无独立局部类名，样式改按 headerUtilities 容器匹配） */
  sessionLog: ['nL4_yW'],
  /** 子代理胶囊与展开菜单（历史版本） */
  subagent: ['h8S2Va'],
  /** 头部展开/收起按钮组（历史版本；0.2 起按 toggleCluster / _detailsCol 泛匹配） */
  toggleCluster: ['W-zNGW'],
};

/** 前缀 → 分组，供展开器反查；同一前缀重复登记属于配置错误 */
export const HOST_PREFIX_TO_GROUP = new Map();
for (const [group, prefixes] of Object.entries(HOST_CLASS_GROUPS)) {
  for (const prefix of prefixes) {
    if (HOST_PREFIX_TO_GROUP.has(prefix)) {
      throw new Error(`dsh-bridge: host class prefix ${prefix} listed in two groups`);
    }
    HOST_PREFIX_TO_GROUP.set(prefix, group);
  }
}

/** 选择器文本里 `<可选元素类型>[class*="<前缀>_<局部>"]` 的匹配式 */
const HOST_CLASS_SELECTOR = /([a-zA-Z]*)\[class\*="([A-Za-z0-9_-]+)_([A-Za-z0-9]+)"\]/g;

/**
 * 生成「任意已知前缀 + 指定局部类名」的选择器（各版本并集，`:is()` 形式）。
 *
 * @param {string} local 局部类名（如 `scrollBody`）
 * @param {keyof typeof HOST_CLASS_GROUPS} group 逻辑分组
 * @param {string} [tag] 可选的元素类型前缀（如 `div`），会逐项拼接
 * @returns {string} 单前缀分组返回 `div[class*="wSkVaW_x"]`，多前缀返回 `:is(div[class*="a_x"],div[class*="b_x"])`
 */
export function hostSel(local, group, tag = '') {
  const prefixes = HOST_CLASS_GROUPS[group];
  if (!prefixes) throw new Error(`dsh-bridge: unknown host class group "${group}"`);
  const list = prefixes.map((prefix) => `${tag}[class*="${prefix}_${local}"]`);
  return list.length === 1 ? list[0] : `:is(${list.join(',')})`;
}

/**
 * 把 CSS / 选择器文本里的宿主类名选择器展开成多版本并集（`:is()` 包裹）。
 *
 * 未登记前缀（第三方插件、桥自有的 `.dsh-*`）与只登记了单一前缀的分组原样保留。
 *
 * @param {string} text CSS 文本或单条选择器
 * @returns {string} 展开后的文本
 */
export function expandHostClassSelectors(text) {
  return String(text ?? '').replace(HOST_CLASS_SELECTOR, (whole, tag, prefix, local) => {
    const group = HOST_PREFIX_TO_GROUP.get(prefix);
    if (!group) return whole;
    const prefixes = HOST_CLASS_GROUPS[group];
    if (prefixes.length < 2) return whole;
    return `:is(${prefixes.map((entry) => `${tag}[class*="${entry}_${local}"]`).join(',')})`;
  });
}
