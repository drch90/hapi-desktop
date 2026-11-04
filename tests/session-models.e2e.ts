import { mkdir } from 'node:fs/promises'
import { test, expect } from './fixtures/desktop'

test('OpenCode models remain selectable without reasoning variants and follow the next model capabilities', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const session = server.sessions.get('history')
  if (!session) throw new Error('Fixture session missing')
  session.active = true
  session.model = 'fixture/opencode'
  server.agentConfig.catalogs.set('opencode-reasoning-effort-options', {
    success: false,
    error: 'OpenCode reasoning effort options are not available',
    currentModelId: session.model,
    targetModelId: session.model,
  })
  await page.getByTestId('session-history').click()
  await page.getByTestId('chat-history').getByRole('button', { name: '会话设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '会话设置', exact: true })
  const models = dialog.getByRole('combobox', { name: '模型', exact: true })
  const effort = dialog.getByRole('combobox', { name: '思考强度', exact: true })
  await expect(models).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(effort).toHaveCount(0)
  await models.focus()
  await expect(models).toBeFocused()
  await mkdir('build/session-interaction-fixes', { recursive: true })
  await page.screenshot({ path: 'build/session-interaction-fixes/opencode-models.png' })

  server.agentConfig.catalogs.delete('opencode-reasoning-effort-options')
  await models.selectOption('fixture/other')
  await expect(models).toHaveValue('fixture/other')
  await expect(effort).toBeEnabled()
  await expect(effort.locator('option[value="minimal"]')).toHaveCount(1)
  await effort.selectOption('minimal')
  await expect(effort).toHaveValue('minimal')
  expect(server.requests.filter((request) => request.path.endsWith('/model')).at(-1)?.body).toEqual({
    model: 'fixture/other',
  })
  expect(errors).toEqual([])
})

test('OpenCode refresh recovers model discovery while reasoning discovery is still waiting', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const session = server.sessions.get('history')
  if (!session) throw new Error('Fixture session missing')
  session.active = true
  session.model = 'fixture/opencode'
  server.agentConfig.catalogs.set('opencode-models', {
    success: true,
    availableModels: [{ modelId: 'fixture/opencode' }, { modelId: 'fixture/other' }],
    currentModelId: session.model,
  })
  server.agentConfig.failModels.add('opencode-models')
  server.agentConfig.catalogs.set('opencode-reasoning-effort-options', { success: true, options: [] })
  const gate = Promise.withResolvers<void>()
  server.agentConfig.modelGates.set('opencode-reasoning-effort-options', gate.promise)
  try {
    await page.getByTestId('session-history').click()
    await page.getByTestId('chat-history').getByRole('button', { name: '会话设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '会话设置', exact: true })
    const models = dialog.getByRole('combobox', { name: '模型', exact: true })
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(models).toBeDisabled()
    server.agentConfig.failModels.delete('opencode-models')
    await dialog.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(models).toBeEnabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await models.selectOption('fixture/other')
    await expect(models).toHaveValue('fixture/other')
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
    server.agentConfig.modelGates.clear()
  }
})
