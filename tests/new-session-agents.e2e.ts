import { test, expect } from './fixtures/desktop'

test('CLI availability follows the selected machine and ignores late results from another machine', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const original = server.machines[0]
  if (!original) throw new Error('Fixture machine missing')
  server.machines.push({ ...original, id: 'runner-b', metadata: { ...original.metadata, host: 'runner-b' } })
  server.agentConfig.availability.set('linux-1', [
    { agent: 'codex', available: true },
    { agent: 'claude', available: false, reason: 'not_found' },
    { agent: 'grok', available: false, reason: 'invalid_configuration' },
    { agent: 'gemini', available: true },
  ])
  server.agentConfig.availability.set('runner-b', [{ agent: 'pi', available: true }])
  const gate = Promise.withResolvers<void>()
  server.agentConfig.availabilityGates.set('linux-1', gate.promise)
  try {
    await page.reload()
    await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
    const agents = dialog.getByLabel('Agent', { exact: true })
    await expect(dialog).toContainText('正在检测已安装的 CLI')
    await expect(dialog.getByRole('button', { name: '创建会话', exact: true })).toBeDisabled()
    await dialog.locator('select').first().selectOption('runner-b')
    await expect(agents).toHaveValue('pi')
    await expect(agents.locator('option')).toHaveText(['Pi'])
    gate.resolve()
    await dialog.locator('select').first().selectOption('linux-1')
    await expect(agents).toHaveValue('codex')
    await expect(agents.locator('option')).toHaveText(['Codex'])
    await expect(dialog.getByRole('button', { name: '创建会话', exact: true })).toBeEnabled()
    expect(server.requests.filter((request) => request.path.endsWith('/spawn'))).toEqual([])
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
  }
})

