/**
 * 梁文谷 · DSH 谷价调度器 —— 浏览器半侧
 *
 * 侧边栏注册「梁文谷」入口，主面板分四个标签页：
 *  新建会话 / 历史会话 / 记账本 / 设置
 * 面板只负责取数与交互，真正的调度、抓价、余额与记账都在宿主半侧完成。
 * 视觉遵循 DSH Web UI 设计规范（--dsw-* 令牌、六级圆角、控件高度）。
 */
window.__ModuleLoader__.load({
  id: "dsh-liangwengu",
  factory: (require) => {
    "use strict";
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;

    const PANEL_ID = "dsh-liangwengu";
    const API = "/dsh-liangwengu";
    const POLL_MS = 5000;

    /** 播放某一类提示音；音量 0-100。返回 play() 的 Promise。 */
    function playSoundKind(kind, volume) {
      const audio = new Audio(`${API}/sound?kind=${kind}&t=${Date.now()}`);
      const value = Number(volume);
      audio.volume = Math.min(1, Math.max(0, (Number.isFinite(value) ? value : 80) / 100));
      const played = audio.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
      return played;
    }

    // -----------------------------------------------------------------------
    // 多语言
    // -----------------------------------------------------------------------

    const DICT = {
      zh: {
        panel: "梁文谷",
        sub: "谷价调度器",
        tabNew: "新建会话",
        tabHistory: "历史会话",
        tabLedger: "记账本",
        tabSettings: "设置",
        todayUsed: "今日已用",
        balance: "余额",
        refresh: "刷新",
        querying: "查询中…",
        failed: "查询失败",
        alarmBelow: "低于阈值 已暂停队列",
        resumeQueue: "恢复队列",
        valley: "谷",
        peak: "峰",
        // 编辑器
        titlePlaceholder: "任务名称（可选，仅本地面板显示）",
        targetSession: "目标会话",
        noSession: "没有可选会话",
        phNew: "写要发送的指令…",
        phExisting: "写要追加发送到该会话的内容…",
        attach: "添加附件（图片或文本）",
        attachCount: (n) => `附件 ${n}`,
        attachOnly: (name) => `只支持图片与文本类文件：${name}`,
        remove: "移除附件",
        preset: "权限",
        effort: "推理等级",
        effortDefault: "默认",
        model: "模型",
        noModel: "（无可用模型）",
        modeNext: "谷价开始后 10 秒再执行",
        modeAt: "指定时间执行",
        cwdPlaceholder: "工作目录（留空使用 DSH 默认工作区）",
        hint: "Ctrl/⌘ + Enter 快速入队；切到别的标签，草稿会保留",
        send: "加入队列",
        sending: "提交中…",
        queued: "已加入队列，将在谷价窗口自动发送",
        needContent: "先写点指令内容",
        needSession: "先在历史会话里选中一个会话",
        // 权限
        pRead: "仅可查看",
        pWrite: "工作区内修改",
        pFull: "完全权限",
        pReview: "自动审查",
        reviewLocked: "需在 DSH 中开启「自动审查」实验功能",
        exp: "EXP",
        // 推理等级
        eOff: "关闭",
        eMinimal: "最低",
        eLow: "低",
        eMedium: "中",
        eHigh: "高",
        eXHigh: "很高",
        eMax: "最高",
        // 任务
        stQueued: "排队中",
        stRunning: "发送中",
        stDone: "已发送",
        stFailed: "失败",
        stCanceled: "已取消",
        actRun: "立即发送",
        actCancel: "取消",
        actDelete: "删除",
        queueNew: "谷价队列 · 新建会话",
        queueHistory: "谷价队列 · 已有会话",
        emptyNew: "还没有排队的新会话任务。",
        emptyHistory: "还没有排队的历史会话任务。",
        timed: (value) => `定时 ${value}`,
        aboutMinutes: (value) => `约 ${value} 分钟后`,
        // 记账本
        ledgerTitle: "本机模型费用",
        mTotal: "本机累计",
        mToday: "今日",
        mTokens: "累计 tokens",
        mTurns: "记录轮次",
        ledgerDisclaimer:
          "仅为估算：按官方人民币定价（元 / 百万 tokens）计算，未计入账号折扣、赠送额度抵扣、Search/Fetch 调用与缓存命中差异，实际账单请以 DeepSeek 官方为准。",
        last7: "近 7 天使用记录",
        refreshLedger: "刷新记录",
        // 设置
        display: "显示",
        themeMode: "显示模式",
        themeAuto: "跟随 DSH",
        themeLight: "浅色",
        themeDark: "深色",
        themeHint: "「跟随 DSH」会读取 DSH 当前的深浅色设置",
        language: "语言 / Language",
        langAuto: "跟随 DSH",
        langZh: "中文",
        langEn: "English",
        langHint: "切换后立即生效，默认跟随 DSH 的界面语言",
        schedule: "调度",
        master: "总开关",
        masterHint: "关闭后不再自动发送任何内容",
        masterOnHint: "插件功能全量开启",
        masterOffHint: "队列已暂停",
        peakPolicy: "峰时策略",
        peakPolicyHint: "峰时到点的任务怎么处理",
        peakDefer: "顺延到下一个谷价窗口（省 token）",
        peakRun: "立即发送（不省 token）",
        concurrency: "任务执行方式",
        concurrencyHint: "到点有多个任务时怎么发送",
        concSerial: "串行：上一个任务完成后再发下一个",
        concParallel: "并行：到点全部发出",
        pricing: "峰谷定价",
        lastFetch: "最近抓取",
        autoFetch: "自动抓取频率",
        fetchOff: "不自动抓取",
        fetchStartup: "每次 DSH 启动时",
        fetchDaily: "每天一次",
        fetchWeekly: "每周一次",
        fetchNow: "立即抓取",
        fetching: "抓取中…",
        priceRef: "价格参考（每 100 万 tokens，元）",
        peakBeijing: "峰时（北京时间）",
        fetchStatus: "抓取状态",
        online: "在线（官方定价页）",
        offline: "离线（使用缓存参考价）",
        colModel: "模型",
        colHit: "缓存命中",
        colMiss: "缓存未命中",
        colOut: "输出",
        balanceTitle: "余额提醒",
        balanceGate: "余额闸门",
        alarmEvery: "低余额暂停频率",
        alarmEveryHint: "低于阈值时，多久触发一次暂停与提醒",
        alarmStartup: "每次启动 DSH 只触发一次",
        alarm1h: "每小时一次",
        alarm2h: "每 2 小时一次",
        alarm6h: "每 6 小时一次",
        alarm12h: "每 12 小时一次",
        alarm24h: "每 24 小时一次",
        balanceGateHint: "低于阈值将暂停队列，已发送指令不受影响",
        threshold: "阈值",
        yuan: "元",
        balanceFreq: "查询频率",
        every: (n) => `每 ${n} 分钟`,
        queryNow: "立即查询",
        restore: "恢复队列",
        sound: "提示音",
        soundSwitch: "提示音开关",
        soundBalance: "余额告警",
        soundValley: "谷价提醒",
        soundPeak: "峰价提醒",
        resetDefault: "恢复默认",
        noSoundFile: "未找到声音文件",
        builtin: (name) => `内置：${name}`,
        preview: "播放",
        imported: (label, name) => `已导入${label}：${name}`,
        restored: (label) => `${label}已恢复内置声音`,
        playFailed: "播放失败：浏览器拦截了自动播放，或音频不可用",
        soundTooBig: "声音文件超过 10MB",
        soundPick: "选择音频文件（会复制到插件数据目录）",
        logs: "运行日志",
        feedbackIssue: "提交 Issue",
        copyDiag: "复制诊断信息",
        diagCopied: "诊断信息已复制",
        copyFailed: "复制失败，已展开文本可手动复制",
        copyManual: "上次反馈已保存在本机，可编辑后复制（Ctrl/⌘ + C）",
        draftClear: "清除草稿",
        feedbackSubject: "反馈",
        issueBlocked: "浏览器拦截了弹窗，已把内容存入草稿，可复制后手动到 GitHub 提交",
        refreshOk: (value) => `刷新成功：余额 ${value}`,
        refreshOkShort: "刷新成功",
        balanceChecking: "查询中…",
        refreshBad: (value) => `刷新出错：${value}`,
        pricingOk: "刷新成功：定价时段已更新",
        pricingBad: "刷新出错：没能从官方定价页解析出时段",
        holidayFailed: "节假日抓取失败",
        resumed: "已恢复队列",
        prevMonth: "上个月",
        nextMonth: "下个月",
        today: "今天",
        close: "关闭",
        monthTitle: (y, m) => `${y} 年 ${m} 月`,
        dateLabel: (m, d) => `${m}月${d}日`,
        weekdays: ["一", "二", "三", "四", "五", "六", "日"],
      },
      en: {
        panel: "Liangwengu",
        sub: "Off-peak scheduler",
        tabNew: "New chat",
        tabHistory: "History",
        tabLedger: "Ledger",
        tabSettings: "Settings",
        todayUsed: "Today",
        balance: "Balance",
        refresh: "Refresh",
        querying: "Checking…",
        failed: "Unavailable",
        alarmBelow: "Below threshold · queue paused",
        resumeQueue: "Resume queue",
        valley: "Off",
        peak: "Peak",
        titlePlaceholder: "Task name (optional, local only)",
        targetSession: "Target chat",
        noSession: "No chat available",
        phNew: "Write the instruction to send…",
        phExisting: "Write what to append to this chat…",
        attach: "Attach image or text file",
        attachCount: (n) => `${n} file${n > 1 ? "s" : ""}`,
        attachOnly: (name) => `Only images and text files: ${name}`,
        remove: "Remove attachment",
        preset: "Permission",
        effort: "Effort",
        effortDefault: "Default",
        model: "Model",
        noModel: "(no model)",
        modeNext: "Run 10s after off-peak starts",
        modeAt: "Run at a specific time",
        cwdPlaceholder: "Working directory (empty = DSH default)",
        hint: "Ctrl/⌘ + Enter to queue; drafts survive tab switches",
        send: "Queue",
        sending: "Submitting…",
        queued: "Queued — will send in the next off-peak window",
        needContent: "Write an instruction first",
        needSession: "Pick a chat in History first",
        pRead: "Read only",
        pWrite: "Workspace write",
        pFull: "Full access",
        pReview: "Auto review",
        reviewLocked: "Enable the Auto review experiment in DSH first",
        exp: "EXP",
        eOff: "Off",
        eMinimal: "Minimal",
        eLow: "Low",
        eMedium: "Medium",
        eHigh: "High",
        eXHigh: "Very high",
        eMax: "Max",
        stQueued: "Queued",
        stRunning: "Sending",
        stDone: "Sent",
        stFailed: "Failed",
        stCanceled: "Canceled",
        actRun: "Send now",
        actCancel: "Cancel",
        actDelete: "Delete",
        queueNew: "Off-peak queue · new chat",
        queueHistory: "Off-peak queue · existing chat",
        emptyNew: "No new-chat task queued yet.",
        emptyHistory: "No existing-chat task queued yet.",
        timed: (value) => `At ${value}`,
        aboutMinutes: (value) => `in ~${value} min`,
        ledgerTitle: "Local model cost",
        mTotal: "All time",
        mToday: "Today",
        mTokens: "Tokens",
        mTurns: "Turns",
        ledgerDisclaimer:
          "Estimate only: priced with the official CNY rates (per 1M tokens). Account discounts, bonus credit, Search/Fetch calls and cache-hit differences are not included. The official DeepSeek bill prevails.",
        last7: "Last 7 days",
        refreshLedger: "Refresh",
        display: "Display",
        themeMode: "Appearance",
        themeAuto: "Follow DSH",
        themeLight: "Light",
        themeDark: "Dark",
        themeHint: "“Follow DSH” reads the current DSH light/dark setting",
        language: "Language / 语言",
        langAuto: "Follow DSH",
        langZh: "中文",
        langEn: "English",
        langHint: "Applies immediately; defaults to the DSH interface language",
        schedule: "Scheduling",
        master: "Master switch",
        masterHint: "When off, nothing is sent automatically",
        masterOnHint: "All features on",
        masterOffHint: "Queue paused",
        peakPolicy: "Peak-hour policy",
        peakPolicyHint: "What to do with tasks that land on peak hours",
        peakDefer: "Defer to the next off-peak window (save tokens)",
        peakRun: "Send immediately (no saving)",
        concurrency: "Task execution",
        concurrencyHint: "How multiple due tasks are dispatched",
        concSerial: "Serial: wait for the previous task to finish",
        concParallel: "Parallel: send all due tasks at once",
        pricing: "Off-peak pricing",
        lastFetch: "Last fetched",
        autoFetch: "Auto refresh",
        fetchOff: "Never",
        fetchStartup: "On every DSH start",
        fetchDaily: "Daily",
        fetchWeekly: "Weekly",
        fetchNow: "Fetch now",
        fetching: "Fetching…",
        priceRef: "Price reference (CNY per 1M tokens)",
        peakBeijing: "Peak hours (Beijing)",
        fetchStatus: "Status",
        online: "Online (official pricing page)",
        offline: "Offline (cached reference)",
        colModel: "Model",
        colHit: "Cache hit",
        colMiss: "Cache miss",
        colOut: "Output",
        balanceTitle: "Balance alerts",
        balanceGate: "Balance gate",
        alarmEvery: "Low-balance pause frequency",
        alarmEveryHint: "How often the pause and alert may trigger while below the threshold",
        alarmStartup: "Once per DSH launch",
        alarm1h: "Every hour",
        alarm2h: "Every 2 hours",
        alarm6h: "Every 6 hours",
        alarm12h: "Every 12 hours",
        alarm24h: "Every 24 hours",
        balanceGateHint: "Below the threshold the queue pauses; sent instructions are unaffected",
        threshold: "Threshold",
        yuan: "CNY",
        balanceFreq: "Check every",
        every: (n) => `Every ${n} min`,
        queryNow: "Check now",
        restore: "Resume queue",
        sound: "Sounds",
        soundSwitch: "Sound alerts",
        soundBalance: "Low balance",
        soundValley: "Off-peak start",
        soundPeak: "Peak start",
        resetDefault: "Reset",
        noSoundFile: "No sound file",
        builtin: (name) => `Built-in: ${name}`,
        preview: "Play",
        imported: (label, name) => `${label} imported: ${name}`,
        restored: (label) => `${label} restored to built-in sound`,
        playFailed: "Playback failed: autoplay blocked or audio unavailable",
        soundTooBig: "Sound file exceeds 10MB",
        soundPick: "Pick an audio file (copied into plugin data)",
        logs: "Run log",
        feedbackIssue: "Report issue",
        copyDiag: "Copy diagnostics",
        diagCopied: "Diagnostics copied",
        copyFailed: "Copy failed — select the text below",
        copyManual: "Last feedback was kept locally — edit and copy it (Ctrl/⌘ + C)",
        draftClear: "Clear draft",
        feedbackSubject: "feedback",
        issueBlocked: "Popup blocked — the text was saved as a draft; copy it and open GitHub manually",
        refreshOk: (value) => `Refreshed: balance ${value}`,
        refreshOkShort: "Refreshed",
        balanceChecking: "Checking…",
        refreshBad: (value) => `Refresh failed: ${value}`,
        pricingOk: "Refreshed: pricing windows updated",
        pricingBad: "Refresh failed: could not parse the official pricing page",
        holidayFailed: "Failed to fetch holidays",
        resumed: "Queue resumed",
        prevMonth: "Previous month",
        nextMonth: "Next month",
        today: "Today",
        close: "Close",
        monthTitle: (y, m) => `${y}-${String(m).padStart(2, "0")}`,
        dateLabel: (m, d) => `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`,
        weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
      },
    };

    function detectLang(config) {
      const mode = config && config.lang;
      if (mode === "zh" || mode === "en") return mode;
      const root = document.documentElement;
      const htmlLang = String(
        (root && root.lang) ||
        (root && (root.getAttribute("data-ds-locale") || root.getAttribute("data-locale"))) ||
        "",
      ).toLowerCase();
      const nav = String((navigator && (navigator.language || navigator.languages?.[0])) || "").toLowerCase();
      const raw = htmlLang || nav;
      return raw.startsWith("zh") ? "zh" : "en";
    }

    const EFFORT_KEYS = {
      off: "eOff", none: "eOff", minimal: "eMinimal", low: "eLow",
      medium: "eMedium", high: "eHigh", xhigh: "eXHigh", max: "eMax",
    };
    const PRESET_KEYS = {
      "read-only": "pRead",
      "workspace-write": "pWrite",
      "danger-full-access": "pFull",
    };

    function presetKeyOf(option) {
      const value = String((option && option.value) || "");
      const name = String((option && (option.name || option.label)) || "");
      if (value === "read-only" || /read[- ]?only|仅可查看|只读/i.test(name)) return "pRead";
      if (value === "workspace-write" || /workspace[- ]?write|工作区/i.test(name)) return "pWrite";
      if (value === "danger-full-access" || /full[- ]?access|完全权限/i.test(name)) return "pFull";
      if (/review|审查/i.test(value + name)) return "pReview";
      return "";
    }

    const PRESET_ICONS = {
      pRead: "shieldCheck",
      pWrite: "shieldEdit",
      pFull: "shieldAlert",
      pReview: "shieldStar",
    };

    // -----------------------------------------------------------------------
    // 工具
    // -----------------------------------------------------------------------

    async function api(path, init) {
      const res = await fetch(`${API}/${path}`, {
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        ...init,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const message = (json && (json.error || json.message)) || `请求失败（HTTP ${res.status}）`;
        throw new Error(message);
      }
      return json;
    }

    function pad(value) {
      return String(value).padStart(2, "0");
    }

    function fmtClock(ms) {
      if (!Number.isFinite(ms)) return "—";
      const date = new Date(ms);
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function fmtDateTime(iso) {
      if (!iso) return "—";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "—";
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function fmtCountdown(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return "00:00:00";
      const total = Math.floor(ms / 1000);
      return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    }

    function fmtMoney(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "¥0.00";
      if (number > 0 && number < 0.01) return `¥${number.toFixed(4)}`;
      return `¥${number.toFixed(2)}`;
    }

    function fmtTokens(value) {
      const number = Number(value) || 0;
      if (number >= 1000000) return `${(number / 1000000).toFixed(2)}M`;
      if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
      return String(number);
    }

    function isoDate(date) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function todayIso() {
      return isoDate(new Date());
    }

    function splitAt(value) {
      const text = String(value || "");
      const [date, time] = text.split("T");
      return { date: date || "", time: time || "" };
    }

    function flattenModels(catalog) {
      const groups = (catalog && Array.isArray(catalog.groups)) ? catalog.groups : [];
      const entries = [];
      for (const group of groups) {
        for (const model of group.models || []) {
          entries.push({
            provider: group.id,
            id: model.id,
            name: model.name || model.id,
            efforts: ((model.reasoning && model.reasoning.efforts) || []).map((effort) => ({
              id: effort.id,
              name: effort.name || effort.id,
            })),
            defaultEffort: (model.reasoning && model.reasoning.defaultEffort) || "",
          });
        }
      }
      return entries;
    }

    // DSH 的主题展示器（ui-layout 的 theme-presenter）在深色时给 body 设置
    // data-ds-dark-theme=""（空字符串，靠属性「存在」选中深色 token），
    // 浅色时移除该属性；同时在 html 上写 data-ds-theme-source=light|dark|system。
    // 所以这里必须按「属性是否存在」判断，不能要求值非空。
    function hasDarkAttribute(element) {
      if (!element) return false;
      const value = element.getAttribute("data-ds-dark-theme");
      if (value === null) return false;
      return value !== "false" && value !== "0";
    }

    function detectDark() {
      const html = document.documentElement;
      const body = document.body;
      if (hasDarkAttribute(body) || hasDarkAttribute(html)) return true;

      const source = (html && html.getAttribute("data-ds-theme-source")) || "";
      if (source === "dark") return true;
      if (source === "light") return false;

      const scope = body || html;
      if (scope) {
        const theme =
          scope.getAttribute("data-theme") ||
          scope.getAttribute("data-dsh-theme") ||
          scope.getAttribute("data-color-scheme");
        if (theme) return /dark/i.test(theme);
        if (/(^|\s)dark(\s|$)/i.test(scope.className || "")) return true;
      }
      return false;
    }

    function loadDraft(key) {
      try {
        const raw = window.localStorage.getItem(`dsh-liangwengu:draft:${key}`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    function saveDraft(key, value) {
      try {
        window.localStorage.setItem(`dsh-liangwengu:draft:${key}`, JSON.stringify(value));
      } catch {
        /* 忽略配额错误 */
      }
    }

    // -----------------------------------------------------------------------
    // 图标
    // -----------------------------------------------------------------------

    function Icon({ name, size }) {
      const s = size || 16;
      const stroke = {
        width: s,
        height: s,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      };
      const solid = { width: s, height: s, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" };
      if (name === "shieldCheck") {
        return h("svg", stroke, h("path", { d: "M12 3.2 5.4 5.8v5.6c0 4.2 2.8 7.3 6.6 8.9 3.8-1.6 6.6-4.7 6.6-8.9V5.8L12 3.2Z" }), h("path", { d: "m9.2 11.8 2 2 3.6-3.9" }));
      }
      if (name === "shieldEdit") {
        return h("svg", stroke, h("path", { d: "M12 3.2 5.4 5.8v5.6c0 4.2 2.8 7.3 6.6 8.9 3.8-1.6 6.6-4.7 6.6-8.9V5.8L12 3.2Z" }), h("path", { d: "M9 13.2h4.6M9 10.6h6" }));
      }
      if (name === "shieldAlert") {
        return h("svg", stroke, h("path", { d: "M12 3.2 5.4 5.8v5.6c0 4.2 2.8 7.3 6.6 8.9 3.8-1.6 6.6-4.7 6.6-8.9V5.8L12 3.2Z" }), h("path", { d: "M12 8.4v4.2M12 15.6h.01" }));
      }
      if (name === "shieldStar") {
        return h("svg", stroke, h("path", { d: "M12 3.2 5.4 5.8v5.6c0 4.2 2.8 7.3 6.6 8.9 3.8-1.6 6.6-4.7 6.6-8.9V5.8L12 3.2Z" }), h("path", { d: "M10.1 8.6h3.8l.5 2.6h-4.8z" }), h("path", { d: "M12 13.6v2.2" }));
      }
      if (name === "chevron") {
        return h("svg", stroke, h("path", { d: "m6.5 9.5 5.5 5 5.5-5" }));
      }
      if (name === "send") {
        return h("svg", { width: s, height: s, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, h("path", { d: "M12 19V6m0 0-5.5 5.5M12 6l5.5 5.5", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }));
      }
      if (name === "play") {
        return h("svg", solid, h("path", { d: "M8.5 5.6v12.8L19 12 8.5 5.6Z" }));
      }
      if (name === "folder") {
        return h("svg", solid, h("path", { d: "M10 4.2H4.6c-1 0-1.8.8-1.8 1.8v12c0 1 .8 1.8 1.8 1.8h14.8c1 0 1.8-.8 1.8-1.8V8c0-1-.8-1.8-1.8-1.8h-7.2L10 4.2Z" }));
      }
      if (name === "close") {
        return h("svg", stroke, h("path", { d: "m6.5 6.5 11 11m0-11-11 11" }));
      }
      return null;
    }

    // -----------------------------------------------------------------------
    // 基础控件
    // -----------------------------------------------------------------------

    function Select({ value, options, onChange, disabled, wide, compact }) {
      return h(
        "div",
        { className: `lw-select${wide ? " lw-select--wide" : ""}${compact ? " lw-select--compact" : ""}` },
        h(
          "select",
          {
            className: "lw-select__input",
            value: value == null ? "" : value,
            disabled,
            onChange: (event) => onChange(event.target.value),
          },
          options.map((option) => h("option", { value: option.value, key: String(option.value) }, option.label)),
        ),
        h("span", { className: "lw-select__caret" }, h(Icon, { name: "chevron", size: 14 })),
      );
    }

    function Switch({ checked, onChange, label }) {
      return h(
        "button",
        {
          type: "button",
          role: "switch",
          "aria-checked": checked ? "true" : "false",
          "aria-label": label,
          className: `lw-switch${checked ? " lw-switch--on" : ""}`,
          onClick: () => onChange(!checked),
        },
        h("span", { className: "lw-switch__knob" }),
      );
    }

    function Field({ label, hint, children }) {
      return h(
        "div",
        { className: "lw-field" },
        h("div", { className: "lw-field__label" }, label),
        h("div", { className: "lw-field__control" }, children, hint ? h("div", { className: "lw-field__hint" }, hint) : null),
      );
    }

    /** 权限选择：官方风格的下拉菜单（盾牌图标 + 说明）。 */
    function PresetMenu({ value, options, onChange, label, t }) {
      const [open, setOpen] = useState(false);
      const wrapRef = useRef(null);
      useEffect(() => {
        if (!open) return;
        const onDown = (event) => {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [open]);
      const active = options.find((option) => option.value === value) || options[0] || { value: "", label: "—" };
      const activeKey = presetKeyOf(active);
      const hasReview = options.some((option) => presetKeyOf(option) === "pReview");
      const items = hasReview ? options : options.concat([{ value: "__auto-review__", label: t("pReview"), locked: true }]);
      return h(
        "div",
        { className: "lw-preset", ref: wrapRef },
        h(
          "button",
          {
            type: "button",
            className: "lw-preset__btn",
            "aria-haspopup": "menu",
            "aria-expanded": open ? "true" : "false",
            title: label,
            onClick: () => setOpen(!open),
          },
          h("span", { className: "lw-preset__icon" }, h(Icon, { name: PRESET_ICONS[activeKey] || "shieldCheck", size: 16 })),
          h("span", { className: "lw-preset__text" }, activeKey ? t(activeKey) : active.label),
          h("span", { className: "lw-preset__caret" }, h(Icon, { name: "chevron", size: 14 })),
        ),
        open
          ? h(
              "div",
              { className: "lw-menu", role: "menu" },
              items.map((option) => {
                const key = presetKeyOf(option);
                const selected = option.value === value;
                return h(
                  "button",
                  {
                    type: "button",
                    role: "menuitemradio",
                    "aria-checked": selected ? "true" : "false",
                    key: option.value,
                    disabled: option.locked === true,
                    title: option.locked ? t("reviewLocked") : undefined,
                    className: `lw-menu__item${selected ? " lw-menu__item--active" : ""}${option.locked ? " lw-menu__item--locked" : ""}`,
                    onClick: () => {
                      if (option.locked) return;
                      onChange(option.value);
                      setOpen(false);
                    },
                  },
                  h("span", { className: "lw-menu__icon" }, h(Icon, { name: PRESET_ICONS[key] || "shieldCheck", size: 16 })),
                  h("span", { className: "lw-menu__label" }, key ? t(key) : option.label),
                  key === "pReview" ? h("span", { className: "lw-menu__tag" }, t("exp")) : null,
                );
              }),
            )
          : null,
      );
    }

    // -----------------------------------------------------------------------
    // 日历（默认当天，月/日为主，可翻年月）
    // -----------------------------------------------------------------------

    function DatePicker({ value, onChange, t }) {
      const [open, setOpen] = useState(false);
      const initial = value ? new Date(`${value}T00:00:00`) : new Date();
      const [cursor, setCursor] = useState(() => ({ y: initial.getFullYear(), m: initial.getMonth() }));
      const selected = value || todayIso();
      const selectedDate = new Date(`${selected}T00:00:00`);
      const first = new Date(cursor.y, cursor.m, 1);
      const offset = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < offset; i += 1) cells.push(null);
      for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
      const shift = (delta) => {
        const next = new Date(cursor.y, cursor.m + delta, 1);
        setCursor({ y: next.getFullYear(), m: next.getMonth() });
      };
      const pick = (day) => {
        const next = new Date(cursor.y, cursor.m, day);
        onChange(isoDate(next));
        setOpen(false);
      };
      return h(
        "div",
        { className: "lw-datewrap" },
        h(
          "button",
          {
            type: "button",
            className: "lw-date",
            onClick: () => setOpen(!open),
            "aria-expanded": open ? "true" : "false",
          },
          h("span", { className: "lw-date__day" }, t("dateLabel", selectedDate.getMonth() + 1, selectedDate.getDate())),
          h("span", { className: "lw-date__year" }, String(selectedDate.getFullYear())),
        ),
        open
          ? h(
              "div",
              { className: "lw-cal", role: "dialog" },
              h(
                "div",
                { className: "lw-cal__head" },
                h("button", { type: "button", className: "lw-cal__nav", onClick: () => shift(-1), "aria-label": t("prevMonth") }, "‹"),
                h("span", { className: "lw-cal__title" }, t("monthTitle", cursor.y, cursor.m + 1)),
                h("button", { type: "button", className: "lw-cal__nav", onClick: () => shift(1), "aria-label": t("nextMonth") }, "›"),
              ),
              h(
                "div",
                { className: "lw-cal__grid lw-cal__grid--week" },
                t("weekdays").map((label) => h("span", { key: label, className: "lw-cal__week" }, label)),
              ),
              h(
                "div",
                { className: "lw-cal__grid" },
                cells.map((day, index) =>
                  day === null
                    ? h("span", { key: `blank-${index}`, className: "lw-cal__cell" })
                    : h(
                        "button",
                        {
                          key: `day-${day}`,
                          type: "button",
                          className: `lw-cal__cell${selectedDate.getFullYear() === cursor.y && selectedDate.getMonth() === cursor.m && selectedDate.getDate() === day ? " lw-cal__cell--active" : ""}`,
                          onClick: () => pick(day),
                        },
                        String(day),
                      ),
                ),
              ),
              h(
                "div",
                { className: "lw-cal__foot" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "lw-btn lw-btn--sm",
                    onClick: () => {
                      const now = new Date();
                      setCursor({ y: now.getFullYear(), m: now.getMonth() });
                      onChange(isoDate(now));
                      setOpen(false);
                    },
                  },
                  t("today"),
                ),
                h("button", { type: "button", className: "lw-btn lw-btn--sm", onClick: () => setOpen(false) }, t("close")),
              ),
            )
          : null,
      );
    }

    // -----------------------------------------------------------------------
    // 状态条：今日已用 + 谷/峰 + 倒计时 + 余额
    // -----------------------------------------------------------------------

    function StatusBar({ snapshot, now, onAck, onRefreshBalance, busy, toastData, t }) {
      const peak = (snapshot && snapshot.peak) || {};
      const balance = snapshot && snapshot.balance;
      const ledger = (snapshot && snapshot.ledger) || {};
      const isPeak = peak.isPeak === true;
      const target = isPeak ? peak.nextOffPeakAt : peak.nextPeakAt;
      const remain = target ? target - now : 0;
      const alarm = snapshot && snapshot.alarm;
      return h(
        "div",
        { className: "lw-status" },
        h(
          "div",
          { className: "lw-status__usage" },
          h("span", { className: "lw-status__caption" }, t("todayUsed")),
          h("span", { className: "lw-status__amount" }, fmtMoney(ledger.todayCny || 0)),
        ),
        h(
          "div",
          { className: `lw-status__phase${isPeak ? " lw-status__phase--peak" : ""}` },
          h("span", { className: "lw-status__badge" }, isPeak ? t("peak") : t("valley")),
          h("span", { className: "lw-status__clock" }, target ? fmtCountdown(remain) : "—"),
        ),
        h(
          "div",
          { className: "lw-status__balance" },
          h("span", { className: "lw-status__caption" }, t("balance")),
          h(
            "span",
            {
              className:
                balance && balance.ok
                  ? "lw-status__amount"
                  : balance && balance.pending
                    ? "lw-status__amount lw-status__amount--muted"
                    : "lw-status__amount lw-status__amount--bad",
            },
            balance && balance.ok ? fmtMoney(balance.total) : balance && balance.pending ? t("balanceChecking") : t("failed"),
          ),
          h(
            "button",
            { type: "button", className: "lw-link", onClick: onRefreshBalance, disabled: busy === "balance" },
            busy === "balance" ? t("querying") : t("refresh"),
          ),
          toastData && toastData.anchor === "balance"
            ? h(
                "div",
                { className: "lw-toast lw-toast--balance", key: toastData.id },
                h("span", { className: "lw-toast__text" }, toastData.text),
                toastData.detail ? h("span", { className: "lw-toast__detail" }, toastData.detail) : null,
              )
            : null,
        ),
        alarm || (snapshot && snapshot.runtime && snapshot.runtime.pausedByBalance)
          ? h(
              "div",
              { className: "lw-alarm" },
              h("span", null, t("alarmBelow")),
              h("button", { type: "button", className: "lw-link", onClick: onAck }, t("resumeQueue")),
            )
          : null,
      );
    }

    // -----------------------------------------------------------------------
    // 新建 / 追加 指令编辑器
    // -----------------------------------------------------------------------

    function Composer({ kind, snapshot, onCreated, t }) {
      const draftKey = kind === "existing" ? "existing" : "new";
      const initial = useRef(loadDraft(draftKey) || {});
      const [title, setTitle] = useState(initial.current.title || "");
      const [content, setContent] = useState(initial.current.content || "");
      const [files, setFiles] = useState(Array.isArray(initial.current.files) ? initial.current.files : []);
      const [preset, setPreset] = useState(initial.current.preset || "");
      const [modelKey, setModelKey] = useState(initial.current.modelKey || "");
      const [effort, setEffort] = useState(initial.current.effort || "");
      const [mode, setMode] = useState(initial.current.mode === "at" ? "at" : "next-offpeak");
      const [at, setAt] = useState(initial.current.at || "");
      const atParts = splitAt(at);
      const atDate = atParts.date || (mode === "at" ? todayIso() : "");
      const atTime = atParts.time || "09:00";
      const [cwd, setCwd] = useState(initial.current.cwd || "");
      const [sessionId, setSessionId] = useState(initial.current.sessionId || "");
      const [busy, setBusy] = useState("");
      const [message, setMessage] = useState(null);

      const models = flattenModels(snapshot && snapshot.catalog);
      const presetOptions = ((snapshot && snapshot.presets && snapshot.presets.options) || []).map((option) => ({
        value: option.value,
        label: presetKeyOf(option) ? t(presetKeyOf(option)) : option.name || option.value,
      }));
      const fallbackPresets = [
        { value: "read-only", label: t("pRead") },
        { value: "workspace-write", label: t("pWrite") },
        { value: "danger-full-access", label: t("pFull") },
      ];
      const presets = presetOptions.length > 0 ? presetOptions : fallbackPresets;
      const activePreset = preset || (snapshot && snapshot.presets && snapshot.presets.defaultPreset) || (presets[0] && presets[0].value) || "";
      const modelOptions = models.map((entry) => ({
        value: `${entry.provider}::${entry.id}`,
        label: entry.name,
        entry,
      }));
      const activeModelKey = modelKey || (modelOptions[0] && modelOptions[0].value) || "";
      const activeModel = (modelOptions.find((option) => option.value === activeModelKey) || {}).entry;
      const effortOptions = (activeModel && activeModel.efforts) || [];
      const activeEffort = effort || (activeModel && activeModel.defaultEffort) || "";
      const sessions = ((snapshot && snapshot.sessions) || []).filter((item) => typeof item.id === "string");

      useEffect(() => {
        saveDraft(draftKey, {
          title, content, files, preset, modelKey: activeModelKey, effort: activeEffort,
          mode, at, cwd, sessionId,
        });
      }, [title, content, files, preset, activeModelKey, activeEffort, mode, at, cwd, sessionId]);

      useEffect(() => {
        if (mode === "at" && !/^\d{4}-\d{2}-\d{2}/.test(at)) setAt(`${todayIso()}T09:00`);
      }, [mode, at]);

      useEffect(() => {
        if (kind === "existing" && !sessionId && sessions.length > 0) setSessionId(sessions[0].id);
      }, [kind, sessionId, sessions.length]);

      function addFiles(list) {
        const next = [];
        for (const file of Array.from(list || [])) {
          if (!/^(image\/|text\/)/.test(file.type || "")) {
            setMessage({ tone: "bad", text: t("attachOnly", file.name) });
            continue;
          }
          next.push(file);
        }
        if (next.length === 0) return;
        setFiles((prev) => [...prev, ...next].slice(0, 8));
      }

      async function uploadPending() {
        const uploaded = [];
        for (const file of files) {
          if (typeof file === "string") continue;
          if (file.uploaded) {
            uploaded.push(file.uploaded);
            continue;
          }
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
            reader.onerror = () => reject(new Error("读取文件失败"));
            reader.readAsDataURL(file);
          });
          const result = await api("upload.json", {
            method: "POST",
            body: JSON.stringify({ name: file.name, mediaType: file.type, data }),
          });
          uploaded.push(result.attachment || result.file);
        }
        return uploaded;
      }

      async function submit() {
        if (busy) return;
        if (!content.trim()) {
          setMessage({ tone: "bad", text: t("needContent") });
          return;
        }
        if (kind === "existing" && !sessionId) {
          setMessage({ tone: "bad", text: t("needSession") });
          return;
        }
        setBusy("submit");
        try {
          const attachments = await uploadPending();
          const [provider, model] = activeModelKey ? activeModelKey.split("::") : ["", ""];
          const payload = {
            op: "save",
            task: {
              kind: kind === "existing" ? "existing" : "new",
              title,
              content,
              attachments,
              preset: activePreset,
              provider: provider || "",
              model: model || "",
              reasoningEffort: activeEffort || "",
              mode,
              at: mode === "at" ? at : null,
              cwd,
              sessionId: kind === "existing" ? sessionId : "",
            },
          };
          await api("task.json", { method: "POST", body: JSON.stringify(payload) });
          setContent("");
          setTitle("");
          setFiles([]);
          setMessage({ tone: "good", text: t("queued") });
          onCreated && onCreated();
        } catch (error) {
          setMessage({ tone: "bad", text: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy("");
        }
      }

      return h(
        "section",
        { className: "lw-composer" },
        h("input", {
          className: "lw-titleinput",
          value: title,
          placeholder: t("titlePlaceholder"),
          onChange: (event) => setTitle(event.target.value),
        }),
        kind === "existing"
          ? h(
              "div",
              { className: "lw-inline lw-inline--session" },
              h("span", { className: "lw-inline__label" }, t("targetSession")),
              h(Select, {
                value: sessionId,
                wide: true,
                options: sessions.slice(0, 80).map((item) => ({
                  value: item.id,
                  label: `${item.title}${item.updatedAt ? ` · ${fmtDateTime(item.updatedAt)}` : ""}`,
                })),
                onChange: setSessionId,
                disabled: sessions.length === 0,
              }),
            )
          : null,
        h("textarea", {
          className: "lw-textarea",
          value: content,
          placeholder: kind === "existing" ? t("phExisting") : t("phNew"),
          onChange: (event) => setContent(event.target.value),
          onKeyDown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submit();
          },
        }),
        files.length > 0
          ? h(
              "div",
              { className: "lw-attachments" },
              files.map((file, index) =>
                h(
                  "span",
                  { className: "lw-attachment", key: `${index}-${file.name || file.path}` },
                  h("span", { className: "lw-attachment__name" }, file.name || String(file.path || "").split(/[\\/]/).pop() || "附件"),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "lw-attachment__x",
                      onClick: () => setFiles(files.filter((_, i) => i !== index)),
                      "aria-label": t("remove"),
                    },
                    h(Icon, { name: "close", size: 12 }),
                  ),
                ),
              ),
            )
          : null,
        h(
          "div",
          { className: "lw-toolbar" },
          h(
            "label",
            { className: "lw-iconbtn", title: t("attach") },
            h("span", { className: "lw-iconbtn__plus" }, "+"),
            h("input", {
              type: "file",
              multiple: true,
              accept: "image/*,text/*,.md,.json,.csv,.log,.ts,.js,.tsx,.jsx,.py,.yml,.yaml,.toml",
              style: { display: "none" },
              onChange: (event) => {
                addFiles(event.target.files);
                event.target.value = "";
              },
            }),
          ),
          h(PresetMenu, { value: activePreset, options: presets, onChange: setPreset, label: t("preset"), t }),
          h(Select, {
            value: activeEffort,
            compact: true,
            options: effortOptions.length > 0
              ? effortOptions.map((option) => ({ value: option.id, label: t(EFFORT_KEYS[String(option.id).toLowerCase()] || "") || option.name || option.id }))
              : [{ value: "", label: t("effortDefault") }],
            onChange: setEffort,
            disabled: effortOptions.length === 0,
          }),
          h(Select, {
            value: activeModelKey,
            compact: true,
            options: modelOptions.length > 0 ? modelOptions.map((option) => ({ value: option.value, label: option.label })) : [{ value: "", label: t("noModel") }],
            onChange: (value) => {
              setModelKey(value);
              const next = (models.find((entry) => `${entry.provider}::${entry.id}` === value) || {});
              setEffort(next.defaultEffort || "");
            },
            disabled: modelOptions.length === 0,
          }),
          h(
            "button",
            {
              type: "button",
              className: "lw-send",
              onClick: submit,
              disabled: busy === "submit",
              "aria-label": t("send"),
              title: t("send"),
            },
            busy === "submit" ? h("span", { className: "lw-send__dots" }, "…") : h(Icon, { name: "send", size: 18 }),
          ),
        ),
        h(
          "div",
          { className: "lw-toolbar lw-toolbar--second" },
          h(Select, {
            value: mode,
            options: [
              { value: "next-offpeak", label: t("modeNext") },
              { value: "at", label: t("modeAt") },
            ],
            onChange: setMode,
            wide: true,
          }),
          mode === "at"
            ? h(
                "div",
                { className: "lw-datetime" },
                h(DatePicker, {
                  value: atDate,
                  onChange: (date) => setAt(`${date}T${atTime || "09:00"}`),
                  t,
                }),
                h("input", {
                  className: "lw-input lw-input--time",
                  type: "time",
                  value: atTime,
                  onChange: (event) => setAt(`${atDate}T${event.target.value || "09:00"}`),
                }),
              )
            : null,
          h("input", {
            className: "lw-input lw-input--cwd",
            value: cwd,
            placeholder: t("cwdPlaceholder"),
            onChange: (event) => setCwd(event.target.value),
          }),
        ),
        message
          ? h("div", { className: `lw-note lw-note--${message.tone}` }, message.text)
          : h("div", { className: "lw-hint" }, t("hint")),
      );
    }

    // -----------------------------------------------------------------------
    // 任务卡片
    // -----------------------------------------------------------------------

    const STATUS_KEYS = {
      queued: "stQueued",
      running: "stRunning",
      done: "stDone",
      failed: "stFailed",
      canceled: "stCanceled",
    };

    function taskTitle(task, t) {
      if (task.title && String(task.title).trim()) return String(task.title).trim();
      const first = String(task.content || "").split(/\r?\n/).find((line) => line.trim());
      return first ? first.trim().slice(0, 40) : t("tabNew");
    }

    function taskSummary(task) {
      const text = String(task.content || "").replace(/\s+/g, " ").trim();
      return text.length > 96 ? `${text.slice(0, 96)}…` : text;
    }

    function TaskCard({ task, now, onAction, busy, t }) {
      const status = task.status || "queued";
      const target = task.mode === "at" && task.at ? Date.parse(task.at) : task.notBefore ? Date.parse(task.notBefore) : null;
      return h(
        "div",
        { className: `lw-task lw-task--${status}` },
        h("span", { className: `lw-dot lw-dot--${status}` }),
        h(
          "div",
          { className: "lw-task__main" },
          h("div", { className: "lw-task__title" }, taskTitle(task, t)),
          h("div", { className: "lw-task__summary" }, taskSummary(task)),
          h(
            "div",
            { className: "lw-task__meta" },
            h("span", null, t(STATUS_KEYS[status] || "stQueued")),
            task.model ? h("span", null, task.model) : null,
            task.preset ? h("span", null, t(PRESET_KEYS[task.preset] || "") || task.preset) : null,
            Array.isArray(task.attachments) && task.attachments.length > 0 ? h("span", null, t("attachCount", task.attachments.length)) : null,
            task.mode === "at" && task.at ? h("span", null, t("timed", fmtDateTime(task.at))) : null,
            status === "queued" && target ? h("span", null, t("aboutMinutes", Math.max(0, Math.round((target - now) / 60000)))) : null,
            task.error ? h("span", { className: "lw-task__error" }, task.error) : null,
          ),
        ),
        h(
          "div",
          { className: "lw-task__actions" },
          status === "queued"
            ? h("button", { type: "button", className: "lw-link", disabled: busy, onClick: () => onAction("run", task.id) }, t("actRun"))
            : null,
          status === "queued" || status === "failed"
            ? h("button", { type: "button", className: "lw-link", disabled: busy, onClick: () => onAction("cancel", task.id) }, t("actCancel"))
            : null,
          h("button", { type: "button", className: "lw-link lw-link--danger", disabled: busy, onClick: () => onAction("delete", task.id) }, t("actDelete")),
        ),
      );
    }

    function TaskList({ kind, snapshot, now, onAction, busyId, t }) {
      const tasks = ((snapshot && snapshot.tasks) || []).filter((task) => (task.kind || "new") === kind);
      return h(
        "section",
        { className: "lw-queue" },
        h("div", { className: "lw-queue__head" }, `${kind === "existing" ? t("queueHistory") : t("queueNew")} · ${tasks.length}`),
        tasks.length === 0
          ? h("div", { className: "lw-empty" }, kind === "existing" ? t("emptyHistory") : t("emptyNew"))
          : tasks.map((task) => h(TaskCard, { key: task.id, task, now, onAction, busy: busyId === task.id, t })),
      );
    }

    // -----------------------------------------------------------------------
    // 历史会话
    // -----------------------------------------------------------------------

    function HistoryTab({ snapshot, now, onAction, busyId, onCreated, t }) {
      return h(
        "div",
        { className: "lw-stack" },
        h(Composer, { kind: "existing", snapshot, onCreated, t }),
        h(TaskList, { kind: "existing", snapshot, now, onAction, busyId, t }),
      );
    }

    // -----------------------------------------------------------------------
    // 记账本
    // -----------------------------------------------------------------------

    function LedgerTab({ snapshot, busy, onRefresh, t }) {
      const ledger = (snapshot && snapshot.ledger) || { days: [] };
      const days = Array.isArray(ledger.days) ? ledger.days : [];
      const maxCny = days.reduce((max, day) => Math.max(max, Number(day.cny) || 0), 0) || 1;
      return h(
        "div",
        { className: "lw-stack" },
        h(
          "section",
          { className: "lw-card" },
          h("div", { className: "lw-card__title" }, t("ledgerTitle")),
          h(
            "div",
            { className: "lw-metrics" },
            h("div", { className: "lw-metric" }, h("div", { className: "lw-metric__label" }, t("mTotal")), h("div", { className: "lw-metric__value" }, fmtMoney(ledger.totalCny || 0))),
            h("div", { className: "lw-metric" }, h("div", { className: "lw-metric__label" }, t("mToday")), h("div", { className: "lw-metric__value" }, fmtMoney(ledger.todayCny || 0))),
            h("div", { className: "lw-metric" }, h("div", { className: "lw-metric__label" }, t("mTokens")), h("div", { className: "lw-metric__value" }, fmtTokens(ledger.totalTokens || 0))),
            h("div", { className: "lw-metric" }, h("div", { className: "lw-metric__label" }, t("mTurns")), h("div", { className: "lw-metric__value" }, String(ledger.entries || 0))),
          ),
          h("div", { className: "lw-disclaimer" }, t("ledgerDisclaimer")),
        ),
        h(
          "section",
          { className: "lw-card" },
          h(
            "div",
            { className: "lw-card__head" },
            h("div", { className: "lw-card__title" }, t("last7")),
            h("button", { type: "button", className: "lw-btn lw-btn--sm", disabled: busy === "state", onClick: onRefresh }, t("refreshLedger")),
          ),
          days.map((day) =>
            h(
              "div",
              { className: "lw-day", key: day.date },
              h("span", { className: "lw-day__date" }, day.label),
              h("span", { className: "lw-day__bar" }, h("span", { className: "lw-day__fill", style: { width: `${Math.round((Number(day.cny) / maxCny) * 100)}%` } })),
              h("span", { className: "lw-day__cny" }, fmtMoney(day.cny)),
              h("span", { className: "lw-day__tokens" }, fmtTokens(day.tokens)),
            ),
          ),
        ),
      );
    }

    // -----------------------------------------------------------------------
    // 设置
    // -----------------------------------------------------------------------

    const ISSUE_URL = "https://github.com/maqimakabaka/dsh-LiangWenGu/issues/new";
    const FEEDBACK_DRAFT_KEY = "dsh-liangwengu:feedback-draft";

    // 诊断信息脱敏：路径、邮箱、密钥、会话标识、长串一律打码
    function redact(value) {
      return String(value == null ? "" : value)
        .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "<path>")
        .replace(/\/(?:Users|home)\/[^\s"']+/g, "<path>")
        .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, (m) => {
          const at = m.indexOf("@");
          return (m.slice(0, 1) || "*") + "***" + m.slice(at);
        })
        .replace(/\b(sk-[A-Za-z0-9_-]{6,}|ghp_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{8,})/g, "***")
        .replace(/\b(token|key|secret|password|passwd|pwd)=([^&\s"']+)/gi, "$1=***")
        .replace(/\bdsh-auth-[A-Za-z0-9_-]+/g, "dsh-auth-***")
        .replace(/\bsession-[A-Za-z0-9_-]{6,}/g, (m) => m.slice(0, 11) + "***")
        .replace(/\b[A-Fa-f0-9]{32,}\b/g, "***")
        .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "***");
    }

    function buildDiagnostics(snapshot, t) {
      const config = (snapshot && snapshot.config) || {};
      const peak = (snapshot && snapshot.peak) || {};
      const balance = snapshot && snapshot.balance;
      const pricing = (snapshot && snapshot.pricing) || {};
      const logs = ((snapshot && snapshot.logs) || []).slice(-8).map((entry) => redact(`[${entry.level}] ${entry.at} ${entry.text}`));
      return [
        `dsh-liangwengu v${(snapshot && snapshot.version) || "unknown"}`,
        `time: ${new Date().toISOString()}`,
        `lang: ${(document.documentElement && document.documentElement.lang) || "-"} / theme: ${config.themeMode || "auto"}`,
        `peak: ${peak.isPeak ? "peak" : "valley"} next=${peak.nextPeakAt || "-"}`,
        `pricing: ${pricing.online ? "online" : "offline"} fetched=${pricing.fetchedAt || "-"}`,
        `balance: ${balance && balance.ok ? balance.total + " " + (balance.currency || "") : (balance && balance.error) || "-"}`,
        `config: ${JSON.stringify({ enabled: config.enabled, concurrency: config.concurrency, peakPolicy: config.peakPolicy, balanceGate: config.balanceGate })}`,
        `ua: ${redact(navigator.userAgent)}`,
        "--- logs ---",
        ...logs,
      ].map((line) => redact(line)).join("\n");
    }

    function SettingsTab({ snapshot, busy, patchConfig, refresh, toast, t }) {
      const saveDraft = (kind, body) => {
        try {
          window.localStorage.setItem(FEEDBACK_DRAFT_KEY, JSON.stringify({ at: new Date().toISOString(), kind: kind, body: body }));
        } catch (error) {
          /* 存储不可用时忽略 */
        }
      };
      const dropDraft = () => {
        try {
          window.localStorage.removeItem(FEEDBACK_DRAFT_KEY);
        } catch (error) {
          /* ignore */
        }
        setDiagText("");
      };
      const openIssue = () => {
        const body = ["## 问题描述 / What happened", "", "", "## 复现步骤 / Steps", ""].join("\n");
        setDiagText(body);
        saveDraft("issue", body);
        const version = (snapshot && snapshot.version) || "unknown";
        const url = `${ISSUE_URL}?title=${encodeURIComponent(`反馈 · dsh-liangwengu v${version}`)}&body=${encodeURIComponent(body)}`;
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) toast(t("issueBlocked"));
      };
      const copyDiagnostics = async () => {
        const content = buildDiagnostics(snapshot, t);
        try {
          await navigator.clipboard.writeText(content);
          setDiagText("");
          saveDraft("copy", content);
          toast(t("diagCopied"));
        } catch (error) {
          setDiagText(content);
          saveDraft("copy", content);
          toast(t("copyFailed"));
        }
      };
      const [diagText, setDiagText] = useState(() => {
        try {
          const raw = window.localStorage.getItem(FEEDBACK_DRAFT_KEY);
          if (!raw) return "";
          const saved = JSON.parse(raw);
          return saved && typeof saved.body === "string" ? saved.body : "";
        } catch (error) {
          return "";
        }
      });
      const config = (snapshot && snapshot.config) || {};
      const pricing = (snapshot && snapshot.pricing) || {};
      const balance = snapshot && snapshot.balance;
      const alarm = snapshot && snapshot.alarm;
      const sound = (snapshot && snapshot.sound) || {};
      const [threshold, setThreshold] = useState(String(config.balanceThreshold == null ? "" : config.balanceThreshold));

      useEffect(() => {
        setThreshold(String(config.balanceThreshold == null ? "" : config.balanceThreshold));
      }, [config.balanceThreshold]);

      function playSound(kind) {
        const slot = ((sound && sound.slots) || {})[kind] || {};
        playSoundKind(kind, slot.volume).catch(() => toast(t("playFailed")));
      }

      function soundRow(kind, label) {
        const slot = ((sound && sound.slots) || {})[kind] || {};
        const volume = Number.isFinite(Number(slot.volume)) ? Number(slot.volume) : 80;
        return h(
          "div",
          { className: "lw-soundrow", key: kind },
          h("span", { className: "lw-soundrow__label" }, label),
          h("button", { type: "button", className: "lw-play", title: t("preview"), "aria-label": t("preview"), onClick: () => playSound(kind) }, h(Icon, { name: "play", size: 13 })),
          h(
            "label",
            { className: "lw-filebox", title: t("soundPick") },
            h("span", { className: "lw-filebox__name" }, slot.name ? (slot.isDefault ? t("builtin", slot.name) : slot.name) : t("noSoundFile")),
            h("span", { className: "lw-filebox__icon" }, h(Icon, { name: "folder", size: 15 })),
            h("input", {
              type: "file",
              accept: "audio/*,.mp3,.wav,.ogg,.m4a",
              style: { display: "none" },
              onChange: (event) => {
                const file = event.target.files && event.target.files[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  toast(t("soundTooBig"));
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = String(reader.result || "");
                  patchConfig({ soundFileBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), soundFileName: file.name, soundKind: kind }, "sound-" + kind).then(() =>
                    toast(t("imported", label, file.name)),
                  );
                };
                reader.readAsDataURL(file);
              },
            }),
          ),
          h(
            "button",
            { type: "button", className: "lw-link", onClick: () => patchConfig({ resetSoundKind: kind }, "reset-" + kind).then(() => toast(t("restored", label))) },
            t("resetDefault"),
          ),
          h(
            "span",
            { className: "lw-volume" },
            h("input", {
              className: "lw-input lw-input--tiny",
              type: "number",
              min: 0,
              max: 100,
              step: 5,
              defaultValue: String(volume),
              "aria-label": `${label} volume`,
              onBlur: (event) => {
                const value = Math.min(100, Math.max(0, Number(event.target.value) || 0));
                event.target.value = String(value);
                patchConfig({ ["volume" + kind.charAt(0).toUpperCase() + kind.slice(1)]: value }, "volume-" + kind);
              },
            }),
            h("span", { className: "lw-volume__unit" }, "%"),
          ),
        );
      }

      return h(
        "div",
        { className: "lw-stack lw-stack--settings" },
        h(
          "section",
          { className: "lw-card" },
          h("div", { className: "lw-card__title" }, t("display")),
          h(
            Field,
            { label: t("themeMode") },
            h(Select, {
              value: config.themeMode || "auto",
              options: [
                { value: "auto", label: t("themeAuto") },
                { value: "light", label: t("themeLight") },
                { value: "dark", label: t("themeDark") },
              ],
              onChange: (value) => patchConfig({ themeMode: value }, "themeMode"),
            }),
          ),
          h(
            Field,
            { label: t("language") },
            h(Select, {
              value: config.lang || "auto",
              options: [
                { value: "auto", label: t("langAuto") },
                { value: "zh", label: t("langZh") },
                { value: "en", label: t("langEn") },
              ],
              onChange: (value) => patchConfig({ lang: value }, "lang"),
            }),
          ),
        ),
        h(
          "section",
          { className: "lw-card" },
          h("div", { className: "lw-card__title" }, t("schedule")),
          h(
            Field,
            { label: t("master"), hint: config.enabled !== false ? t("masterOnHint") : t("masterOffHint") },
            h(Switch, { checked: config.enabled !== false, label: t("master"), onChange: (value) => patchConfig({ enabled: value }, "enabled") }),
          ),
          h(
            Field,
            { label: t("peakPolicy") },
            h(Select, {
              value: config.peakPolicy || "defer",
              options: [
                { value: "defer", label: t("peakDefer") },
                { value: "run", label: t("peakRun") },
              ],
              onChange: (value) => patchConfig({ peakPolicy: value }, "peakPolicy"),
            }),
          ),
          h(
            Field,
            { label: t("concurrency") },
            h(Select, {
              value: config.concurrency || "serial",
              options: [
                { value: "serial", label: t("concSerial") },
                { value: "parallel", label: t("concParallel") },
              ],
              onChange: (value) => patchConfig({ concurrency: value }, "concurrency"),
            }),
          ),
        ),
        h(
          "section",
          { className: "lw-card" },
          h("div", { className: "lw-card__title" }, t("pricing")),
          h(
            "div",
            { className: "lw-rows" },
            h("div", { className: "lw-row" }, h("span", null, t("lastFetch")), h("span", { className: "lw-row__value" }, fmtDateTime(pricing.fetchedAt))),
          ),
          h(
            Field,
            { label: t("autoFetch") },
            h(Select, {
              value: config.pricingRefresh || "startup",
              options: [
                { value: "off", label: t("fetchOff") },
                { value: "startup", label: t("fetchStartup") },
                { value: "daily", label: t("fetchDaily") },
                { value: "weekly", label: t("fetchWeekly") },
              ],
              onChange: (value) => patchConfig({ pricingRefresh: value }, "pricingRefresh"),
            }),
          ),
          h(
            "div",
            { className: "lw-actions" },
            h("button", { type: "button", className: "lw-btn", disabled: busy === "pricing", onClick: () => refresh("pricing") }, busy === "pricing" ? t("fetching") : t("fetchNow")),
          ),
          (pricing.models || []).length > 0
            ? h(
                "details",
                { className: "lw-details" },
                h("summary", null, t("priceRef")),
                h(
                  "div",
                  { className: "lw-rows lw-rows--compact" },
                  h("div", { className: "lw-row" }, h("span", null, t("peakBeijing")), h("span", { className: "lw-row__value" }, "09:00-12:00 / 14:00-18:00")),
                  h("div", { className: "lw-row" }, h("span", null, t("fetchStatus")), h("span", { className: "lw-row__value" }, pricing.online ? t("online") : t("offline"))),
                ),
                h(
                  "div",
                  { className: "lw-table" },
                  h("div", { className: "lw-table__row lw-table__row--head" }, h("span", null, t("colModel")), h("span", null, t("colHit")), h("span", null, t("colMiss")), h("span", null, t("colOut"))),
                  (pricing.models || []).map((model) =>
                    h(
                      "div",
                      { className: "lw-table__row", key: model.id },
                      h("span", null, model.name || model.id),
                      h("span", null, `峰 ${model.peak.cacheHit} / 谷 ${model.offPeak.cacheHit}`),
                      h("span", null, `峰 ${model.peak.cacheMiss} / 谷 ${model.offPeak.cacheMiss}`),
                      h("span", null, `峰 ${model.peak.output} / 谷 ${model.offPeak.output}`),
                    ),
                  ),
                ),
              )
            : null,
        ),
        h(
          "section",
          { className: "lw-card" },
          h("div", { className: "lw-card__title" }, t("balanceTitle")),
          h(
            Field,
            { label: t("balanceGate"), hint: t("balanceGateHint") },
            h(Switch, { checked: config.balanceGate !== false, label: t("balanceGate"), onChange: (value) => patchConfig({ balanceGate: value }, "balanceGate") }),
          ),
          h(
            Field,
            { label: t("threshold") },
            h(
              "div",
              { className: "lw-inline" },
              h("input", {
                className: "lw-input lw-input--short",
                value: threshold,
                inputMode: "decimal",
                onChange: (event) => setThreshold(event.target.value),
                onBlur: () => {
                  const value = Number(threshold);
                  if (Number.isFinite(value) && value >= 0) patchConfig({ balanceThreshold: value }, "balanceThreshold");
                },
              }),
              h("span", { className: "lw-inline__unit" }, t("yuan")),
            ),
          ),
          h(
            Field,
            { label: t("balanceFreq") },
            h(Select, {
              value: String(config.balanceRefreshMinutes || 30),
              options: [5, 15, 30, 60].map((minutes) => ({ value: String(minutes), label: t("every", minutes) })),
              onChange: (value) => patchConfig({ balanceRefreshMinutes: Number(value) }, "balanceRefreshMinutes"),
            }),
          ),
          h(
            Field,
            { label: t("alarmEvery"), hint: t("alarmEveryHint") },
            h(Select, {
              value: config.alarmEvery || "startup",
              options: [
                { value: "startup", label: t("alarmStartup") },
                { value: "1h", label: t("alarm1h") },
                { value: "2h", label: t("alarm2h") },
                { value: "6h", label: t("alarm6h") },
                { value: "12h", label: t("alarm12h") },
                { value: "24h", label: t("alarm24h") },
              ],
              onChange: (value) => patchConfig({ alarmEvery: value }, "alarmEvery"),
            }),
          ),
          h(
            "div",
            { className: "lw-actions" },
            h("button", { type: "button", className: "lw-btn", disabled: busy === "balance", onClick: () => refresh("balance") }, busy === "balance" ? t("querying") : t("queryNow")),
            alarm || (snapshot && snapshot.runtime && snapshot.runtime.pausedByBalance) ? h("button", { type: "button", className: "lw-btn", onClick: () => api("ack.json", { method: "POST", body: "{}" }).then(() => refresh("state")) }, t("restore")) : null,
          ),
          balance && !balance.ok
            ? h("div", { className: "lw-note lw-note--bad" }, `${t("failed")}：${balance.error || ""}`)
            : null,
        ),
        h(
          "section",
          { className: "lw-card" },
          h("div", { className: "lw-card__title" }, t("sound")),
          h(
            Field,
            { label: t("soundSwitch") },
            h(Switch, { checked: config.soundEnabled !== false, label: t("soundSwitch"), onChange: (value) => patchConfig({ soundEnabled: value }, "soundEnabled") }),
          ),
          soundRow("balance", t("soundBalance")),
          soundRow("valley", t("soundValley")),
          soundRow("peak", t("soundPeak")),
        ),
        h(
          "section",
          { className: "lw-card" },
          h(
            "div",
            { className: "lw-card__title lw-card__title--row" },
            h("span", null, t("logs")),
            h(
              "span",
              { className: "lw-card__actions" },
              h("button", { type: "button", className: "lw-link lw-feedback", onClick: openIssue }, t("feedbackIssue")),
              h("button", { type: "button", className: "lw-link lw-feedback", onClick: copyDiagnostics }, t("copyDiag")),
            ),
          ),
          diagText
            ? h(
                "div",
                { className: "lw-diagwrap" },
                h("div", { className: "lw-hint lw-diagwrap__head" },
                  h("span", null, t("copyManual")),
                  h("button", { type: "button", className: "lw-link", onClick: dropDraft }, t("draftClear")),
                ),
                h("textarea", {
                  className: "lw-input lw-diag",
                  readOnly: true,
                  rows: 10,
                  value: diagText,
                  onFocus: (event) => event.target.select(),
                  onMouseDown: (event) => event.target.select(),
                }),
              )
            : null,
          h(
            "div",
            { className: "lw-logs" },
            ((snapshot && snapshot.logs) || []).slice(-12).reverse().map((entry, index) =>
              h("div", { className: `lw-log lw-log--${entry.level}`, key: `${entry.at}-${index}` }, `${fmtDateTime(entry.at)}  ${entry.text}`),
            ),
          ),
        ),
      );
    }

    // -----------------------------------------------------------------------
    // 主面板
    // -----------------------------------------------------------------------

    const TAB_KEYS = ["tabNew", "tabHistory", "tabLedger", "tabSettings"];
    const TAB_IDS = ["new", "history", "ledger", "settings"];

    function Panel() {
      const [tab, setTab] = useState("new");
      const [snapshot, setSnapshot] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState("");
      const [toastData, setToastData] = useState(null);
      const [tick, setTick] = useState(Date.now());
      const [dark, setDark] = useState(detectDark);
      const toastTimer = useRef(null);

      const config = (snapshot && snapshot.config) || {};
      const lang = detectLang(config);
      const dict = DICT[lang] || DICT.zh;
      const t = (key, ...args) => {
        const value = dict[key];
        if (typeof value === "function") return value(...args);
        return value == null ? key : value;
      };

      function toast(text, detail, anchor) {
        setToastData({ text: text, detail: detail || "", id: Date.now(), anchor: anchor || "" });
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastData(null), 1600);
      }

      async function load(showError) {
        try {
          const json = await api("state.json");
          setSnapshot(json);
          if (showError) setError(null);
        } catch (err) {
          if (showError) setError(err instanceof Error ? err.message : String(err));
        }
      }

      useEffect(() => {
        load(true);
        const poll = setInterval(() => load(false), POLL_MS);
        const clock = setInterval(() => setTick(Date.now()), 1000);
        return () => {
          clearInterval(poll);
          clearInterval(clock);
        };
      }, []);

      useEffect(() => {
        const observer = new MutationObserver(() => setDark(detectDark()));
        const options = {
          attributes: true,
          attributeFilter: ["data-ds-dark-theme", "data-ds-theme-source", "data-theme", "data-dsh-theme", "data-color-scheme", "class"],
        };
        if (document.body) observer.observe(document.body, options);
        if (document.documentElement) observer.observe(document.documentElement, options);
        const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
        const onMedia = () => setDark(detectDark());
        if (media && media.addEventListener) media.addEventListener("change", onMedia);
        return () => {
          observer.disconnect();
          if (media && media.removeEventListener) media.removeEventListener("change", onMedia);
        };
      }, []);

      const themeMode = config.themeMode || "auto";
      const effectiveDark = themeMode === "dark" || (themeMode === "auto" && dark);

      useEffect(() => {
        const alarm = snapshot && snapshot.alarm;
        if (!alarm) return;
        if (config.soundEnabled === false) return;
        const playedKey = "dsh-liangwengu:alarm-played";
        if (window.localStorage.getItem(playedKey) === alarm.id) return;
        playSoundKind("balance", config.volumeBalance).catch(() => {});
        window.localStorage.setItem(playedKey, alarm.id);
      }, [snapshot && snapshot.alarm && snapshot.alarm.id]);

      useEffect(() => {
        const phaseEvent = snapshot && snapshot.phaseEvent;
        if (!phaseEvent || !phaseEvent.id) return;
        if (config.soundEnabled === false) return;
        const playedKey = "dsh-liangwengu:phase-played";
        if (window.localStorage.getItem(playedKey) === phaseEvent.id) return;
        playSoundKind(
          phaseEvent.phase === "peak" ? "peak" : "valley",
          phaseEvent.phase === "peak" ? config.volumePeak : config.volumeValley,
        ).catch(() => {});
        window.localStorage.setItem(playedKey, phaseEvent.id);
      }, [snapshot && snapshot.phaseEvent && snapshot.phaseEvent.id]);

      useEffect(() => {
        const holidayError = snapshot && snapshot.holiday && snapshot.holiday.error;
        if (!holidayError || !holidayError.at) return;
        const seenKey = "dsh-liangwengu:holiday-error";
        if (window.localStorage.getItem(seenKey) === holidayError.at) return;
        window.localStorage.setItem(seenKey, holidayError.at);
        toast(t("holidayFailed"));
      }, [snapshot && snapshot.holiday && snapshot.holiday.error && snapshot.holiday.error.at]);

      async function patchConfig(patch, key) {
        setBusy(key || "config");
        try {
          const result = await api("config.json", { method: "POST", body: JSON.stringify({ config: patch }) });
          if (result && Array.isArray(result.warnings) && result.warnings.length) {
            toast(result.warnings.join("；"));
          }
          await load(false);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy("");
        }
      }

      async function refresh(what) {
        setBusy(what);
        try {
          const next = await api("refresh.json", { method: "POST", body: JSON.stringify({ what }) });
          await load(false);
          if (what === "balance") {
            const balance = next && next.balance;
            if (balance && balance.ok) toast(t("refreshOkShort"), `${t("balance")} ${fmtMoney(balance.total)}`, "balance");
            else toast(t("refreshBad", (balance && balance.error) || t("failed")), "", "balance");
          } else if (what === "pricing") {
            const pricing = next && next.pricing;
            if (pricing && pricing.windows && pricing.windows.length) toast(t("pricingOk"));
            else toast(t("pricingBad"));
          } else if (what === "sessions") {
            toast(t("pricingOk"));
          }
        } catch (err) {
          toast(t("refreshBad", err instanceof Error ? err.message : String(err)));
        } finally {
          setBusy("");
        }
      }

      async function taskAction(op, id) {
        setBusy(id);
        try {
          await api("task.json", { method: "POST", body: JSON.stringify({ op, id }) });
          await load(false);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy("");
        }
      }

      async function ack() {
        try {
          await api("ack.json", { method: "POST", body: "{}" });
          await load(false);
          toast(t("resumed"));
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        }
      }

      return h(
        "div",
        { className: `lw-root${effectiveDark ? " lw-dark" : ""}`, "data-lw-theme": effectiveDark ? "dark" : "light", "data-lw-lang": lang },
        h(
          "header",
          { className: "lw-head" },
          h("div", { className: "lw-head__brand" }, h("span", { className: "lw-brand" }, t("panel")), h("span", { className: "lw-brand__sub" }, t("sub"))),
          h(
            "nav",
            { className: "lw-tabs", role: "tablist" },
            TAB_KEYS.map((key, index) =>
              h(
                "button",
                {
                  key: TAB_IDS[index],
                  type: "button",
                  role: "tab",
                  "aria-selected": tab === TAB_IDS[index] ? "true" : "false",
                  className: `lw-tab${tab === TAB_IDS[index] ? " lw-tab--active" : ""}`,
                  onClick: () => setTab(TAB_IDS[index]),
                },
                t(key),
              ),
            ),
          ),
        ),
        h(
          "div",
          { className: "lw-statuswrap" },
          h(StatusBar, {
            snapshot,
            now: tick,
            busy,
            onAck: ack,
            toastData: toastData,
            onRefreshBalance: () => refresh("balance"),
            t,
          }),
          toastData && toastData.anchor !== "balance"
            ? h(
                "div",
                { className: "lw-toast", key: toastData.id },
                h("span", { className: "lw-toast__text" }, toastData.text),
                toastData.detail ? h("span", { className: "lw-toast__detail" }, toastData.detail) : null,
              )
            : null,
        ),
        error ? h("div", { className: "lw-error" }, error) : null,
        h(
          "main",
          { className: "lw-body" },
          h(
            "div",
            { className: "lw-tabpane", style: tab === "new" ? undefined : { display: "none" } },
            h(Composer, { kind: "new", snapshot, onCreated: () => load(false), t }),
            h(TaskList, { kind: "new", snapshot, now: tick, onAction: taskAction, busyId: busy, t }),
          ),
          h(
            "div",
            { className: "lw-tabpane", style: tab === "history" ? undefined : { display: "none" } },
            h(HistoryTab, { snapshot, now: tick, onAction: taskAction, busyId: busy, onCreated: () => load(false), t }),
          ),
          h(
            "div",
            { className: "lw-tabpane", style: tab === "ledger" ? undefined : { display: "none" } },
            h(LedgerTab, { snapshot, busy, onRefresh: () => refresh("state"), t }),
          ),
          h(
            "div",
            { className: "lw-tabpane", style: tab === "settings" ? undefined : { display: "none" } },
            h(SettingsTab, { snapshot, busy, patchConfig, refresh, toast, t }),
          ),
        ),
      );
    }

    // -----------------------------------------------------------------------
    // 侧边栏图标
    // -----------------------------------------------------------------------

    function PanelIcon({ size }) {
      const s = size || 18;
      return h(
        "svg",
        { width: s, height: s, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M4 18c2.5 0 3.5-9 6-9s3.5 9 6 9 2.5-4 4-4",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        h("path", { d: "M4 6h6", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" }),
      );
    }

    // -----------------------------------------------------------------------
    // 样式（对齐 --dsw-* 令牌与六级圆角）
    // -----------------------------------------------------------------------

    const CSS = `
.lw-root {
  --lw-bg: #f5f6f7;
  --lw-layer1: #ffffff;
  --lw-layer2: #ffffff;
  --lw-sunken: #f5f6f7;
  --lw-text: #0f1115;
  --lw-muted: #81858c;
  --lw-line: rgba(0, 0, 0, 0.1);
  --lw-line-strong: rgba(0, 0, 0, 0.16);
  --lw-hover: rgba(38, 49, 72, 0.06);
  --lw-brand: #0f1115;
  --lw-info: #4176e6;
  --lw-info-weak: rgba(65, 118, 230, 0.1);
  --lw-green: #12a150;
  --lw-green-weak: rgba(18, 161, 80, 0.12);
  --lw-red: #e5484d;
  --lw-red-weak: rgba(229, 72, 77, 0.12);
  --lw-shadow2: 0 1px 2px rgba(15, 17, 21, 0.04), 0 2px 10px rgba(15, 17, 21, 0.06);
  --lw-shadow3: 0 8px 28px rgba(15, 17, 21, 0.12);
  --lw-r-sm: 8px;
  --lw-r-md: 12px;
  --lw-r-lg: 22px;

  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  background: var(--lw-bg);
  color: var(--lw-text);
  font-size: 13px;
  line-height: 1.5;
  padding: 4px 24px 48px;
  padding-top: var(--dsh-frame-top-clearance, 40px);
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}
.lw-root.lw-dark {
  --lw-bg: #151517;
  --lw-layer1: #232324;
  --lw-layer2: #2c2c2e;
  --lw-sunken: #1c1c1e;
  --lw-text: #f9fafb;
  --lw-muted: #adb2b8;
  --lw-line: rgba(255, 255, 255, 0.12);
  --lw-line-strong: rgba(255, 255, 255, 0.2);
  --lw-hover: rgba(255, 255, 255, 0.08);
  --lw-brand: #f9fafb;
  --lw-info: #679efe;
  --lw-info-weak: rgba(103, 158, 254, 0.16);
  --lw-green: #2fd07b;
  --lw-green-weak: rgba(47, 208, 123, 0.16);
  --lw-red: #ff6b6b;
  --lw-red-weak: rgba(255, 107, 107, 0.16);
  --lw-shadow2: 0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 10px rgba(0, 0, 0, 0.32);
  --lw-shadow3: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.lw-root * { box-sizing: border-box; }
.lw-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.lw-root ::-webkit-scrollbar-thumb { background: var(--lw-line-strong); border-radius: 999px; }

/* 顶部：品牌 + 标签页 */
.lw-head { display: flex; align-items: center; gap: 20px; padding: 0 2px 12px; }
.lw-head__brand { display: flex; align-items: baseline; gap: 8px; }
.lw-brand { font-size: 20px; font-weight: 600; letter-spacing: 0.2px; }
.lw-brand__sub { font-size: 12px; color: var(--lw-muted); }
.lw-tabs { display: flex; align-items: center; gap: 4px; flex: 1; }
.lw-tab {
  position: relative;
  border: 0;
  background: transparent;
  padding: 8px 12px 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--lw-muted);
  border-radius: var(--lw-r-sm);
  cursor: pointer;
}
.lw-tab:hover { color: var(--lw-text); background: var(--lw-hover); }
.lw-tab--active { color: var(--lw-text); font-weight: 600; background: transparent; }
.lw-tab--active::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 2px;
  height: 2px;
  border-radius: 999px;
  background: var(--lw-brand);
}

/* 状态条 */
.lw-status {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 10px 16px;
  margin-bottom: 12px;
  background: var(--lw-layer1);
  border: 1px solid var(--lw-line);
  border-radius: var(--lw-r-md);
  box-shadow: var(--lw-shadow2);
  flex-wrap: wrap;
}
.lw-status__usage { display: flex; align-items: baseline; gap: 8px; }
.lw-status__balance { display: flex; align-items: baseline; gap: 8px; position: relative; }
.lw-status__caption { font-size: 12px; color: var(--lw-muted); }
.lw-status__amount { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.lw-status__amount--bad { color: var(--lw-red); }
.lw-status__phase { display: inline-flex; align-items: center; gap: 8px; }
.lw-status__badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 5px; border-radius: 6px;
  background: var(--lw-green); color: #ffffff;
  font-size: 12px; font-weight: 600; line-height: 1;
}
.lw-status__phase--peak .lw-status__badge { background: var(--lw-red); }
.lw-status__clock {
  font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--lw-green);
  text-decoration: underline; text-underline-offset: 3px;
}
.lw-status__phase--peak .lw-status__clock { color: var(--lw-red); }
.lw-alarm {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 4px 10px; border-radius: var(--lw-r-sm);
  background: var(--lw-red-weak); color: var(--lw-red); font-size: 12px;
}

/* 卡片 */
.lw-card {
  background: var(--lw-layer1);
  border: 1px solid var(--lw-line);
  border-radius: var(--lw-r-md);
  box-shadow: var(--lw-shadow2);
  padding: 16px 18px;
}
.lw-card + .lw-card, .lw-stack > * + * { margin-top: 12px; }
.lw-card__title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.lw-card__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.lw-card__head .lw-card__title { margin-bottom: 0; }
.lw-stack { display: flex; flex-direction: column; gap: 12px; }
.lw-stack > * + * { margin-top: 0; }
.lw-stack--settings .lw-card { padding: 18px 20px; }

/* 编辑器 */
.lw-composer {
  background: var(--lw-layer1);
  border: 1px solid var(--lw-line);
  border-radius: var(--lw-r-lg);
  box-shadow: var(--lw-shadow2);
  padding: 16px 18px 14px;
}
.lw-composer .lw-titleinput {
  width: 100%; border: 0; background: transparent; color: var(--lw-text);
  font: inherit; font-size: 14px; font-weight: 500; padding: 2px 0 10px;
  outline: none;
}
.lw-composer .lw-titleinput::placeholder { color: var(--lw-muted); font-weight: 400; }
.lw-textarea {
  width: 100%; min-height: 92px; resize: vertical;
  border: 0; background: transparent; color: var(--lw-text);
  font: inherit; font-size: 14px; line-height: 22px; outline: none;
  padding: 0;
}
.lw-textarea::placeholder { color: var(--lw-muted); }
.lw-toolbar { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.lw-toolbar--second { margin-top: 8px; }
.lw-inline { display: inline-flex; align-items: center; gap: 8px; }
.lw-inline--session { margin: 0 0 8px; }
.lw-inline__label { font-size: 12px; color: var(--lw-muted); }
.lw-inline__unit { font-size: 12px; color: var(--lw-muted); }
.lw-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 999px;
  border: 1px solid var(--lw-line); background: transparent; color: var(--lw-muted);
  cursor: pointer; flex: none; font-size: 16px; line-height: 1;
}
.lw-iconbtn:hover { background: var(--lw-hover); color: var(--lw-text); }
.lw-iconbtn__plus { display: block; margin-top: -2px; }
.lw-send {
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 999px;
  border: 0; background: var(--lw-info); color: #ffffff; cursor: pointer;
  flex: none;
}
.lw-send:hover { filter: brightness(1.05); }
.lw-send:disabled { opacity: 0.5; cursor: default; }
.lw-send__dots { font-size: 16px; line-height: 1; }

/* 输入与下拉 */
.lw-input {
  height: 32px; padding: 0 10px;
  border: 1px solid var(--lw-line); border-radius: var(--lw-r-sm);
  background: var(--lw-layer1); color: var(--lw-text); font: inherit; font-size: 13px;
  outline: none;
}
.lw-input:focus { border-color: var(--lw-info); }
.lw-input--time { width: 104px; flex: none; font-variant-numeric: tabular-nums; }
.lw-input--cwd { flex: 1 1 200px; min-width: 160px; }
.lw-input--short { width: 96px; }
.lw-input--tiny { width: 56px; height: 28px; text-align: center; padding: 0 4px; }

.lw-select { position: relative; display: inline-flex; align-items: center; flex: none; }
.lw-select--wide { flex: 1 1 220px; }
.lw-select__input {
  appearance: none; -webkit-appearance: none;
  height: 32px; padding: 0 28px 0 10px; width: 100%;
  border: 1px solid var(--lw-line); border-radius: var(--lw-r-sm);
  background: var(--lw-layer1); color: var(--lw-text);
  font: inherit; font-size: 13px; cursor: pointer; outline: none;
}
.lw-select__input:focus { border-color: var(--lw-info); }
.lw-select__input:disabled { opacity: 0.5; cursor: default; }
.lw-select__caret { position: absolute; right: 8px; display: inline-flex; color: var(--lw-muted); pointer-events: none; }
.lw-select--compact .lw-select__input { max-width: 168px; }
.lw-select--wide .lw-select__input { max-width: none; }

/* 权限菜单 */
.lw-preset { position: relative; display: inline-flex; flex: none; }
.lw-preset__btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 10px;
  border: 1px solid var(--lw-line); border-radius: var(--lw-r-sm);
  background: var(--lw-layer1); color: var(--lw-text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.lw-preset__btn:hover { background: var(--lw-hover); }
.lw-preset__icon, .lw-menu__icon { display: inline-flex; color: var(--lw-muted); }
.lw-preset__caret { display: inline-flex; color: var(--lw-muted); }
.lw-menu {
  position: absolute; left: 0; top: calc(100% + 6px); z-index: 40;
  min-width: 208px; padding: 6px;
  background: var(--lw-layer1);
  border: 1px solid var(--lw-line); border-radius: var(--lw-r-md);
  box-shadow: var(--lw-shadow3);
  display: flex; flex-direction: column; gap: 2px;
}
.lw-menu__item {
  display: flex; align-items: center; gap: 8px;
  border: 0; background: transparent; color: var(--lw-text);
  font: inherit; font-size: 13px; text-align: left;
  padding: 8px 10px; border-radius: 10px; cursor: pointer;
}
.lw-menu__item:hover { background: var(--lw-hover); }
.lw-menu__item--active { background: var(--lw-hover); font-weight: 500; }
.lw-menu__item--locked { opacity: 0.45; cursor: default; }
.lw-menu__item--locked:hover { background: transparent; }
.lw-menu__label { flex: 1; }
.lw-menu__tag { font-size: 10px; color: var(--lw-muted); letter-spacing: 0.4px; }

/* 按钮 */
.lw-btn {
  height: 36px; padding: 0 16px; border-radius: 18px;
  border: 1px solid var(--lw-line); background: transparent; color: var(--lw-text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.lw-btn:hover { background: var(--lw-hover); }
.lw-btn:disabled { opacity: 0.4; cursor: default; }
.lw-btn--sm { height: 28px; padding: 0 12px; border-radius: 14px; font-size: 12px; }
.lw-link {
  border: 0; background: transparent; color: var(--lw-info);
  font: inherit; font-size: 12px; padding: 0 2px; cursor: pointer;
}
.lw-link:hover { text-decoration: underline; }
.lw-link:disabled { opacity: 0.5; cursor: default; text-decoration: none; }
.lw-link--danger { color: var(--lw-red); }

/* 附件 */
.lw-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lw-attachment {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 260px; padding: 3px 4px 3px 10px;
  border: 1px solid var(--lw-line); border-radius: 999px;
  background: var(--lw-sunken); font-size: 12px; color: var(--lw-text);
}
.lw-attachment__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lw-attachment__x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 999px;
  border: 0; background: transparent; color: var(--lw-muted); cursor: pointer;
}
.lw-attachment__x:hover { background: var(--lw-hover); color: var(--lw-text); }

/* 日期 */
.lw-datewrap { position: relative; display: inline-flex; flex: none; }
.lw-date {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 10px;
  border: 1px solid var(--lw-line); border-radius: var(--lw-r-sm);
  background: var(--lw-layer1); color: var(--lw-text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.lw-date__year { font-size: 11px; color: var(--lw-muted); }
.lw-cal {
  position: absolute; left: 0; top: calc(100% + 6px); z-index: 40;
  width: 252px; padding: 10px;
  background: var(--lw-layer1);
  border: 1px solid var(--lw-line); border-radius: var(--lw-r-md);
  box-shadow: var(--lw-shadow3);
}
.lw-cal__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.lw-cal__title { font-size: 13px; font-weight: 600; }
.lw-cal__nav {
  width: 24px; height: 24px; border-radius: var(--lw-r-sm);
  border: 0; background: transparent; color: var(--lw-muted);
  font-size: 15px; cursor: pointer; line-height: 1;
}
.lw-cal__nav:hover { background: var(--lw-hover); color: var(--lw-text); }
.lw-cal__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.lw-cal__week { text-align: center; font-size: 11px; color: var(--lw-muted); padding: 4px 0; }
.lw-cal__cell {
  height: 30px; border: 0; border-radius: var(--lw-r-sm);
  background: transparent; color: var(--lw-text);
  font: inherit; font-size: 12px; cursor: pointer;
}
.lw-cal__cell:hover { background: var(--lw-hover); }
.lw-cal__cell--active { background: var(--lw-info); color: #ffffff; }
.lw-cal__foot { display: flex; justify-content: space-between; margin-top: 8px; }

/* 开关 */
.lw-switch {
  position: relative; width: 36px; height: 20px; border-radius: 999px;
  border: 0; background: var(--lw-line-strong); cursor: pointer; padding: 0;
  transition: background 0.15s ease; flex: none;
}
.lw-switch--on { background: var(--lw-info); }
.lw-switch__knob {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 999px; background: #ffffff; transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.lw-switch--on .lw-switch__knob { transform: translateX(16px); }

/* 设置行 */
.lw-field {
  display: grid; grid-template-columns: 112px minmax(0, 1fr);
  gap: 10px; align-items: start; padding: 7px 0;
}
.lw-field__label { font-size: 13px; color: var(--lw-text); padding-top: 6px; }
.lw-field__control { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lw-field__hint { flex-basis: 100%; font-size: 12px; color: var(--lw-muted); }
.lw-rows { margin: 4px 0 8px; }
.lw-row {
  display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px;
  padding: 5px 0; font-size: 13px;
}
.lw-row > span:first-child { color: var(--lw-muted); }
.lw-row__value { color: var(--lw-text); font-variant-numeric: tabular-nums; }
.lw-rows--compact .lw-row { padding: 3px 0; font-size: 12px; }
.lw-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.lw-details { margin-top: 10px; border-top: 1px solid var(--lw-line); padding-top: 8px; }
.lw-details summary { font-size: 12px; color: var(--lw-muted); cursor: pointer; padding: 4px 0; }
.lw-details summary:hover { color: var(--lw-text); }
.lw-table { margin-top: 6px; font-size: 12px; }
.lw-table__row {
  display: grid; grid-template-columns: minmax(120px, 1.2fr) repeat(3, minmax(90px, 1fr));
  gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--lw-line);
  font-variant-numeric: tabular-nums;
}
.lw-table__row:last-child { border-bottom: 0; }
.lw-table__row--head { color: var(--lw-muted); border-bottom: 1px solid var(--lw-line); }

/* 提示音 */
.lw-soundrow { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.lw-soundrow__label { width: 112px; flex: none; font-size: 13px; }
.lw-play {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 999px;
  border: 1px solid var(--lw-line); background: transparent; color: var(--lw-text);
  cursor: pointer; flex: none;
}
.lw-play:hover { background: var(--lw-hover); }
.lw-filebox {
  display: inline-flex; align-items: center; justify-content: space-between; gap: 10px;
  flex: 1 1 auto; min-width: 200px; max-width: 320px; height: 32px;
  padding: 0 10px; border: 1px solid var(--lw-line); border-radius: var(--lw-r-sm);
  background: var(--lw-layer1); cursor: pointer; font-size: 13px;
}
.lw-filebox:hover { background: var(--lw-hover); }
.lw-filebox__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--lw-text); }
.lw-filebox__icon { display: inline-flex; color: var(--lw-muted); flex: none; }
.lw-volume { display: inline-flex; align-items: center; gap: 4px; flex: none; margin-left: auto; }
.lw-volume__unit { font-size: 12px; color: var(--lw-muted); }

/* 队列与任务 */
.lw-queue__head { font-size: 13px; font-weight: 600; color: var(--lw-text); margin: 4px 2px 8px; }
.lw-empty {
  padding: 22px 16px; text-align: center; font-size: 12px; color: var(--lw-muted);
  border: 1px dashed var(--lw-line); border-radius: var(--lw-r-md);
}
.lw-task {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; margin-bottom: 8px;
  background: var(--lw-layer1); border: 1px solid var(--lw-line);
  border-radius: var(--lw-r-md);
}
.lw-task__main { flex: 1; min-width: 0; }
.lw-task__title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lw-task__summary { font-size: 12px; color: var(--lw-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lw-task__meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--lw-muted); margin-top: 6px; }
.lw-task__error { color: var(--lw-red); }
.lw-task__actions { display: flex; align-items: center; gap: 8px; flex: none; }
.lw-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--lw-line-strong); flex: none; margin-top: 6px; }
.lw-dot--queued { background: var(--lw-info); }
.lw-dot--running { background: var(--lw-info); }
.lw-dot--done { background: var(--lw-green); }
.lw-dot--failed { background: var(--lw-red); }

/* 记账本 */
.lw-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 8px 0 10px; }
.lw-metric { padding: 12px 14px; border: 1px solid var(--lw-line); border-radius: var(--lw-r-md); background: var(--lw-sunken); }
.lw-metric__label { font-size: 12px; color: var(--lw-muted); }
.lw-metric__value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 4px; }
.lw-disclaimer { font-size: 11px; color: var(--lw-muted); line-height: 1.6; }
.lw-day { display: grid; grid-template-columns: 56px minmax(0, 1fr) 76px 56px; align-items: center; gap: 10px; padding: 6px 0; font-size: 12px; }
.lw-day__date, .lw-day__cny, .lw-day__tokens { color: var(--lw-muted); font-variant-numeric: tabular-nums; }
.lw-day__cny, .lw-day__tokens { text-align: right; }
.lw-day__bar { display: block; height: 6px; border-radius: 999px; background: var(--lw-hover); overflow: hidden; }
.lw-day__fill { display: block; height: 100%; background: var(--lw-info); border-radius: 999px; }

/* 日志与提示 */
.lw-logs { max-height: 260px; overflow-y: auto; font-size: 12px; }
.lw-log { padding: 3px 0; color: var(--lw-muted); border-bottom: 1px dashed var(--lw-line); }
.lw-log:last-child { border-bottom: 0; }
.lw-log--warn { color: var(--lw-red); }
.lw-note { margin-top: 8px; font-size: 12px; padding: 6px 10px; border-radius: var(--lw-r-sm); }
.lw-note--good { background: var(--lw-green-weak); color: var(--lw-green); }
.lw-note--bad { background: var(--lw-red-weak); color: var(--lw-red); }
.lw-hint { margin-top: 8px; font-size: 12px; color: var(--lw-muted); }
.lw-error { margin: 8px 0; padding: 8px 12px; border-radius: var(--lw-r-sm); background: var(--lw-red-weak); color: var(--lw-red); font-size: 12px; }
.lw-statuswrap { position: relative; }
.lw-toast {
  position: absolute; right: 14px; top: calc(100% + 10px); z-index: 60;
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  max-width: 320px; padding: 10px 14px;
  border-radius: var(--lw-r-md); background: var(--lw-text); color: var(--lw-bg);
  font-size: 13px; line-height: 18px; box-shadow: var(--lw-shadow3);
  pointer-events: none; animation: lw-toast-life 1.6s ease forwards;
}
.lw-toast__detail { font-size: 12px; opacity: .72; }
.lw-toast--balance { left: 0; right: auto; top: calc(100% + 8px); }
@keyframes lw-toast-life {
  0% { opacity: 0; transform: translateY(-6px); }
  14% { opacity: 1; transform: translateY(0); }
  70% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-3px); }
}
.lw-card__title--row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lw-diagwrap { margin: 6px 0 10px; }
.lw-diagwrap__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.lw-diag { width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 18px; }
.lw-card__actions { display: flex; align-items: center; gap: 12px; }
.lw-feedback { font-size: 12px; }
.lw-status__amount--muted { color: var(--lw-muted); }
.lw-body { display: block; }
.lw-tabpane { outline: none; }
`;

    function apply(ctx) {
      ctx.effect(() => () => {}, "dsh-liangwengu: noop");
      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.dshLiangwengu = "panel";
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, "dsh-liangwengu: styles");

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 40,
            label: "梁文谷",
          },
          PanelIcon,
        ),
      );

      ctx.slots.inject("main", function* () {
        yield ctx.slots.register({ name: "main", key: PANEL_ID }, Panel);
      });
    }

    return {
      name: "dsh-liangwengu",
      inject: ["slots"],
      apply,
    };
  },
});
