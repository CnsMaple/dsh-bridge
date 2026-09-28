// 回归测试（Issue #51）：client 侧宿主接入与控制面暴露
//
// 覆盖：
//   1. 行为断言：ctx.provide('dsh-bridge', bridgeControl) 契约发布
//   2. render(props) element 构造与 preferredTab 透传
//   3. setSettingsVisible 动态可见性门控与注销/重新注册
//   4. 老宿主（无 ctx.provide）平稳向下兼容
//   5. 结构与产物同步断言（client/index.js 与 client/client.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 准备轻量浏览器与 React mock 环境以支持模块导入与组件构造
global.React = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...props, children: children.length === 1 ? children[0] : children },
  }),
  memo: (fn) => fn,
  useState: (val) => [val, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
};
global.window = {
  location: { search: '', hostname: '127.0.0.1' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  innerWidth: 1024,
  __DSH_DESKTOP__: true, // 模拟桌面端宿主（如 Tauri / DSH Desktop）
};
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, dataset: {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {}, classList: { contains: () => false, add: () => {}, remove: () => {} } },
  documentElement: { setAttribute: () => {}, removeAttribute: () => {}, dataset: {} },
  addEventListener: () => {},
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = readFileSync(resolve(repoRoot, 'client/index.js'), 'utf8');
const bundle = readFileSync(resolve(repoRoot, 'client/client.js'), 'utf8');
const unescapedBundle = bundle.replace(
  /\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
  (_, u, x) => String.fromCharCode(parseInt(u ?? x, 16)),
);

const { apply } = await import('../client/index.js');

function createMockCtx() {
  const provided = {};
  const registeredSlots = [];
  const injectedSlots = [];
  let unregisterCount = 0;

  const ctx = {
    connection: {
      rpc: {
        call: (channel, endpoint, payload) => Promise.resolve({ ok: true, endpoint, payload }),
      },
    },
    slots: {
      inject: (name, callback) => {
        injectedSlots.push({ name, callback });
        // 模拟 slot 触发
        callback();
      },
      register: (descriptor, component) => {
        const item = { descriptor, component, active: true };
        registeredSlots.push(item);
        return () => {
          item.active = false;
          unregisterCount++;
        };
      },
    },
    provide: (name, service) => {
      provided[name] = service;
    },
    _getProvided: () => provided,
    _getRegisteredSlots: () => registeredSlots,
    _getUnregisterCount: () => unregisterCount,
  };

  return ctx;
}

// ---------- 1. 行为断言：反射服务契约 ----------

test('apply(ctx) 发布 dsh-bridge 控制面服务', () => {
  const ctx = createMockCtx();
  apply(ctx);

  const service = ctx._getProvided()['dsh-bridge'];
  assert.ok(service, '必须通过 ctx.provide 发布 dsh-bridge 服务');
  assert.equal(service.version, 1, '服务版本必须为 1');
  assert.equal(typeof service.render, 'function', '必须提供 render() 方法');
  assert.equal(typeof service.setSettingsVisible, 'function', '必须提供 setSettingsVisible()');
  assert.equal(typeof service.settingsVisible, 'function', '必须提供 settingsVisible()');
  assert.equal(typeof service.configureFeatures, 'function', '必须提供 configureFeatures()');
  assert.equal(typeof service.getFeatures, 'function', '必须提供 getFeatures()');
});

// ---------- 2. 行为断言：render(props) 现构造与 preferredTab 透传 ----------

test('render() 现构造 React element 并正确透传 props 和 preferredTab', () => {
  const ctx = createMockCtx();
  apply(ctx);
  const service = ctx._getProvided()['dsh-bridge'];

  const element1 = service.render({ preferredTab: 'tunnel', customHeader: 'hello' });
  assert.ok(element1, 'render 必须返回 React element');
  assert.equal(typeof element1.type, 'function', 'element type 必须是 BridgePanel 组件');
  assert.equal(element1.props.preferredTab, 'tunnel', '必须透传 preferredTab');
  assert.equal(element1.props.customHeader, 'hello', '必须透传外部自定义 props');
  assert.equal(typeof element1.props.rpcCall, 'function', '必须自动注入内部构造的 rpcCall');

  const element2 = service.render({ preferredTab: 'bot' });
  assert.equal(element2.props.preferredTab, 'bot');
  assert.notEqual(element1, element2, '每次调用必须现构造 element，不可缓存');
});

// ---------- 3. 行为断言：设置页可见性门控 ----------

test('setSettingsVisible(false) 撤下设置页条目，setSettingsVisible(true) 重新注册', () => {
  const ctx = createMockCtx();
  apply(ctx);
  const service = ctx._getProvided()['dsh-bridge'];

  assert.equal(service.settingsVisible(), true, '默认设置页条目可见');
  const initialSlots = ctx._getRegisteredSlots().filter((s) => s.descriptor.name === 'settings.section');
  assert.equal(initialSlots.length, 1, '初始应注册设置页 slot');
  assert.equal(initialSlots[0].active, true);

  // 宿主调用撤下
  service.setSettingsVisible(false);
  assert.equal(service.settingsVisible(), false);
  assert.equal(initialSlots[0].active, false, '应触发注销函数释放 slot');
  assert.equal(ctx._getUnregisterCount(), 1);

  // 宿主恢复显示
  service.setSettingsVisible(true);
  assert.equal(service.settingsVisible(), true);
  const updatedSlots = ctx._getRegisteredSlots().filter((s) => s.descriptor.name === 'settings.section');
  assert.equal(updatedSlots.length, 2, '恢复显示后应重新注册');
  assert.equal(updatedSlots[1].active, true);
});

// ---------- 4. 行为断言：老宿主兼容性 ----------

test('老宿主没有 ctx.provide 时：平稳降级不抛错', () => {
  const ctx = createMockCtx();
  delete ctx.provide; // 模拟旧版 Cordis

  assert.doesNotThrow(() => {
    apply(ctx);
  }, '没有 ctx.provide 绝不能抛出异常');
});

// ---------- 5. 结构与产物断言 ----------

test('client/index.js 源码包含控制面发布与 BridgePanel preferredTab 支持', () => {
  assert.match(indexSource, /ctx\.provide\(\s*['"]dsh-bridge['"]/);
  assert.match(indexSource, /function\s+BridgePanel\s*\(\s*\{[^}]*preferredTab/);
  assert.match(indexSource, /setSettingsVisible/);
  assert.match(indexSource, /settingsVisible/);
});

test('client/client.js 打包产物必须同步包含宿主控制面', () => {
  assert.match(unescapedBundle, /dsh-bridge/);
  assert.match(unescapedBundle, /preferredTab/);
  assert.match(unescapedBundle, /setSettingsVisible/);
});