test('failed detection, older runners and empty CLI lists prevent creation and offer retry', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  server.agentConfig.availabilityError = 'upgrade'
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
  const create = dialog.getByRole('button', { name: '创建会话', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('请升级此机器上的 runner')
  await expect(create).toBeDisabled()
  server.agentConfig.availabilityError = 'failed'
  await dialog.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('无法检测已安装的 CLI')
  await expect(create).toBeDisabled()
  server.agentConfig.availabilityError = null
  server.agentConfig.availability.set('linux-1', [])
  await dialog.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(dialog).toContainText('此机器上没有检测到可用的 CLI')
  await expect(create).toBeDisabled()
  server.agentConfig.availability.set('linux-1', [{ agent: 'copilot', available: true }])
  await dialog.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('copilot')
  await expect(create).toBeEnabled()
  expect(errors).toEqual([])
})

const launches = [
  { agent: 'agy', model: 'claude-sonnet-4-6', effort: 'high', permission: 'always-proceed' },
  { agent: 'cursor', model: 'claude-sonnet-4-6[effort=high]', permission: 'debug' },
  { agent: 'grok', model: 'grok-fixture', effort: 'ultra', permission: 'plan' },
  { agent: 'copilot', model: 'copilot-fixture', permission: 'read-only', copilotMode: 'autopilot' },
  { agent: 'kimi', model: 'office-kimi', permission: 'yolo' },
  { agent: 'dsh', model: '["office","deepseek-v4"]' },
  { agent: 'pi', model: 'office/shared-model', effort: 'max' },
]

for (const launch of launches) {
  test(`${launch.agent} uses server model, permission and effort contracts at creation and during a session`, async ({
    desktop,
  }) => {
    const { page, server, errors } = desktop
    await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
    const agents = dialog.getByLabel('Agent', { exact: true })
    await expect(agents.locator('option')).toHaveCount(11)
    await agents.selectOption(launch.agent)
    await dialog.getByLabel('目录', { exact: true }).fill('/home/dev/project')
    await dialog
      .getByRole('group', { name: '模型', exact: true })
      .getByRole('combobox')
      .selectOption(launch.model)
    if (launch.effort)
      await dialog
        .getByRole('group', { name: '思考强度', exact: true })
        .getByRole('combobox')
        .selectOption(launch.effort)
    if (launch.permission)
      await dialog
        .getByRole('group', { name: '权限模式', exact: true })
        .getByRole('combobox')
        .selectOption(launch.permission)
    else await expect(dialog.getByTestId('permission-managed')).toContainText('权限由此 CLI 管理')
    if (launch.copilotMode)
      await dialog
        .getByRole('group', { name: 'Copilot 运行模式', exact: true })
        .getByRole('combobox')
        .selectOption(launch.copilotMode)
    if (launch.agent === 'grok')
      await expect(
        dialog.getByRole('group', { name: '权限模式', exact: true }).locator('option[value="auto"]'),
      ).toBeDisabled()
    await dialog.getByRole('button', { name: '创建会话', exact: true }).click()
    const chat = page.getByTestId('chat-created')
    await expect(chat).toBeVisible()
    const expected: Record<string, unknown> = {
      directory: '/home/dev/project',
      agent: launch.agent,
      model: launch.model,
      sessionType: 'simple',
      startingMode: 'remote',
    }
    if (launch.permission) expected.permissionMode = launch.permission
    if (launch.effort) expected.effort = launch.effort
    if (launch.copilotMode) expected.copilotAgentMode = launch.copilotMode
    expect(server.requests.find((request) => request.path.endsWith('/spawn'))?.body).toEqual(expected)
    if (launch.effort)
      await expect(chat.locator('.session-mode-summary')).toContainText(`思考强度: ${launch.effort}`)
    else await expect(chat.locator('.session-mode-summary')).not.toContainText('思考强度')
    if (launch.agent === 'pi' || launch.agent === 'dsh')
      await expect(chat.locator('.session-mode-summary')).not.toContainText('权限模式')
    if (['kimi', 'copilot', 'grok'].includes(launch.agent)) {
      expect(
        server.agentConfig.modelRequests.some(
          (request) => request.endpoint === `${launch.agent}-models` && request.cwd === '/home/dev/project',
        ),
      ).toBe(true)
    }

    await chat.getByRole('button', { name: '会话设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '会话设置', exact: true })
    const model = settings.getByRole('combobox', { name: '模型', exact: true })
    await expect(model).toHaveValue(launch.model)
    await expect(model).toBeEnabled()
    switch (launch.agent) {
      case 'agy':
        await settings.getByRole('combobox', { name: '思考强度', exact: true }).selectOption('low')
        await expect(settings.getByRole('combobox', { name: '思考强度', exact: true })).toHaveValue('low')
        await model.selectOption('gemini-3.1-pro-low')
        await expect(model).toHaveValue('gemini-3.1-pro-low')
        expect(server.requests.filter((request) => request.path.endsWith('/model')).at(-1)?.body).toEqual({
          model: 'gemini-3.1-pro-low',
          effort: null,
        })
        break
      case 'cursor':
        await model.selectOption('composer-2.5[fast=false]')
        await expect(model).toHaveValue('composer-2.5[fast=false]')
        expect(server.requests.filter((request) => request.path.endsWith('/model')).at(-1)?.body).toEqual({
          model: 'composer-2.5[fast=false]',
        })
        await expect(settings.getByRole('combobox', { name: '思考强度', exact: true })).toHaveCount(0)
        break
      case 'grok': {
        const effort = settings.getByRole('combobox', { name: '思考强度', exact: true })
        await effort.selectOption('low')
        await expect(effort).toHaveValue('low')
        expect(server.requests.filter((request) => request.path.endsWith('/effort')).at(-1)?.body).toEqual({
          effort: 'low',
        })
        const permission = settings.getByRole('combobox', { name: '权限模式', exact: true })
        server.failSetting = true
        await permission.selectOption('bypassPermissions')
        await expect(settings.getByRole('alert')).toBeVisible()
        await expect(permission).toHaveValue('plan')
        break
      }
      case 'copilot': {
        const mode = settings.getByRole('combobox', { name: 'Copilot 运行模式', exact: true })
        await mode.selectOption('plan')
        await expect(mode).toHaveValue('plan')
        expect(
          server.requests.filter((request) => request.path.endsWith('/copilot-agent-mode')).at(-1)?.body,
        ).toEqual({ mode: 'plan' })
        break
      }
      case 'kimi': {
        const permission = settings.getByRole('combobox', { name: '权限模式', exact: true })
        await permission.selectOption('read-only')
        await expect(permission).toHaveValue('read-only')
        server.agentConfig.failModels.add('kimi-models')
        await settings.locator('footer').getByRole('button', { name: '关闭', exact: true }).click()
        await page.reload()
        await chat.getByRole('button', { name: '会话设置', exact: true }).click()
        await expect(model).toBeDisabled()
        await expect(settings.getByRole('alert')).toBeVisible()
        server.agentConfig.failModels.clear()
        await settings.getByRole('button', { name: '刷新', exact: true }).click()
        await expect(model).toBeEnabled()
        break
      }
      case 'dsh':
        await model.selectOption('["deepseek","deepseek-v4"]')
        await expect(model).toHaveValue('["deepseek","deepseek-v4"]')
        expect(server.requests.filter((request) => request.path.endsWith('/model')).at(-1)?.body).toEqual({
          model: '["deepseek","deepseek-v4"]',
        })
        await expect(settings.getByTestId('permission-managed')).toBeVisible()
        await model.selectOption('')
        await expect(model).toHaveValue('')
        expect(server.requests.filter((request) => request.path.endsWith('/model')).at(-1)?.body).toEqual({
          model: null,
        })
        break
      case 'pi':
        await model.selectOption('home/shared-model')
        await expect(model).toHaveValue('home/shared-model')
        expect(server.requests.filter((request) => request.path.endsWith('/model')).at(-1)?.body).toEqual({
          model: { provider: 'home', modelId: 'shared-model' },
        })
        await expect(settings.getByRole('combobox', { name: '思考强度', exact: true })).toHaveCount(0)
        await expect(settings.getByTestId('permission-managed')).toBeVisible()
        break
    }
    expect(errors).toEqual([])
  })
}

test('CLI creation controls remain reachable in a small window, large text and split view', async ({
  desktop,
}) => {
  const { page, electron, errors } = desktop
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() =>
    window.desktop.updateSettings({ fontSize: 'extra-large', locale: 'fr', theme: 'light' }),
  )
  await page.locator('.sidebar').getByRole('button', { name: 'Nouvelle session', exact: true }).click()
  const dialog = page.locator('.new-session-dialog')
  await dialog.locator('.launch-agent select').selectOption('grok')
  await dialog.locator('.launch-directory input').fill('/home/dev/project')
  await expect(dialog).toContainText('Cette CLI Grok')
  const create = dialog.locator('button[type="submit"]')
  await expect(create).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const modelGroup = dialog.getByRole('group', { name: 'Modèle', exact: true })
  await modelGroup.scrollIntoViewIfNeeded()
  await expect(modelGroup.getByRole('combobox')).toBeInViewport({ ratio: 1 })
  await modelGroup.getByRole('combobox').selectOption('grok-fixture')
  const permissionGroup = dialog.locator('fieldset').filter({ hasText: 'Cette CLI Grok' })
  await permissionGroup.scrollIntoViewIfNeeded()
  await expect(permissionGroup.getByRole('combobox')).toBeInViewport({ ratio: 1 })
  await expect(create).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: 'build/cli-alignment-light.png', animations: 'disabled' })
  await page.evaluate(() => window.desktop.updateSettings({ theme: 'dark' }))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'build/cli-alignment-dark.png', animations: 'disabled' })
  await page.evaluate(() =>
    window.desktop.updateSettings({ fontSize: 'normal', locale: 'zh', theme: 'light' }),
  )
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  await dialog.locator('.launch-agent select').selectOption('copilot')
  await dialog
    .getByRole('group', { name: '模型', exact: true })
    .getByRole('combobox')
    .selectOption('copilot-fixture')
  await dialog
    .getByRole('group', { name: 'Copilot 运行模式', exact: true })
    .getByRole('combobox')
    .selectOption('plan')
  await dialog.locator('.new-session-fields').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: 'build/cli-alignment-preview.png', animations: 'disabled' })
  await create.focus()
  await expect(create).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})
