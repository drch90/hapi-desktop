import { readFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
let command = args.shift()
if (!command) throw new Error('A command is required')
if (process.platform === 'linux') {
  const allowed = readFileSync('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]
  if (!allowed) throw new Error('Cannot determine CPU affinity')
  const cpus = []
  for (const range of allowed.split(',')) {
    const [first, last = first] = range.split('-').map(Number)
    for (let cpu = first; cpu <= last && cpus.length < 2; cpu++) cpus.push(cpu)
    if (cpus.length === 2) break
  }
  console.log(`CPU limit: ${cpus.length}; affinity: ${cpus.join(',')}`)
  args.unshift('-c', cpus.join(','), command)
  command = 'taskset'
} else if (process.platform === 'win32') {
  const affinity = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '([System.Diagnostics.Process]::GetCurrentProcess().ProcessorAffinity).ToInt64()',
    ],
    { encoding: 'utf8' },
  ).trim()
  const allowed = BigInt.asUintN(64, BigInt(affinity))
  let mask = 0n,
    selected = 0
  for (let bit = 0n; bit < 64n && selected < 2; bit++)
    if (allowed & (1n << bit)) {
      mask |= 1n << bit
      selected++
    }
  if (!selected) throw new Error('Cannot determine CPU affinity')
  const quoted = [command, ...args]
    .map((value) => {
      if (/["&|<>^%\r\n]/.test(value))
        throw new Error('Unsupported command character in CPU-limited Windows runner')
      return `"${value}"`
    })
    .join(' ')
  args.splice(0, args.length, '/d', '/s', '/c', `start "" /b /wait /affinity ${mask.toString(16)} ${quoted}`)
  command = 'cmd.exe'
  console.log(`CPU limit: ${selected}; affinity mask: ${mask.toString(16)}`)
} else {
  throw new Error('Run verification in a Linux or Windows environment with CPU affinity support')
}
const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, GOMAXPROCS: '2' },
  windowsVerbatimArguments: process.platform === 'win32',
})
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
