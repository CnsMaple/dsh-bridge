// 回归测试：DSH 宿主版本探测（桌面版显示错版本 / 误报可升级）
//
// 背景：getDshVersion() 原先只 spawn `dsh --version`。桌面版（Electron 内置 DSH）里
// PATH 上的 `dsh` 往往是**另一套安装**（例如 npm 全局的 0.1.x），于是面板显示
// 「当前 v0.1.7-rc.2」并对 npm 上的 0.2.0-rc.2 报「有新版本可升级」。
// 插件自身的版本来自 package.json（VERSION），但宿主没重启时会读到启动时的旧值——
// 那属于"改了 host 代码必须重启"的既有约束，不在本文件的断言范围内。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMVER_LIKE, readHostReportedVersion, readDesktopRuntimeVersion } from '../lib/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repoRoot, 'lib/index.js'), 'utf8');

test('宿主自报版本优先，且只接受版本号形态', () => {
  assert.equal(readHostReportedVersion({ DSH_CLIENT_VERSION: '0.2.0-rc.2' }), '0.2.0-rc.2');
  assert.equal(readHostReportedVersion({ DSH_APP_VERSION: '1.2.3' }), '1.2.3');
  assert.equal(
    readHostReportedVersion({ DSH_CLIENT_VERSION: '0.2.0-rc.2', DSH_APP_VERSION: '0.1.0' }),
    '0.2.0-rc.2',
    'DSH_CLIENT_VERSION 优先于 DSH_APP_VERSION',
  );
  for (const bad of [{}, { DSH_CLIENT_VERSION: '' }, { DSH_CLIENT_VERSION: '   ' }, { DSH_CLIENT_VERSION: 'unknown' }, { DSH_CLIENT_VERSION: 'v0.2.0' }]) {
    assert.equal(readHostReportedVersion(bad), null, JSON.stringify(bad));
  }
});

test('桌面版安装形态从 runtime.json 读 desktopVersion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-ver-'));
  try {
    const execPath = join(dir, 'DeepSeek Harness.exe');
    const target = join(dir, 'resources', 'runtime', 'primary-runtime', 'runtime.json');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ desktopVersion: '0.2.0-rc.2', node: '24.21.0' }));
    assert.equal(readDesktopRuntimeVersion(execPath), '0.2.0-rc.2');

    writeFileSync(target, JSON.stringify({ desktopVersion: 'nightly' }));
    assert.equal(readDesktopRuntimeVersion(execPath), null, '非版本值应被拒绝');
    writeFileSync(target, 'not json');
    assert.equal(readDesktopRuntimeVersion(execPath), null, 'JSON 损坏不应抛');
    rmSync(target);
    assert.equal(readDesktopRuntimeVersion(execPath), null, '文件缺失返回 null');
    assert.equal(readDesktopRuntimeVersion(join(dir, 'missing', 'node.exe')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SEMVER_LIKE 接受常见版本、拒绝非版本串', () => {
  for (const ok of ['0.2.0', '0.2.0-rc.2', '1.2.3-alpha.1+build.7', '0.1.7-rc.2']) {
    assert.equal(SEMVER_LIKE.test(ok), true, ok);
  }
  for (const bad of ['', 'v0.2.0', '0.2', 'latest', '0.2.0 rc2', 'abc']) {
    assert.equal(SEMVER_LIKE.test(bad), false, bad);
  }
});

test('getDshVersion 的探测顺序：宿主自报 → runtime.json → dsh --version', () => {
  const body = source.slice(source.indexOf('async getDshVersion()'));
  const envAt = body.indexOf('readHostReportedVersion()');
  const runtimeAt = body.indexOf('readDesktopRuntimeVersion()');
  const spawnAt = body.indexOf("spawn('dsh --version'");
  assert.ok(envAt > 0 && runtimeAt > 0 && spawnAt > 0, '三条来源都应存在');
  assert.ok(envAt < runtimeAt && runtimeAt < spawnAt, '顺序必须是 宿主自报 → runtime.json → dsh --version');
});
