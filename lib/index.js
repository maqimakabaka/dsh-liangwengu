/**
 * 梁文谷 · DSH 谷价调度器 —— 宿主半侧
 *
 * 职责：
 *  - 维护 ~/.dsh/liangwengu/state.json（配置、任务队列、定价缓存、余额、日志）
 *  - 按 DeepSeek 官方峰谷时段（UTC 01:00-04:00、06:00-10:00，周一至周五为峰时）
 *    在谷价窗口内自动新建会话或向已有会话发送预先编辑好的内容
 *  - 抓取官方定价页、查询账户余额；余额低于阈值时暂停队列并发出告警
 *  - 通过同源 HTTP 路由 /dsh-liangwengu/* 向浏览器半侧的面板提供数据
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const PACKAGE = 'dsh-liangwengu'
const API = '/dsh-liangwengu'
const STATE_DIR = process.env.DSH_LIANGWENGU_STATE_DIR || path.join(os.homedir(), '.dsh', 'liangwengu')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const PRICING_FILE = path.join(STATE_DIR, 'pricing.last.md')
const UPLOAD_DIR = path.join(STATE_DIR, 'uploads')

// 附件只接受图片与文本类文件（与面板的提示保持一致，服务端再兜一层）。
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'])
const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.log', '.yaml', '.yml',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.sql', '.ini', '.cfg', '.conf', '.toml',
  '.gitignore', '.vue', '.svelte',
])
const PKG_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SOUND_KINDS = ['balance', 'valley', 'peak']
const BUNDLED_SOUNDS = {
  balance: path.join(PKG_DIR, 'assets', 'YuE.mp3'),
  valley: path.join(PKG_DIR, 'assets', 'Gu.mp3'),
  peak: path.join(PKG_DIR, 'assets', 'BuGu.mp3'),
}
const HOLIDAY_DIR = path.join(STATE_DIR, 'holidays')
const holidayUrls = (year) => [
  `https://cdn.jsdelivr.net/npm/chinese-days/dist/years/${year}.json`,
  `https://unpkg.com/chinese-days/dist/years/${year}.json`,
]
const PRICING_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md'
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance'

/** 官方峰时时段（UTC，左闭右开）。 */
const SEED_WINDOWS = [
  { start: '01:00', end: '04:00' },
  { start: '06:00', end: '10:00' },
]
const SEED_MODELS = [
  {
    // 人民币 / 百万 tokens，来源：官方定价页（DeepSeek-V4.1-Flash-1017）
    id: 'deepseek-flash',
    name: 'deepseek-flash',
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  {
    id: 'deepseek-v4-pro',
    name: 'deepseek-v4-pro',
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
]

const CONFIG_DEFAULTS = {
  enabled: true,
  soundEnabled: true,
  soundFile: '', // 旧版单槽位，读取时迁移到 soundBalance
  soundBalance: '',
  soundValley: '',
  soundPeak: '',
  volumeBalance: 80,
  volumeValley: 80,
  volumePeak: 80,
  balanceThreshold: 5,
  balanceCurrency: 'CNY',
  balanceRefreshMinutes: 30,
  balanceGate: true,
  pricingRefresh: 'startup', // 'off' | 'startup' | 'daily' | 'weekly'
  peakPolicy: 'defer', // 'defer' | 'run'
  holidays: [], // 'YYYY-MM-DD'（中国法定节假日，法定节假日全天谷价）
  autoStartTyping: false,
  themeMode: 'auto', // 'auto' | 'light' | 'dark'
  lang: 'auto', // 'auto' | 'zh' | 'en'
  workspaceFilter: 'auto', // 'auto' = 仅默认工作区；其他值为工作区路径
}


/** 各配置字段的合法取值；用于校验 HTTP 补丁，避免非法值污染状态。 */
const CONFIG_RULES = {
  enabled: { type: 'boolean' },
  soundEnabled: { type: 'boolean' },
  balanceGate: { type: 'boolean' },
  autoStartTyping: { type: 'boolean' },
  soundFile: { type: 'string' },
  soundBalance: { type: 'string' },
  soundValley: { type: 'string' },
  soundPeak: { type: 'string' },
  balanceCurrency: { type: 'string', values: ['CNY', 'USD'] },
  volumeBalance: { type: 'number', min: 0, max: 100, integer: true },
  volumeValley: { type: 'number', min: 0, max: 100, integer: true },
  volumePeak: { type: 'number', min: 0, max: 100, integer: true },
  balanceThreshold: { type: 'number', min: 0, max: 1000000 },
  balanceRefreshMinutes: { type: 'number', min: 1, max: 1440, integer: true },
  pricingRefresh: { type: 'string', values: ['off', 'startup', 'daily', 'weekly'] },
  peakPolicy: { type: 'string', values: ['defer', 'run'] },
  themeMode: { type: 'string', values: ['auto', 'light', 'dark'] },
  lang: { type: 'string', values: ['auto', 'zh', 'en'] },
  workspaceFilter: { type: 'string' },
  holidays: { type: 'array' },
}

/**
 * 校验并裁剪一份配置补丁：合法值保留，非法值丢弃（保持原值），并返回提示。
 * 这样即使面板或第三方脚本发来脏数据，状态里也不会出现 NaN / 越界音量 / 未知枚举。
 */
function sanitizeConfigPatch(patch) {
  const clean = {}
  const warnings = []
  for (const [key, value] of Object.entries(patch)) {
    const rule = CONFIG_RULES[key]
    if (!rule) continue
    if (rule.type === 'boolean') {
      if (typeof value === 'boolean') clean[key] = value
      else warnings.push(key + ' 需要布尔值')
      continue
    }
    if (rule.type === 'number') {
      const num = Number(value)
      if (!Number.isFinite(num)) {
        warnings.push(key + ' 需要数字')
        continue
      }
      let next = num
      if (rule.integer) next = Math.round(next)
      if (typeof rule.min === 'number' && next < rule.min) next = rule.min
      if (typeof rule.max === 'number' && next > rule.max) next = rule.max
      if (next !== num) warnings.push(key + ' 已修正到 ' + next)
      clean[key] = next
      continue
    }
    if (rule.type === 'string') {
      if (typeof value !== 'string') {
        warnings.push(key + ' 需要字符串')
        continue
      }
      if (rule.values && !rule.values.includes(value)) {
        warnings.push(key + ' 只支持 ' + rule.values.join(' / '))
        continue
      }
      clean[key] = value
      continue
    }
    if (rule.type === 'array') {
      if (!Array.isArray(value)) {
        warnings.push(key + ' 需要数组')
        continue
      }
      clean[key] = value
        .map((item) => String(item).trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
        .slice(0, 400)
    }
  }
  return { clean, warnings }
}

/** 任务入参校验；返回错误文案或 null。 */
function taskValidationError(input) {
  const data = input && typeof input === 'object' ? input : {}
  const content = typeof data.content === 'string' ? data.content : typeof data.prompt === 'string' ? data.prompt : typeof data.text === 'string' ? data.text : ''
  const attachments = Array.isArray(data.attachments) ? data.attachments.filter((a) => a && typeof a.path === 'string') : []
  const kind = data.kind === 'existing' ? 'existing' : 'new'
  if (!content.trim() && attachments.length === 0) return '指令内容不能为空'
  if (content.length > 100000) return '指令过长（上限 100000 字符）'
  if (attachments.length > 8) return '附件最多 8 个'
  if (kind === 'existing' && typeof data.sessionId !== 'string') return '请先选择一个目标会话'
  if (kind === 'existing' && !data.sessionId) return '请先选择一个目标会话'
  if (data.mode === 'at') {
    const at = typeof data.at === 'string' ? data.at : ''
    if (!at || !Number.isFinite(Date.parse(at))) return '执行时间格式无效，请重新选择日期'
  }
  if (data.preset !== undefined && data.preset !== '' && !/^[a-z0-9-]{1,40}$/i.test(String(data.preset))) return '权限预设无效'
  return null
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

function isoNow() {
  return new Date().toISOString()
}

function emptyState() {
  return {
    version: 2,
    config: { ...CONFIG_DEFAULTS },
    pricing: {
      fetchedAt: null,
      source: PRICING_SOURCE,
      online: false,
      note: '内置参考价：谷价 = 峰价 × 0.5',
      windows: SEED_WINDOWS.map((w) => ({ ...w })),
      weekdays: [1, 2, 3, 4, 5],
      offPeakMultiplier: 0.5,
      models: JSON.parse(JSON.stringify(SEED_MODELS)),
    },
    tasks: [],
    logs: [],
    alarm: null,
    balance: null,
    ledger: { entries: [], pending: [] },
    runtime: { pausedByBalance: false, runningTaskId: null, lastPricingCheck: null, lastBalanceCheck: null, lastPhase: null, phaseEvent: null, holidayFetched: null, holidayError: null },
    sessionsCache: { at: null, items: [] },
  }
}

let state = null
let writeChain = Promise.resolve()

function normalizeState(raw) {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const next = base
  if (raw.config && typeof raw.config === 'object') Object.assign(next.config, pruneConfig(raw.config))
  if (next.config.soundFile && !next.config.soundBalance) next.config.soundBalance = next.config.soundFile
  if (!['auto', 'light', 'dark'].includes(next.config.themeMode)) next.config.themeMode = 'auto'
  if (!['auto', 'zh', 'en'].includes(next.config.lang)) next.config.lang = 'auto'
  if (raw.pricing && typeof raw.pricing === 'object') {
    const p = raw.pricing
    if (Array.isArray(p.windows) && p.windows.length > 0) {
      next.pricing.windows = p.windows
        .filter((w) => w && typeof w.start === 'string' && typeof w.end === 'string')
        .map((w) => ({ start: w.start, end: w.end }))
      if (next.pricing.windows.length === 0) next.pricing.windows = SEED_WINDOWS.map((w) => ({ ...w }))
    }
    if (Array.isArray(p.weekdays) && p.weekdays.length > 0) next.pricing.weekdays = p.weekdays.filter((n) => n >= 1 && n <= 7)
    if (typeof p.offPeakMultiplier === 'number') next.pricing.offPeakMultiplier = p.offPeakMultiplier
    if (Array.isArray(p.models) && p.models.length > 0) next.pricing.models = p.models
    if (typeof p.fetchedAt === 'string') next.pricing.fetchedAt = p.fetchedAt
    if (typeof p.online === 'boolean') next.pricing.online = p.online
    if (typeof p.note === 'string') next.pricing.note = p.note
  }
  if (Array.isArray(raw.tasks)) next.tasks = raw.tasks.filter((t) => t && typeof t === 'object' && typeof t.id === 'string')
  if (Array.isArray(raw.logs)) next.logs = raw.logs.slice(-200)
  if (raw.alarm && typeof raw.alarm === 'object') next.alarm = raw.alarm
  if (raw.balance && typeof raw.balance === 'object') next.balance = raw.balance
  if (raw.runtime && typeof raw.runtime === 'object') Object.assign(next.runtime, raw.runtime)
  if (raw.sessionsCache && typeof raw.sessionsCache === 'object') next.sessionsCache = raw.sessionsCache
  if (raw.ledger && Array.isArray(raw.ledger.entries)) {
    next.ledger.entries = raw.ledger.entries
      .filter((entry) => entry && typeof entry.at === 'string' && Number.isFinite(Number(entry.cny ?? entry.cost)))
      .map((entry) => ({ ...entry, cny: Number(entry.cny ?? entry.cost) }))
      .slice(-4000)
  }
  return next
}

function pruneConfig(input) {
  const out = {}
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    const value = input[key]
    if (value === undefined) continue
    const def = CONFIG_DEFAULTS[key]
    if (Array.isArray(def)) {
      if (Array.isArray(value)) out[key] = value.map(String)
    } else if (typeof def === 'number') {
      const n = Number(value)
      if (Number.isFinite(n)) out[key] = n
    } else if (typeof def === 'boolean') {
      out[key] = Boolean(value)
    } else if (typeof def === 'string') {
      if (typeof value === 'string') out[key] = value
    }
  }
  return out
}

async function loadState() {
  try {
    const text = await fsp.readFile(STATE_FILE, 'utf8')
    return normalizeState(JSON.parse(text))
  } catch {
    return normalizeState(null)
  }
}

function saveState() {
  writeChain = writeChain
    .then(async () => {
      await fsp.mkdir(STATE_DIR, { recursive: true })
      const tmp = `${STATE_FILE}.${process.pid}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
      await fsp.rename(tmp, STATE_FILE)
    })
    .catch(() => {})
  return writeChain
}

function log(level, text) {
  const entry = { at: isoNow(), level, text }
  state.logs.push(entry)
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200)
  if (level === 'error') console.error(`[${PACKAGE}] ${text}`)
  else console.log(`[${PACKAGE}] ${text}`)
}

// ---------------------------------------------------------------------------
// 峰谷计算
// ---------------------------------------------------------------------------

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':')
  const hour = Number(h)
  const minute = Number(m)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

/** 北京时间（UTC+8）日期键 YYYY-MM-DD。 */
function beijingDateKey(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** ISO 星期（周一=1 … 周日=7）。 */
function beijingIsoDow(ms) {
  const day = new Date(ms + 8 * 3600 * 1000).getUTCDay()
  return day === 0 ? 7 : day
}

function isPeakAt(ms, pricing) {
  const windows = Array.isArray(pricing.windows) && pricing.windows.length > 0 ? pricing.windows : SEED_WINDOWS
  const weekdays = Array.isArray(pricing.weekdays) && pricing.weekdays.length > 0 ? pricing.weekdays : [1, 2, 3, 4, 5]
  const holidays = Array.isArray(state.config.holidays) ? state.config.holidays : []
  if (holidays.includes(beijingDateKey(ms))) return false
  if (!weekdays.includes(beijingIsoDow(ms))) return false
  const d = new Date(ms)
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  return windows.some((w) => {
    const start = toMinutes(w.start)
    const end = toMinutes(w.end)
    return start !== null && end !== null && start < end && minutes >= start && minutes < end
  })
}

function scanBoundary(fromMs, wantPeak) {
  const step = 60 * 1000
  let t = Math.floor(fromMs / step) * step
  const horizon = 60 * 24 * 8
  for (let i = 0; i < horizon; i += 1) {
    if (isPeakAt(t, state.pricing) === wantPeak) return t
    t += step
  }
  return null
}

/** 下一个谷价时刻（当前若已是谷价则返回当前分钟）。 */
function nextOffPeakAt(fromMs = Date.now()) {
  return scanBoundary(fromMs, false)
}

/** 下一个峰时时刻（当前若是谷价，返回峰时开始）。 */
function nextPeakAt(fromMs = Date.now()) {
  return scanBoundary(fromMs, true)
}

/** 谷价开始后 10 秒才执行，避免踩在计价切换的那一分钟上。 */
const VALLEY_DELAY_MS = 10 * 1000

/** 谷价任务的下一次可执行时刻：已在谷价则 10 秒后，否则下一个谷价开始 + 10 秒。 */
function valleyRunAt(fromMs = Date.now()) {
  // 已在谷价窗口内：立刻执行；只有峰时排队的任务，才等到谷价开始 10 秒后。
  if (!isPeakAt(fromMs, state.pricing)) return fromMs
  const start = scanBoundary(fromMs, false)
  if (start === null) return fromMs
  return start + VALLEY_DELAY_MS
}

function fmtClock(ms) {
  if (!ms) return '—'
  const d = new Date(ms + 8 * 3600 * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function fmtDateTime(ms) {
  if (!ms) return '—'
  const d = new Date(ms + 8 * 3600 * 1000)
  return `${d.toISOString().slice(5, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function localWindows() {
  const windows = Array.isArray(state.pricing.windows) ? state.pricing.windows : SEED_WINDOWS
  return windows.map((w) => {
    const toLocal = (hhmm) => {
      const minutes = toMinutes(hhmm)
      if (minutes === null) return hhmm
      const local = (minutes + 8 * 60) % (24 * 60)
      return `${String(Math.floor(local / 60)).padStart(2, '0')}:${String(local % 60).padStart(2, '0')}`
    }
    return { start: toLocal(w.start), end: toLocal(w.end), startUtc: w.start, endUtc: w.end }
  })
}

// ---------------------------------------------------------------------------
// 定价抓取
// ---------------------------------------------------------------------------

/** 把北京时间 HH:MM 转为 UTC HH:MM（跨零点取模）。 */
function beijingClockToUtc(hhmm) {
  const minutes = toMinutes(hhmm)
  if (minutes === null) return null
  const utc = ((minutes - 8 * 60) % 1440 + 1440) % 1440
  const hour = Math.floor(utc / 60)
  const minute = utc % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 从官方中文定价页提取高峰时段（页面给的是北京时间）。 */
function parseWindowsFromMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/)
  const peakLine = lines.find((line) => /高峰时段/.test(line) && /\d{1,2}:\d{2}/.test(line)) || ''
  const source = peakLine || md
  const out = []
  const re = /(\d{1,2}):(\d{2})\s*(?:-|–|—|~|至)\s*(\d{1,2}):(\d{2})/g
  let m
  while ((m = re.exec(source)) !== null) {
    const startBj = `${String(m[1]).padStart(2, '0')}:${m[2]}`
    const endBj = `${String(m[3]).padStart(2, '0')}:${m[4]}`
    const start = beijingClockToUtc(startBj)
    const end = beijingClockToUtc(endBj)
    if (!start || !end || start >= end) continue
    if (!out.some((w) => w.start === start && w.end === end)) out.push({ start, end })
    if (out.length >= 4) break
  }
  return out
}

/**
 * 解析官方中文定价表。
 * 行形如：`| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |`
 * 表头形如：`| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |`
 * 返回人民币 / 百万 tokens 价格。
 */
function parsePricesFromMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/)
  const splitRow = (line) => line.split('|').slice(1, line.split('|').length - 1).map((cell) => cell.trim())
  const headerIndex = lines.findIndex((line) => /deepseek-flash/i.test(line) && line.includes('|'))
  if (headerIndex < 0) return []
  const header = splitRow(lines[headerIndex])
  const columns = []
  header.forEach((cell, index) => {
    const match = cell.match(/(deepseek-[a-z0-9.-]+)/i)
    if (match) columns.push({ id: match[1].toLowerCase(), column: index })
  })
  if (columns.length === 0) return []
  const models = columns.map((item) => ({ id: item.id, name: item.id, peak: {}, offPeak: {} }))
  const rows = lines.slice(headerIndex + 1).filter((line) => line.trim().startsWith('|'))
  for (const line of rows) {
    const cells = splitRow(line)
    const priceCell = cells[0] || ''
    if (!/价格/.test(priceCell)) continue
    const label = cells[1] || ''
    const phase = cells[2] || ''
    const key = /空闲/.test(phase) ? 'offPeak' : /高峰/.test(phase) ? 'peak' : ''
    if (!key) continue
    let field = ''
    if (/缓存命中/.test(label)) field = 'cacheHit'
    else if (/缓存未命中|缓存不命中/.test(label)) field = 'cacheMiss'
    else if (/输出/.test(label)) field = 'output'
    if (!field) continue
    columns.forEach((item, index) => {
      const raw = cells[item.column]
      if (!raw) return
      const value = Number(String(raw).replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(value)) return
      // 美元页（英文版）为小数价格，中文页为人民币整数价；这里统一按人民币处理
      models[index][key][field] = value
    })
  }
  return models.filter((m) => Object.keys(m.peak).length > 0 && Object.keys(m.offPeak).length > 0)
}

/** 需要抓取节假日的年份：当前年 + 2025（本次补抓）；12 月 15 日之后再加次年。 */
function holidayTargetYears(nowMs = Date.now()) {
  const bj = new Date(nowMs + 8 * 3600 * 1000)
  const year = bj.getUTCFullYear()
  const month = bj.getUTCMonth() + 1
  const day = bj.getUTCDate()
  const years = new Set([year, 2025])
  if (month === 12 && day >= 15) years.add(year + 1)
  return [...years].sort((a, b) => a - b)
}

/** 用 PowerShell 拉取文本（系统代理、TLS 设置都能沿用 Windows 的）。 */
function powershellGet(url) {
  const script =
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " +
    "$ProgressPreference='SilentlyContinue'; " +
    `(Invoke-WebRequest -UseBasicParsing -Uri '${url}' -TimeoutSec 30).Content`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { maxBuffer: 4 * 1024 * 1024, timeout: 60000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || error.message
          reject(new Error(detail.slice(0, 160)))
          return
        }
        if (!stdout || !String(stdout).trim()) {
          reject(new Error('PowerShell 未返回内容'))
          return
        }
        resolve(String(stdout))
      },
    )
  })
}

async function fetchHolidayYear(year) {
  const urls = holidayUrls(year)
  const attempt = async (url) => {
    const parsed = JSON.parse(await powershellGet(url))
    const dates = Object.keys(parsed.holidays || {}).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
    if (dates.length === 0) throw new Error('节假日列表为空')
    return { dates, source: url }
  }
  const results = await Promise.allSettled(urls.map((url) => attempt(url)))
  const ok = results.find((item) => item.status === 'fulfilled')
  if (ok) return ok.value
  throw new Error(results.map((item) => (item.status === 'rejected' ? String(item.reason?.message || item.reason) : '')).filter(Boolean).join('；'))
}

function mergeHolidays(dates) {
  const set = new Set(state.config.holidays || [])
  for (const date of dates) set.add(date)
  state.config.holidays = [...set].sort()
}

/** 启动时按年补抓法定节假日，每个年份只抓成功一次。 */
async function ensureHolidays() {
  if (state.runtime.holidaysRunning) return
  state.runtime.holidaysRunning = true
  try {
    for (const year of holidayTargetYears()) {
      if (state.runtime.holidayFetched && state.runtime.holidayFetched[year]) continue
      try {
        const { dates, source } = await fetchHolidayYear(year)
        mergeHolidays(dates)
        state.runtime.holidayFetched = { ...(state.runtime.holidayFetched || {}), [year]: isoNow() }
        state.runtime.holidayError = null
        await fsp.mkdir(HOLIDAY_DIR, { recursive: true })
        await fsp.writeFile(
          path.join(HOLIDAY_DIR, `${year}.json`),
          JSON.stringify({ year, source, fetchedAt: isoNow(), holidays: dates }, null, 2),
          'utf8',
        )
        log('info', `节假日已更新：${year} 年共 ${dates.length} 天`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        state.runtime.holidayError = { year, message, at: isoNow() }
        log('warn', `节假日抓取失败：${year} 年 ${message}`)
      }
      await saveState()
    }
  } finally {
    state.runtime.holidaysRunning = false
  }
}

/** 记录峰谷切换，供面板播放「谷价提醒 / 峰价提醒」。 */
function trackPhase() {
  const now = Date.now()
  const phase = isPeakAt(now, state.pricing) ? 'peak' : 'valley'
  const previous = state.runtime.lastPhase || null
  if (previous && previous !== phase) {
    state.runtime.phaseEvent = { id: `${phase}-${now}`, phase, at: isoNow() }
  }
  state.runtime.lastPhase = phase
}

async function refreshPricing() {
  try {
    const res = await fetch(PRICING_SOURCE, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'text/markdown,text/plain,*/*' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()
    if (!md || md.length < 200) throw new Error('定价页内容异常')
    await fsp.mkdir(STATE_DIR, { recursive: true })
    await fsp.writeFile(PRICING_FILE, md, 'utf8')
    const windows = parseWindowsFromMarkdown(md)
    const models = parsePricesFromMarkdown(md)
    if (windows.length > 0) state.pricing.windows = windows
    if (models.length > 0) state.pricing.models = models
    state.pricing.fetchedAt = isoNow()
    state.pricing.online = true
    state.pricing.note = '已从官方定价页抓取'
    log('info', '定价时段已更新：' + state.pricing.windows.map((w) => `${w.start}-${w.end} UTC`).join('、'))
  } catch (error) {
    state.pricing.online = false
    state.pricing.fetchedAt = isoNow()
    state.pricing.note = `抓取失败，沿用缓存（${error instanceof Error ? error.message : String(error)}）`
    log('warn', `定价抓取失败：${error instanceof Error ? error.message : String(error)}，已沿用缓存`)
  }
  state.runtime.lastPricingCheck = isoNow()
  await saveState()
  return state.pricing
}

// ---------------------------------------------------------------------------
// 余额
// ---------------------------------------------------------------------------

async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials')
  if (!credentials) return ''
  const names = ['DEEPSEEK_API_KEY', 'deepseek-api-key', 'deepseek', 'DEEPSEEK_API_KEY_WEB']
  for (const name of names) {
    try {
      const value = await credentials.resolve(name)
      if (typeof value === 'string' && value.length > 0) return value
      if (value && typeof value.value === 'string' && value.value.length > 0) return value.value
    } catch {
      // 尝试下一个名字
    }
  }
  return ''
}

async function balanceViaApiKey(ctx) {
  const key = await resolveApiKey(ctx)
  if (!key) throw new Error('未找到 DEEPSEEK_API_KEY 凭证')
  const res = await fetch(BALANCE_ENDPOINT, {
    signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const info = Array.isArray(json?.balance_infos) ? json.balance_infos[0] : undefined
  const total = info ? Number(info.total_balance) : null
  return {
    total: Number.isFinite(total) ? total : null,
    currency: info?.currency || 'CNY',
    isAvailable: json?.is_available === true,
    source: 'api-key',
  }
}

/**
 * 账号登录（无 API key）路径：复用 DSH 的 deepseekAccount 服务。
 * 该服务是可选的，必须用 ctx.get 读取，不能写进 inject，否则未启用账号登录的宿主会启动失败。
 */
async function balanceViaAccount(ctx) {
  const account = ctx.get('deepseekAccount')
  if (!account || typeof account.getBalance !== 'function') throw new Error('当前环境未启用账号登录')
  let result
  try {
    result = await account.getBalance({
      version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
      locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`账号余额接口调用失败：${detail}`.slice(0, 160))
  }
  if (!result) throw new Error('未登录 DeepSeek 账号（没有账号凭据）')
  if (result.status !== 'ready') {
    const detail = result.error ? result.error.message || result.error.code : String(result.status || 'unknown')
    throw new Error(`账号余额接口未就绪（${detail}）`)
  }
  // 平台把钱包拆成充值钱包（value）与赠金钱包（bonusWallets），两处相加才是总余额；
  // 只有赠金、没有充值的账号也必须算成功。
  const normRaw = Array.isArray(result.value) ? result.value : []
  const bonusRaw = Array.isArray(result.bonusWallets) ? result.bonusWallets : []
  const usable = (list) => list.filter((wallet) => wallet && Number.isFinite(Number(wallet.balance)))
  const normWallets = usable(normRaw)
  const bonusWallets = usable(bonusRaw)
  const allWallets = normWallets.concat(bonusWallets)
  if (allWallets.length === 0) {
    throw new Error(normRaw.length || bonusRaw.length ? '账号钱包字段不可用' : '账号没有余额钱包')
  }
  const curOf = (wallet) => String((wallet && wallet.currency) || 'CNY').toUpperCase()
  const nonzero = allWallets.filter((wallet) => Number(wallet.balance) > 0)
  const picked = nonzero.find((wallet) => curOf(wallet) === 'CNY') || nonzero[0] || allWallets.find((wallet) => curOf(wallet) === 'CNY') || allWallets[0]
  const currency = curOf(picked)
  const recharge = normWallets.filter((wallet) => curOf(wallet) === currency).reduce((sum, wallet) => sum + Number(wallet.balance), 0)
  const bonus = bonusWallets.filter((wallet) => curOf(wallet) === currency).reduce((sum, wallet) => sum + Number(wallet.balance), 0)
  return {
    total: Number((recharge + bonus).toFixed(6)),
    currency,
    isAvailable: true,
    source: 'account',
    recharge,
    bonus,
  }
}

let hostCtx = null

/** 某一类提示音：自定义文件优先，否则用插件内置的默认音频。 */
function resolveSoundFile(kind = 'balance') {
  const slot = SOUND_KINDS.includes(kind) ? kind : 'balance'
  const custom = state.config['sound' + slot.charAt(0).toUpperCase() + slot.slice(1)]
  if (custom && fs.existsSync(custom)) return custom
  const bundled = BUNDLED_SOUNDS[slot]
  if (bundled && fs.existsSync(bundled)) return bundled
  return ''
}

function soundSlotInfo(kind) {
  const slot = SOUND_KINDS.includes(kind) ? kind : 'balance'
  const file = resolveSoundFile(slot)
  const custom = state.config['sound' + slot.charAt(0).toUpperCase() + slot.slice(1)]
  const isCustom = Boolean(custom && fs.existsSync(custom))
  return {
    kind: slot,
    configured: Boolean(file),
    name: file ? path.basename(file) : '',
    isDefault: Boolean(file) && !isCustom,
    custom: isCustom,
    url: `${API}/sound?kind=${slot}`,
    volume: Number(state.config['volume' + slot.charAt(0).toUpperCase() + slot.slice(1)] ?? 80),
  }
}

async function refreshBalance(ctx, reason = 'manual') {
  const failures = []
  try {
    let outcome = null
    try {
      outcome = await balanceViaApiKey(ctx)
    } catch (error) {
      failures.push(`API key：${error instanceof Error ? error.message : String(error)}`)
      outcome = await balanceViaAccount(ctx)
    }
    state.balance = {
      ok: outcome.total !== null,
      at: isoNow(),
      isAvailable: outcome.isAvailable,
      total: outcome.total,
      currency: outcome.currency,
      source: outcome.source,
      reason,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.balance = {
      ok: false,
      at: isoNow(),
      total: null,
      currency: state.config.balanceCurrency,
      source: 'none',
      reason,
      error: failures.length > 0 ? `${failures[0]}；账号：${message}` : message,
    }
    log('warn', `余额查询失败：${state.balance.error}`)
  }
  state.runtime.lastBalanceCheck = isoNow()
  if (reason === 'manual') {
    if (state.balance.ok) log('info', `余额已更新：¥${Number(state.balance.total).toFixed(2)}`)
    else log('warn', `余额刷新失败：${state.balance.error || '未知原因'}`)
  }
  await evaluateBalanceGate()
  await saveState()
  return state.balance
}

async function evaluateBalanceGate() {
  const balance = state.balance
  if (!balance || balance.ok !== true || balance.total === null) return
  const threshold = Number(state.config.balanceThreshold)
  if (!state.config.balanceGate || !Number.isFinite(threshold)) return
  if (balance.total < threshold) {
    triggerAlarm('余额低于阈值')
  }
}

function triggerAlarm(reason) {
  const balance = state.balance
  if (!state.alarm) {
    state.alarm = {
      id: randomUUID(),
      at: isoNow(),
      reason,
      balance: balance?.total ?? null,
      currency: balance?.currency || state.config.balanceCurrency,
      threshold: state.config.balanceThreshold,
    }
    log('warn', `报警：${reason}，余额 ${balance?.total ?? '—'} ${balance?.currency || ''}`)
  }
  state.runtime.pausedByBalance = true
}

// ---------------------------------------------------------------------------
// 会话与任务执行
// ---------------------------------------------------------------------------

async function listSessions(ctx, force = false) {
  const cache = state.sessionsCache
  const fresh = cache?.at && Date.now() - Date.parse(cache.at) < 15000
  if (fresh && !force) return cache.items
  const controller = ctx.get('sessionController')
  if (!controller) return []
  try {
    const result = await controller.list({})
    const items = Array.isArray(result?.items) ? result.items : []
    const mapped = items
      .map((item) => {
        const id = item?.sessionId || item?.id
        if (typeof id !== 'string') return null
        const projected = item.projections && item.projections.values ? item.projections.values : {}
        const title = item.title || item.displayTitle || item.summary || (typeof projected.title === 'string' ? projected.title : '') || ''
        const rawUpdated = item.updatedAt || item.lastActivityAt || item.createdAt || null
        const updatedAt = typeof rawUpdated === 'number' ? new Date(rawUpdated).toISOString() : rawUpdated
        return {
          id,
          title: title.trim(),
          cwd: item.cwd || item.workspacePath || '',
          model: item.model || item.selection?.model || '',
          provider: item.provider || item.selection?.provider || '',
          updatedAt,
          busy: item.busy === true || item.running === true,
        }
      })
      .filter((item) => item && item.title)
    const filtered = filterByWorkspace(mapped)
    state.sessionsCache = { at: isoNow(), items: filtered }
    await saveState()
    return filtered
  } catch (error) {
    log('warn', `会话列表读取失败：${error instanceof Error ? error.message : String(error)}`)
    return cache?.items || []
  }
}

function normCwd(value) {
  return String(value || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 默认工作区 = 会话数最多的工作目录；settings 里可指定具体路径覆盖。 */
function dominantCwd(items) {
  const counts = new Map()
  for (const item of items) {
    const key = normCwd(item.cwd)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let best = ''
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

function filterByWorkspace(items) {
  const wanted = String(state.config.workspaceFilter || 'auto')
  if (wanted && wanted !== 'auto') {
    const target = normCwd(wanted)
    return items.filter((item) => normCwd(item.cwd) === target)
  }
  const defaultCwd = dominantCwd(items)
  if (!defaultCwd) return items
  return items.filter((item) => normCwd(item.cwd) === defaultCwd)
}

// ---------------------------------------------------------------------------
// 记账本（用量估算）
// ---------------------------------------------------------------------------

const pendingUsage = new Map()

function usageKey(sessionId, turn) {
  return `${sessionId || 'unknown'}:${turn === undefined || turn === null ? 'x' : turn}`
}

function priceEntryFor(modelId) {
  const models = Array.isArray(state.pricing.models) && state.pricing.models.length > 0 ? state.pricing.models : SEED_MODELS
  const key = String(modelId || '').toLowerCase()
  const exact = models.find((model) => String(model.id || '').toLowerCase() === key)
  if (exact) return exact
  const partial = models.find((model) => key && (key.includes(String(model.id || '').toLowerCase()) || String(model.id || '').toLowerCase().includes(key)))
  if (partial) return partial
  const pro = models.find((model) => String(model.id || '').includes('pro'))
  return pro || models[0]
}

/** 按当次是否为峰时选择价格，返回人民币费用（价格表单位为元/百万 token）。 */
function costFor(modelId, atMs, usage) {
  const entry = priceEntryFor(modelId)
  const isPeak = isPeakAt(atMs, state.pricing)
  const prices = (isPeak ? entry && entry.peak : entry && entry.offPeak) || (entry && entry.peak) || { cacheHit: 0, cacheMiss: 0, output: 0 }
  const input = Number(usage?.inputTokens || 0)
  const cache = Number(usage?.cacheReadTokens || 0)
  const output = Number(usage?.outputTokens || 0)
  const cny = (cache / 1e6) * Number(prices.cacheHit || 0) + (input / 1e6) * Number(prices.cacheMiss || 0) + (output / 1e6) * Number(prices.output || 0)
  return { cny: Number(cny.toFixed(6)), peak: isPeak }
}

function flushUsage(sessionId, turn) {
  const key = usageKey(sessionId, turn)
  const pending = pendingUsage.get(key)
  if (!pending) return
  pendingUsage.delete(key)
  const usage = pending.usage
  if (!usage || (usage.inputTokens + usage.cacheReadTokens + usage.outputTokens) <= 0) return
  const cost = costFor(pending.model, pending.at, usage)
  state.ledger.entries.push({
    at: new Date(pending.at).toISOString(),
    sessionId: String(sessionId || ''),
    turn: turn === undefined ? null : turn,
    model: String(pending.model || ''),
    peak: cost.peak,
    inputTokens: Number(usage.inputTokens || 0),
    cacheTokens: Number(usage.cacheReadTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    cny: cost.cny,
  })
  if (state.ledger.entries.length > 4000) state.ledger.entries.splice(0, state.ledger.entries.length - 4000)
  saveState()
}

function flushSessionUsage(sessionId) {
  for (const key of Array.from(pendingUsage.keys())) {
    if (key.startsWith(`${sessionId || 'unknown'}:`)) {
      const turn = key.slice(key.lastIndexOf(':') + 1)
      flushUsage(sessionId, turn === 'x' ? undefined : Number(turn))
    }
  }
}

function handleSessionEvent(session, event) {
  try {
    const type = event && event.type
    if (type !== 'assistant/message' && type !== 'turn/end') return
    const data = event.data || {}
    const sessionId = (session && (session.id || session.sessionId)) || data.sessionId || ''
    const turn = data.turn
    const key = usageKey(sessionId, turn)
    if (type === 'assistant/message') {
      const usage = data.usage
      if (!usage) return
      const current = pendingUsage.get(key) || { usage: { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, model: '', at: Date.now() }
      current.usage.inputTokens += Number(usage.inputTokens || 0)
      current.usage.cacheReadTokens += Number(usage.cacheReadTokens || 0)
      current.usage.outputTokens += Number(usage.outputTokens || 0)
      const model = data.message && data.message.source && data.message.source.model
      if (typeof model === 'string' && model) current.model = model
      current.at = Date.now()
      pendingUsage.set(key, current)
      return
    }
    flushUsage(sessionId, turn)
    if (type === 'turn/end') queueBalanceRefresh()
  } catch {
    // 记账失败不影响会话
  }
}

let balanceRefreshTimer = null
let balanceRefreshing = false
let lastAutoBalanceAt = 0

/** 一轮对话结束后自动刷新余额：3 秒去抖、20 秒节流，失败只记一条 warn。 */
function queueBalanceRefresh() {
  if (balanceRefreshTimer) clearTimeout(balanceRefreshTimer)
  balanceRefreshTimer = setTimeout(() => {
    balanceRefreshTimer = null
    runAutoBalanceRefresh()
  }, 3000)
  if (balanceRefreshTimer.unref) balanceRefreshTimer.unref()
}

async function runAutoBalanceRefresh() {
  if (balanceRefreshing) return
  const now = Date.now()
  if (now - lastAutoBalanceAt < 20000) return
  const ctx = hostCtx
  if (!ctx) return
  balanceRefreshing = true
  lastAutoBalanceAt = now
  try {
    await refreshBalance(ctx, 'auto')
  } catch {
    // refreshBalance 内部已记录错误
  } finally {
    balanceRefreshing = false
  }
}

function listWorkspaces(ctx) {
  try {
    const registry = ctx.get('workspaceRegistry')
    if (!registry || typeof registry.list !== 'function') return []
    return registry.list().map((workspace) => ({
      id: workspace.id,
      path: workspace.path,
      title: workspace.title,
      sessions: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
    }))
  } catch {
    return []
  }
}

function ledgerSummary() {
  const entries = Array.isArray(state.ledger.entries) ? state.ledger.entries : []
  const todayKey = beijingDateKey(Date.now())
  const dayMap = new Map()
  let totalCny = 0
  let totalTokens = 0
  let todayCny = 0
  let todayTokens = 0
  let todayTurns = 0
  for (const entry of entries) {
    const at = Date.parse(entry.at)
    if (!Number.isFinite(at)) continue
    const key = beijingDateKey(at)
    const bucket = dayMap.get(key) || { date: key, cny: 0, tokens: 0, turns: 0 }
    const tokens = Number(entry.inputTokens || 0) + Number(entry.cacheTokens || 0) + Number(entry.outputTokens || 0)
    bucket.cny += Number(entry.cny || 0)
    bucket.tokens += tokens
    bucket.turns += 1
    dayMap.set(key, bucket)
    totalCny += Number(entry.cny || 0)
    totalTokens += tokens
    if (key === todayKey) {
      todayCny += Number(entry.cny || 0)
      todayTokens += tokens
      todayTurns += 1
    }
  }
  const days = []
  for (let i = 6; i >= 0; i -= 1) {
    const key = beijingDateKey(Date.now() - i * 86400000)
    const bucket = dayMap.get(key) || { date: key, cny: 0, tokens: 0, turns: 0 }
    days.push({ date: key, label: key.slice(5).replace('-', '/'), cny: Number(bucket.cny.toFixed(4)), tokens: bucket.tokens, turns: bucket.turns })
  }
  return {
    todayCny: Number(todayCny.toFixed(4)),
    todayTokens,
    todayTurns,
    totalCny: Number(totalCny.toFixed(4)),
    totalTokens,
    entries: entries.length,
    days,
  }
}

async function modelCatalog(ctx) {
  const controller = ctx.get('sessionController')
  if (!controller) return { groups: [], failures: [] }
  try {
    return await controller.modelCatalog()
  } catch (error) {
    log('warn', `模型目录读取失败：${error instanceof Error ? error.message : String(error)}`)
    return { groups: [], failures: [] }
  }
}

async function applyPreset(ctx, sessionId, presetName) {
  if (!presetName) return
  const presets = ctx.get('permissionPresets')
  if (!presets) {
    log('warn', '权限预设服务不可用，跳过权限设置')
    return
  }
  const controller = ctx.get('sessionController')
  let agent = ctx.get('agents')?.get?.(sessionId)
  if (!agent && controller?.resolveAgent) agent = await controller.resolveAgent(sessionId)
  if (!agent) throw new Error('会话尚未就绪，无法设置权限')
  const approval = ctx.get('approval')
  await presets.apply(agent.session, presetName, (policy) => {
    if (approval) approval.setPolicy(agent, policy)
  })
  log('info', `会话 ${sessionId.slice(0, 8)} 权限设为 ${presetName}`)
}

const TEXT_ATTACHMENT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.sh', '.bash', '.zsh', '.ps1', '.sql', '.html', '.htm', '.css', '.scss', '.less', '.vue', '.xml', '.srt', '.vtt'
])

function isTextAttachment(att) {
  const mediaType = typeof att.mediaType === 'string' ? att.mediaType.toLowerCase() : ''
  if (mediaType.startsWith('text/')) return true
  if (mediaType === 'application/json' || mediaType === 'application/xml' || mediaType === 'application/yaml') return true
  const name = typeof att.name === 'string' ? att.name.toLowerCase() : ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 && TEXT_ATTACHMENT_EXT.has(name.slice(dot))
}

async function buildContent(ctx, task, sessionId) {
  const content = []
  const text = typeof task.content === 'string' ? task.content.trim() : ''
  const uploads = ctx.get('fileUploads')
  const attachments = Array.isArray(task.attachments) ? task.attachments : []
  const inlineParts = []
  let attached = 0
  let skipped = 0
  for (const att of attachments) {
    if (!att || typeof att.path !== 'string') continue
    const name = typeof att.name === 'string' && att.name ? att.name : path.basename(att.path)
    if (isTextAttachment(att)) {
      try {
        const raw = await fsp.readFile(att.path, 'utf8')
        const clipped = raw.length > 200000 ? raw.slice(0, 200000) + '\n…（内容过长，已截断）' : raw
        inlineParts.push(`【附件：${name}】\n${clipped}`)
        attached += 1
      } catch (error) {
        skipped += 1
        log('warn', `附件读取失败（${name}）：${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    const mediaType = typeof att.mediaType === 'string' ? att.mediaType : ''
    if (mediaType.startsWith('image/') && uploads) {
      try {
        const bytes = await fsp.readFile(att.path)
        async function* chunks() {
          yield new Uint8Array(bytes)
        }
        const receipt = await uploads.uploadImageStream({ sessionId, data: chunks(), mediaType, name })
        if (receipt?.receiptId) {
          content.push({ type: 'file', receiptId: receipt.receiptId })
          attached += 1
        } else {
          skipped += 1
        }
      } catch (error) {
        skipped += 1
        log('warn', `附件上传失败（${name}）：${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    skipped += 1
    log('warn', `附件类型暂不支持（${name}）`)
  }
  const body = inlineParts.length ? [text, ...inlineParts].filter(Boolean).join('\n\n') : text
  if (body) content.push({ type: 'text', text: body })
  if (attachments.length > 0 && attached === 0) {
    throw new Error(skipped > 0 ? '附件未能随消息发送（见运行日志）' : '附件未能随消息发送')
  }
  return content
}

async function executeTask(ctx, task) {
  const controller = ctx.get('sessionController')
  if (!controller) throw new Error('sessionController 不可用')

  let sessionId = task.sessionId || ''

  if (task.kind === 'new') {
    const created = await controller.create({ cwd: task.cwd || undefined })
    sessionId = created?.sessionId || sessionId
    if (!sessionId) throw new Error('新建会话失败')
    task.sessionId = sessionId
    if (task.title) {
      try {
        await controller.rename({ sessionId, title: task.title })
      } catch {
        // 标题失败不影响发送
      }
    }
    await applyPreset(ctx, sessionId, task.preset)
    if (task.provider && task.model) {
      await controller.selectModel({
        sessionId,
        provider: task.provider,
        model: task.model,
        ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
      })
    }
  } else {
    if (!sessionId) throw new Error('未指定目标会话')
    await controller.resolveAgent(sessionId)
    if (task.preset) await applyPreset(ctx, sessionId, task.preset)
    if (task.provider && task.model) {
      await controller.selectModel({
        sessionId,
        provider: task.provider,
        model: task.model,
        ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
      })
    }
  }

  const content = await buildContent(ctx, task, sessionId)
  if (content.length === 0) throw new Error('内容为空：没有文本也没有附件')

  if (!task.requestId) task.requestId = randomUUID()
  const abort = new AbortController()
  await controller.prompt({ sessionId, content, requestId: task.requestId }, abort.signal)

  task.status = 'done'
  task.sentAt = isoNow()
  task.updatedAt = isoNow()
  task.error = null
  log('info', `任务「${task.title || task.id.slice(0, 6)}」已发送到会话 ${sessionId.slice(0, 8)}`)
}

function taskDue(task, nowMs) {
  if (task.status !== 'queued') return false
  const notBefore = task.notBefore ? Date.parse(task.notBefore) : 0
  if (Number.isFinite(notBefore) && nowMs < notBefore) return false
  const runAt = task.runAt ? Date.parse(task.runAt) : NaN
  if (Number.isFinite(runAt) && nowMs < runAt) return false
  const peakNow = isPeakAt(nowMs, state.pricing)
  if (task.mode === 'at' && task.at) {
    const at = Date.parse(task.at)
    if (!Number.isFinite(at)) return false
    if (nowMs < at) return false
    if (state.config.peakPolicy === 'defer' && peakNow) return false
    return true
  }
  // 'next-offpeak'：一旦进入谷价就执行；若用户选择 run，则忽略峰时立即执行
  if (state.config.peakPolicy === 'defer' && peakNow) return false
  return true
}

async function balanceGatePass(ctx) {
  if (!state.config.balanceGate) return true
  const balance = state.balance
  const stale = !balance?.at || Date.now() - Date.parse(balance.at) > 5 * 60 * 1000
  if (stale) await refreshBalance(ctx, 'pre-task')
  const current = state.balance
  if (current && current.ok && current.total !== null) {
    const threshold = Number(state.config.balanceThreshold)
    if (Number.isFinite(threshold) && current.total < threshold) {
      triggerAlarm('余额低于阈值，任务已暂停')
      await saveState()
      return false
    }
  }
  return true
}

async function tick(ctx) {
  if (!state.config.enabled) return
  if (state.runtime.runningTaskId) return
  if (state.runtime.pausedByBalance) return
  const now = Date.now()
  const due = state.tasks
    .filter((task) => taskDue(task, now))
    .sort((a, b) => Date.parse(a.notBefore || a.createdAt || 0) - Date.parse(b.notBefore || b.createdAt || 0))
  if (due.length === 0) return
  const task = due[0]
  if (!(await balanceGatePass(ctx))) return
  state.runtime.runningTaskId = task.id
  task.status = 'running'
  task.updatedAt = isoNow()
  await saveState()
  try {
    await executeTask(ctx, task)
    task.failCount = 0
  } catch (error) {
    task.failCount = Number(task.failCount || 0) + 1
    task.error = error instanceof Error ? error.message : String(error)
    task.updatedAt = isoNow()
    if (task.failCount >= 2) {
      task.status = 'failed'
      log('error', `任务「${task.title || task.id.slice(0, 6)}」失败：${task.error}`)
    } else {
      task.status = 'queued'
      task.notBefore = new Date(Date.now() + 60 * 1000).toISOString()
      log('warn', `任务「${task.title || task.id.slice(0, 6)}」失败，1 分钟后重试：${task.error}`)
    }
  } finally {
    state.runtime.runningTaskId = null
    await saveState()
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true
  return /\.localhost$/.test(host)
}

function isTrustedRequest(ctx, req) {
  if (!isLoopbackHost(req.headers.host)) return false
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      if (new URL(origin).host !== req.headers.host) return false
    } catch {
      return false
    }
  }
  const connection = ctx.get('connection')
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req)
      if (typeof rejection === 'number') return rejection === 0 ? true : false
      if (rejection === false) return false
    } catch {
      return false
    }
  }
  return true
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req, limit = 32 * 1024 * 1024) {
  const body = await readBody(req, limit)
  if (body.length === 0) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    const error = new Error('请求体不是合法 JSON')
    error.statusCode = 400
    throw error
  }
}

function safeFileName(name) {
  const base = String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(-80)
  const ext = path.extname(base).slice(0, 12)
  const stem = path.basename(base, ext).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 60) || 'file'
  return `${stem}${ext}`
}

async function stateSnapshot(ctx) {
  const now = Date.now()
  const offPeak = nextOffPeakAt(now)
  const peak = nextPeakAt(now)
  const isPeakNow = isPeakAt(now, state.pricing)
  const catalog = await modelCatalog(ctx)
  let presets = { options: [], defaultPreset: '' }
  try {
    const service = ctx.get('permissionPresets')
    if (service && typeof service.catalog === 'function') presets = service.catalog()
  } catch {
    // 权限预设不可用时留空
  }
  return {
    ok: true,
    now,
    panelId: PACKAGE,
    config: state.config,
    runtime: state.runtime,
    peak: {
      isPeak: isPeakNow,
      nextOffPeakAt: offPeak,
      nextOffPeakLabel: isPeakNow ? `${fmtDateTime(offPeak)}（${fmtClock(offPeak)}）` : '现在就是谷价',
      nextPeakAt: peak,
      nextPeakLabel: peak ? `${fmtDateTime(peak)}（${fmtClock(peak)}）` : '—',
      windowsUtc: state.pricing.windows,
      windowsLocal: localWindows(),
      weekdays: state.pricing.weekdays,
    },
    pricing: {
      fetchedAt: state.pricing.fetchedAt,
      online: state.pricing.online,
      note: state.pricing.note,
      windows: state.pricing.windows,
      models: state.pricing.models,
      offPeakMultiplier: state.pricing.offPeakMultiplier,
    },
    balance: state.balance,
    ledger: ledgerSummary(),
    workspaces: listWorkspaces(ctx),
    tasks: state.tasks,
    sessions: await listSessions(ctx),
    catalog,
    presets,
    logs: state.logs.slice(-50),
    alarm: state.alarm,
    sound: {
      enabled: state.config.soundEnabled !== false,
      slots: {
        balance: soundSlotInfo('balance'),
        valley: soundSlotInfo('valley'),
        peak: soundSlotInfo('peak'),
      },
    },
    phaseEvent: state.runtime.phaseEvent || null,
    holiday: {
      years: Object.keys(state.runtime.holidayFetched || {}).sort(),
      error: state.runtime.holidayError || null,
    },
  }
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.flac') return 'audio/flac'
  return 'application/octet-stream'
}

function taskFromInput(input) {
  const now = isoNow()
  const id = typeof input.id === 'string' && input.id ? input.id : randomUUID()
  const existing = state.tasks.find((task) => task.id === id)
  const mode = input.mode === 'at' ? 'at' : 'next-offpeak'
  const content = typeof input.content === 'string' ? input.content : typeof input.prompt === 'string' ? input.prompt : typeof input.text === 'string' ? input.text : ''
  const explicitTitle = typeof input.title === 'string' ? input.title.trim() : ''
  const derivedTitle = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) || ''
  const task = {
    id,
    kind: input.kind === 'existing' ? 'existing' : 'new',
    title: (explicitTitle || derivedTitle).slice(0, 120),
    content,
    attachments: Array.isArray(input.attachments)
      ? input.attachments
          .filter((a) => a && typeof a.path === 'string')
          .slice(0, 8)
          .map((a) => ({
            name: String(a.name || path.basename(a.path)),
            path: String(a.path),
            mediaType: String(a.mediaType || ''),
            bytes: Number(a.bytes || 0),
          }))
      : [],
    mode,
    at: mode === 'at' && typeof input.at === 'string' ? input.at : null,
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    provider: typeof input.provider === 'string' ? input.provider : '',
    model: typeof input.model === 'string' ? input.model : '',
    reasoningEffort: typeof input.reasoningEffort === 'string' ? input.reasoningEffort : '',
    preset: typeof input.preset === 'string' ? input.preset : '',
    status: 'queued',
    error: null,
    failCount: 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    notBefore: now,
    runAt: mode === 'at' && typeof input.at === 'string' ? new Date(Date.parse(input.at)).toISOString() : new Date(valleyRunAt(Date.now())).toISOString(),
    requestId: randomUUID(),
    sentAt: null,
  }
  if (existing) {
    if (existing.status === 'done') task.status = 'queued'
    if (existing.requestId && existing.status !== 'done') task.requestId = existing.requestId
    state.tasks = state.tasks.map((item) => (item.id === id ? task : item))
  } else {
    state.tasks.push(task)
  }
  return task
}

async function handleApi(ctx, req, res, pathname) {
  if (pathname === `${API}/state.json`) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return sendJson(res, 200, await stateSnapshot(ctx))
  }

  if (pathname === `${API}/task.json`) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJson(req)
    const op = String(body.op || 'save')
    if (op === 'delete') {
      const id = String(body.id || '')
      state.tasks = state.tasks.filter((task) => task.id !== id)
      log('info', '已删除任务')
    } else if (op === 'run') {
      const id = String(body.id || '')
      const task = state.tasks.find((item) => item.id === id)
      if (!task) return sendJson(res, 404, { ok: false, error: '任务不存在' })
      if (task) {
        task.status = 'queued'
        task.notBefore = isoNow()
        task.updatedAt = isoNow()
        task.requestId = randomUUID()
        log('info', `任务「${task.title || id.slice(0, 6)}」已手动入队`)
      }
    } else if (op === 'cancel') {
      const task = state.tasks.find((item) => item.id === String(body.id || ''))
      if (!task) return sendJson(res, 404, { ok: false, error: '任务不存在' })
      if (task && task.status === 'queued') {
        task.status = 'canceled'
        task.updatedAt = isoNow()
      }
    } else {
      const input = { ...(body.task || {}), ...(body.id ? { id: body.id } : {}) }
      const problem = taskValidationError(input)
      if (problem) return sendJson(res, 400, { ok: false, error: problem })
      taskFromInput(input)
    }
    await saveState()
    return sendJson(res, 200, { ok: true, tasks: state.tasks })
  }

  if (pathname === `${API}/config.json`) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJson(req)
    const patch = body.config && typeof body.config === 'object' ? body.config : {}
    const soundKey = (kind) => 'sound' + String(kind).charAt(0).toUpperCase() + String(kind).slice(1)
    if (typeof patch.soundFileBase64 === 'string' && patch.soundFileBase64) {
      const kind = SOUND_KINDS.includes(patch.soundKind) ? patch.soundKind : 'balance'
      try {
        const data = Buffer.from(patch.soundFileBase64, 'base64')
        if (data.length === 0) return sendJson(res, 400, { ok: false, error: '声音文件为空' })
        if (data.length > 10 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: '声音文件超过 10MB' })
        const original = String(patch.soundFileName || 'sound.mp3')
        const ext = path.extname(original).toLowerCase() || '.mp3'
        await fsp.mkdir(STATE_DIR, { recursive: true })
        const target = path.join(STATE_DIR, `sound-${kind}-` + safeFileName(path.basename(original, path.extname(original))) + ext)
        await fsp.writeFile(target, data)
        patch[soundKey(kind)] = target
        log('info', `提示音已导入（${kind}）：` + path.basename(original))
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: '保存声音文件失败：' + (error instanceof Error ? error.message : String(error)) })
      }
      delete patch.soundFileBase64
      delete patch.soundFileName
      delete patch.soundKind
    }
    if (patch.soundFilePath && typeof patch.soundFilePath === 'string' && patch.soundFilePath.trim()) {
      const kind = SOUND_KINDS.includes(patch.soundKind) ? patch.soundKind : 'balance'
      const source = patch.soundFilePath.trim()
      try {
        const data = await fsp.readFile(source)
        await fsp.mkdir(STATE_DIR, { recursive: true })
        const ext = path.extname(source).toLowerCase() || '.mp3'
        const target = path.join(STATE_DIR, `sound-${kind}-` + safeFileName(path.basename(source, path.extname(source))) + ext)
        await fsp.writeFile(target, data)
        patch[soundKey(kind)] = target
        log('info', `提示音已导入（${kind}）：` + path.basename(source))
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: '读取声音文件失败：' + (error instanceof Error ? error.message : String(error)) })
      }
      delete patch.soundFilePath
      delete patch.soundKind
    }
    if (patch.resetSound === true) {
      for (const kind of SOUND_KINDS) patch[soundKey(kind)] = ''
      patch.soundFile = ''
      log('info', '提示音已全部恢复为插件内置声音')
      delete patch.resetSound
    } else if (typeof patch.resetSoundKind === 'string' && SOUND_KINDS.includes(patch.resetSoundKind)) {
      patch[soundKey(patch.resetSoundKind)] = ''
      log('info', `提示音已恢复为插件内置（${patch.resetSoundKind}）`)
      delete patch.resetSoundKind
    }
    if (typeof patch.soundFilePath === 'string' && patch.soundFilePath.trim()) {
      const source = patch.soundFilePath.trim()
      try {
        const data = await fsp.readFile(source)
        await fsp.mkdir(STATE_DIR, { recursive: true })
        const ext = path.extname(source).toLowerCase() || '.mp3'
        const target = path.join(STATE_DIR, 'sound-' + safeFileName(path.basename(source, path.extname(source))) + ext)
        await fsp.writeFile(target, data)
        patch.soundFile = target
        log('info', '提示音已导入：' + path.basename(source))
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: '读取声音文件失败：' + (error instanceof Error ? error.message : String(error)) })
      }
    }
    delete patch.soundFilePath
    delete patch.resetSound
    const sanitized = sanitizeConfigPatch(pruneConfig(patch))
    Object.assign(state.config, sanitized.clean)
    await saveState()
    return sendJson(res, 200, { ok: true, config: state.config, warnings: sanitized.warnings, state: await stateSnapshot(ctx) })
  }

  if (pathname === `${API}/refresh.json`) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJson(req)
    const what = String(body.what || 'all')
    if (what === 'pricing' || what === 'all') await refreshPricing()
    if (what === 'balance' || what === 'all') await refreshBalance(ctx, 'manual')
    if (what === 'sessions' || what === 'all') await listSessions(ctx, true)
    return sendJson(res, 200, await stateSnapshot(ctx))
  }

  if (pathname === `${API}/ack.json`) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJson(req)
    if (String(body.what || 'alarm') === 'alarm') {
      state.alarm = null
      state.runtime.pausedByBalance = false
      log('info', '用户确认了余额告警，队列恢复运行')
    }
    if (body.resume === true) state.runtime.pausedByBalance = false
    await saveState()
    return sendJson(res, 200, await stateSnapshot(ctx))
  }

  if (pathname === `${API}/upload.json`) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    const body = await readJson(req)
    const name = safeFileName(body.name)
    const dataBase64 = String(body.dataBase64 || body.data || '')
    if (!dataBase64) return sendJson(res, 400, { ok: false, error: '缺少文件内容' })
    const buffer = Buffer.from(dataBase64, 'base64')
    if (buffer.length === 0) return sendJson(res, 400, { ok: false, error: '文件内容为空' })
    if (buffer.length > 30 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: '文件超过 30MB' })
    const mediaType = String(body.mediaType || '')
    const ext = path.extname(name).toLowerCase()
    const allowed = mediaType.startsWith('image/') || mediaType.startsWith('text/') || mediaType === 'application/json'
      || IMAGE_EXTS.has(ext) || TEXT_EXTS.has(ext)
    if (!allowed) return sendJson(res, 400, { ok: false, error: '只支持图片与文本类文件' })
    await fsp.mkdir(UPLOAD_DIR, { recursive: true })
    const target = path.join(UPLOAD_DIR, `${Date.now()}-${randomUUID().slice(0, 8)}-${name}`)
    await fsp.writeFile(target, buffer)
    const attachment = {
      name,
      path: target,
      mediaType: String(body.mediaType || ''),
      bytes: buffer.length,
    }
    return sendJson(res, 200, { ok: true, file: attachment, attachment })
  }

  if (pathname === `${API}/sound`) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    let kind = 'balance'
    try {
      kind = new URL(req.url || '', 'http://127.0.0.1').searchParams.get('kind') || 'balance'
    } catch {
      kind = 'balance'
    }
    const file = resolveSoundFile(kind)
    if (!file) return sendJson(res, 404, { ok: false, error: '未配置提示音' })
    const data = await fsp.readFile(file)
    res.writeHead(200, {
      'content-type': contentTypeFor(file),
      'cache-control': 'no-store',
      'content-length': data.length,
    })
    res.end(data)
    return
  }

  return sendJson(res, 404, { ok: false, error: 'not found' })
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export default {
  name: PACKAGE,
  apply(root) {
    root.inject(['webServer'], (ctx) => {
      hostCtx = ctx
      const boot = (async () => {
        state = await loadState()
        log('info', '梁文谷插件已启动')
        const webServer = ctx.get('webServer')
        if (!webServer) {
          log('error', 'webServer 服务不可用，面板无法取数')
          return
        }
        const registerRoute = (pathname, handler) => {
          const route = webServer.register({
            kind: 'exact',
            path: pathname,
            handler: (req, res) => {
              if (!isTrustedRequest(ctx, req)) {
                sendJson(res, 403, { ok: false, error: 'forbidden' })
                return
              }
              Promise.resolve(handler(req, res)).catch((error) => {
                try {
                  const code = error && Number.isInteger(error.statusCode) ? error.statusCode : 500
                  sendJson(res, code, { ok: false, error: error instanceof Error ? error.message : String(error) })
                } catch {
                  // 响应已结束
                }
              })
            },
          })
          return route
        }

        const pendings = [
          registerRoute(`${API}/state.json`, (req, res) => handleApi(ctx, req, res, `${API}/state.json`)),
          registerRoute(`${API}/task.json`, (req, res) => handleApi(ctx, req, res, `${API}/task.json`)),
          registerRoute(`${API}/config.json`, (req, res) => handleApi(ctx, req, res, `${API}/config.json`)),
          registerRoute(`${API}/refresh.json`, (req, res) => handleApi(ctx, req, res, `${API}/refresh.json`)),
          registerRoute(`${API}/ack.json`, (req, res) => handleApi(ctx, req, res, `${API}/ack.json`)),
          registerRoute(`${API}/upload.json`, (req, res) => handleApi(ctx, req, res, `${API}/upload.json`)),
          registerRoute(`${API}/sound`, (req, res) => handleApi(ctx, req, res, `${API}/sound`)),
        ]

        ctx.effect(() => () => {
          for (const dispose of pendings) {
            try {
              if (typeof dispose === 'function') dispose()
              else if (dispose && typeof dispose.dispose === 'function') dispose.dispose()
            } catch {
              // 忽略
            }
          }
        }, 'dsh-liangwengu: http routes')

        // 记账本：监听会话用量事件
        try {
          const offEvent = ctx.on('session/event', handleSessionEvent)
          ctx.effect(() => () => {
            try {
              if (typeof offEvent === 'function') offEvent()
            } catch {
              // 忽略
            }
          }, 'dsh-liangwengu: ledger events')
        } catch (error) {
          log('warn', `记账本事件监听失败：${error instanceof Error ? error.message : String(error)}`)
        }

        // 定时器：调度 + 定价/余额周期刷新
        trackPhase()
        const timer = setInterval(() => {
          trackPhase()
          tick(ctx).catch((error) => log('error', `调度失败：${error instanceof Error ? error.message : String(error)}`))
        }, 15000)
        ctx.effect(() => () => clearInterval(timer), 'dsh-liangwengu: scheduler')

        // 启动时的定价抓取
        if (state.config.pricingRefresh === 'startup' || state.config.pricingRefresh === 'daily' || state.config.pricingRefresh === 'weekly') {
          refreshPricing().catch(() => {})
        }
        if (state.config.balanceGate) {
          refreshBalance(ctx, 'startup').catch(() => {})
        }
        ensureHolidays().catch(() => {})
        saveState()
      })().catch((error) => {
        console.error(`[${PACKAGE}] 启动失败`, error)
      })
      void boot
    })
  },
}
