// 回归测试（上游 issue #3）：远程页面注入「承载 Host」标记，修复【设置 → 模型】报
// 「加载提供方目录失败: settings are unavailable in this browser」。
//
// 根因（DSH 客户端判定链，0.1.x 与 0.2.0 均已核对）：
//   dsh-client-connection: isLoopback = transport?.ownsHost === true || isLoopbackHostname(hostname)
//   dsh-client-ui-settings(-general): persistence = isLoopback ? "host" : "memory"
// 局域网 IP / 隧道域名不是回环主机名 → 走 memory 域 → 设置面板整页不可用；
// 而接口本身是通的（/api/settings/describe 返回 200），缺的只是这个标记。
//
// 覆盖三层：
//   1. 行为断言：回环 authority 判定、注入顺序（早于 __DSH_BOOT__）、按标记去重、脚本语义
//   2. 结构断言：代理分支确实按「非回环才注入」接线（防止只留工具函数却断开调用）
//   3. 边界断言：已有 __DSH_TRANSPORT__ 时不覆盖（社区同类修法 required 的不变量）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OWNS_HOST_PART,
  applyBridgeHeadInjections,
  isLoopbackAuthority,
} from '../lib/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostSource = readFileSync(resolve(repoRoot, 'lib/index.js'), 'utf8');

/** 取出注入脚本的可执行体，用于在沙箱里验证语义 */
const scriptBody = OWNS_HOST_PART.html.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
const runBootstrap = (transport) => {
  const sandbox = { self: transport === undefined ? {} : { __DSH_TRANSPORT__: transport } };
  // 被测对象就是这段注入脚本本身，用 Function 构造器把它放进给定作用域执行
  new Function('self', scriptBody)(sandbox.self);
  return sandbox.self.__DSH_TRANSPORT__;
};

test('回环 authority 不需要注入（本地页面本来就拥有宿主）', () => {
  for (const host of ['127.0.0.1:3082', '127.0.0.1', 'localhost:3080', 'LOCALHOST', '[::1]:3082', '::1', '']) {
    assert.equal(isLoopbackAuthority(host), true, `${host} 应判为回环`);
  }
  for (const host of ['192.168.1.5:3082', '10.0.0.9', 'xxx.trycloudflare.com', 'dsh.example.com:443', '172.17.0.1:3082']) {
    assert.equal(isLoopbackAuthority(host), false, `${host} 应判为非回环`);
  }
});

test('非回环页面注入 ownsHost 标记，且落在 __DSH_BOOT__ 之前', () => {
  const sample = [
    '<!doctype html><html><head><title>DSH</title>',
    '<script>globalThis["__DSH_BOOT__"] = {"rev":"x"};</script>',
    '</head><body></body></html>',
  ].join('');
  const out = applyBridgeHeadInjections(sample, { ownsHost: true });
  const markAt = out.indexOf(OWNS_HOST_PART.mark);
  const bootAt = out.indexOf('__DSH_BOOT__');
  assert.ok(markAt > 0, '应注入 ownsHost 片段');
  assert.ok(bootAt > 0, '样例应含 boot 脚本');
  assert.ok(markAt < bootAt, '注入必须早于 __DSH_BOOT__（client 模块 boot 时读取该标记）');
  assert.match(out, /ownsHost:true/, '注入脚本应设置 ownsHost');
});

test('回环页面不注入 ownsHost，但兼容垫片照常注入', () => {
  const sample = '<!doctype html><html><head></head><body></body></html>';
  const out = applyBridgeHeadInjections(sample, { ownsHost: false });
  assert.equal(out.includes(OWNS_HOST_PART.mark), false);
  assert.match(out, /data-dsh-bridge-polyfill="1"/, 'polyfill 片段不受影响');
});

test('重复应用按标记去重（两层桥串联时不重复注入）', () => {
  const sample = '<!doctype html><html><head></head><body></body></html>';
  const once = applyBridgeHeadInjections(sample, { ownsHost: true });
  const twice = applyBridgeHeadInjections(once, { ownsHost: true });
  assert.equal(twice, once, '第二次应用应原样返回');
  assert.equal(twice.split(OWNS_HOST_PART.mark).length - 1, 1, '标记只应出现一次');
});

test('注入脚本：设置 ownsHost、保留既有字段、不覆盖已为 true 的对象', () => {
  // 空环境：建对象并置位
  assert.equal(runBootstrap(undefined).ownsHost, true);

  // 已有其它 override：合并而不是整体覆盖
  const merged = runBootstrap({ streamBaseUrl: 'http://127.0.0.1:3080' });
  assert.equal(merged.ownsHost, true);
  assert.equal(merged.streamBaseUrl, 'http://127.0.0.1:3080');

  // 已经是 true：保持同一对象（避免顶掉宿主或其它插件持有的引用）
  const existing = { ownsHost: true, keep: 1 };
  assert.equal(runBootstrap(existing), existing);
  assert.equal(existing.keep, 1);
});

test('代理分支按要求接线：非回环才注入', () => {
  assert.match(
    hostSource,
    /applyBridgeHeadInjections\(out\.toString\('utf8'\), \{\s*\n\s*ownsHost: !isLoopbackAuthority\(req\.headers\.host\),/,
    'proxy 的 HTML 注入分支必须调用 applyBridgeHeadInjections 并传入非回环判定',
  );
});
