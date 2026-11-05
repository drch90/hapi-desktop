import { test, expect } from './fixtures/desktop'

test('new session remembers the selected CLI after cancellation and falls back when it is unavailable', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const open = page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true })
  const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
  const agent = dialog.getByLabel('Agent', { exact: true })
  await open.click()
  await agent.selectOption('pi')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await open.click()
  await expect(agent).toHaveValue('pi')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  server.agentConfig.availability.set('linux-1', [{ agent: 'claude', available: true }])
  await page.reload()
  await open.click()
  await expect(agent).toHaveValue('claude')
  await expect(dialog.getByRole('button', { name: '创建会话', exact: true })).toBeEnabled()
  expect(server.spawnCount).toBe(0)
  expect(errors).toEqual([])
})

test('successful launch choices survive reload and stay isolated from other runners, CLIs and failed attempts', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const firstMachine = server.machines[0]
  if (!firstMachine) throw new Error('Fixture machine missing')
  server.machines.push({
    ...firstMachine,
    id: 'runner-b',
    metadata: { ...firstMachine.metadata, host: 'runner-b' },
  })
  await page.reload()
  const open = page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true })
  const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
  const agent = dialog.getByLabel('Agent', { exact: true })
  const model = dialog.getByRole('group', { name: '模型', exact: true }).getByRole('combobox')
  const effort = dialog.getByRole('group', { name: '思考强度', exact: true }).getByRole('combobox')
  const permission = dialog.getByRole('group', { name: '权限模式', exact: true }).getByRole('combobox')
  const mode = dialog.getByRole('group', { name: '模式', exact: true }).getByRole('combobox')
  const fastMode = dialog.getByRole('group', { name: '快速模式', exact: true }).getByRole('combobox')
  const create = dialog.getByRole('button', { name: '创建会话', exact: true })
  const cancel = dialog.getByRole('button', { name: '取消', exact: true })
  await open.click()
  await agent.selectOption('codex')
  await model.selectOption('fixture-codex')
  await effort.selectOption('high')
  await permission.selectOption('yolo')
  await mode.selectOption('plan')
  await fastMode.selectOption('fast')
  await create.click()
  await expect(page.getByTestId('chat-created')).toBeVisible()
  expect(server.requests.find((request) => request.path.endsWith('/spawn'))?.body).toMatchObject({
    agent: 'codex',
    model: 'fixture-codex',
    modelReasoningEffort: 'high',
    permissionMode: 'yolo',
    collaborationMode: 'plan',
    serviceTier: 'fast',
  })

  await page.reload()
  await open.click()
  await expect(agent).toHaveValue('codex')
  await expect(create).toBeEnabled()
  await expect(model).toHaveValue('fixture-codex')
  await expect(effort).toHaveValue('high')
  await expect(permission).toHaveValue('yolo')
  await expect(mode).toHaveValue('default')
  await expect(fastMode).toHaveValue('standard')
  await dialog.locator('select').first().selectOption('runner-b')
  await expect(create).toBeEnabled()
  await expect(model).toHaveValue('auto')
  await expect(effort).toHaveValue('default')
  await expect(permission).toHaveValue('default')
  await dialog.locator('select').first().selectOption('linux-1')
  await expect(create).toBeEnabled()
  await expect(model).toHaveValue('fixture-codex')
  await expect(effort).toHaveValue('high')
  await agent.selectOption('pi')
  await expect(model).toHaveValue('auto')
  await expect(dialog.getByTestId('permission-managed')).toBeVisible()
  await agent.selectOption('codex')
  await expect(model).toHaveValue('fixture-codex')
  await expect(permission).toHaveValue('yolo')

  await model.selectOption('fixture-fast')
  await effort.selectOption('low')
  await permission.selectOption('read-only')
  await cancel.click()
  await open.click()
  await expect(model).toHaveValue('fixture-codex')
  await expect(effort).toHaveValue('high')
  await expect(permission).toHaveValue('yolo')
  await model.selectOption('fixture-fast')
  await effort.selectOption('low')
  await permission.selectOption('read-only')
  server.failSpawn = true
  await create.click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(model).toHaveValue('fixture-fast')
  await expect(effort).toHaveValue('low')
  await cancel.click()
  server.failSpawn = false
  await page.reload()
  await open.click()
  await expect(create).toBeEnabled()
  await expect(model).toHaveValue('fixture-codex')
  await expect(effort).toHaveValue('high')
  await expect(permission).toHaveValue('yolo')
  expect(server.spawnCount).toBe(1)
  expect(errors).toEqual([])
})

test('restoring a directory model waits for discovery before submitting and rechecks removed options', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const open = page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true })
  const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
  const model = dialog.getByRole('group', { name: '模型', exact: true }).getByRole('combobox')
  const create = dialog.getByRole('button', { name: '创建会话', exact: true })
  await open.click()
  await dialog.getByLabel('Agent', { exact: true }).selectOption('kimi')
  await model.selectOption('office-kimi')
  await create.click()
  await expect(page.getByTestId('chat-created')).toBeVisible()
  const gate = Promise.withResolvers<void>()
  server.agentConfig.modelGates.set('kimi-models', gate.promise)
  try {
    await page.reload()
    await open.click()
    await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('kimi')
    await expect(model).toHaveValue('office-kimi')
    await expect(create).toBeDisabled()
    expect(server.spawnCount).toBe(1)
    server.agentConfig.catalogs.set('kimi-models', {
      success: true,
      availableModels: [{ modelId: 'replacement-kimi' }],
    })
    gate.resolve()
    await expect(create).toBeEnabled()
    await expect(model).toHaveValue('auto')
    await create.click()
    await expect(page.getByTestId('chat-created-2')).toBeVisible()
    const launches = server.requests.filter((request) => request.path.endsWith('/spawn'))
    expect(launches.at(-1)?.body).not.toHaveProperty('model')
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
    server.agentConfig.modelGates.delete('kimi-models')
  }
})
