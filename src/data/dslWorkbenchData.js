export const dslTask = {
  title: "登录失败提示优化",
  phase: "Clarification-ready",
  goal: "补齐失败场景、用户提示、验收标准"
};

export const clarificationMessages = [
  {
    id: "pm-1022",
    author: "PM",
    role: "pm",
    time: "10:22",
    text: "目前登录失败时，提示文案比较通用，想优化提示内容，让用户更清楚失败原因。"
  },
  {
    id: "system-1023",
    author: "系统澄清",
    role: "system",
    time: "10:23",
    text: "失败场景有哪些？例如：账号不存在、密码错误、账户被锁定、网络异常等？每种场景是否需要不同的文案？"
  },
  {
    id: "pm-1024",
    author: "PM",
    role: "pm",
    time: "10:24",
    text: "先考虑这几种场景：账号不存在、密码错误、账户被锁定、网络异常，使用通用提示即可。"
  },
  {
    id: "system-1025",
    author: "系统澄清",
    role: "system",
    time: "10:25",
    text: "好的。针对“密码错误”，是否需要提示剩余尝试次数？如果需要，是否有具体的文案要求或格式？"
  },
  {
    id: "pm-1026",
    author: "PM",
    role: "pm",
    time: "10:26",
    text: "需要提示剩余次数，文案示例：“密码错误，您还有 {n} 次尝试机会。”"
  }
];

export const recommendedQuestions = [
  {
    title: "推荐澄清问题",
    text: "当账户被锁定时，是否需要提供解锁指引（如联系客服、等待时间），或仅提示已锁定？",
    reason: "账户锁定的处理方式会影响用户预期与后续操作路径，当前缺失具体策略与文案。"
  },
  {
    title: "推荐澄清问题",
    text: "网络异常时是否需要区分弱网、服务不可用和超时，还是统一提示稍后重试？",
    reason: "网络失败原因会影响重试建议和埋点分类，当前 DSL 还缺少可执行边界。"
  }
];

export const coverageItems = {
  covered: ["目标与范围", "主要用户场景（部分）", "成功标准（部分）", "非功能需求（部分）"],
  pending: ["失败场景（部分）", "用户提示文案（部分）", "验收标准（缺失）", "边界条件（部分）"]
};

export const risks = [
  {
    priority: "P0",
    key: "test_oracle_unclear",
    description: "验收标准不完整，影响可验证性",
    impact: "高影响"
  },
  {
    priority: "P1",
    key: "error_code_mapping",
    description: "错误码与提示文案映射不明确",
    impact: "中高影响"
  },
  {
    priority: "P1",
    key: "negative_case_missing",
    description: "负向场景覆盖不足",
    impact: "中影响"
  }
];

export const reportQuality = [
  { label: "可读性", value: 92 },
  { label: "边界清晰度", value: 84 },
  { label: "验收完整度", value: 68, tone: "warn" },
  { label: "风险覆盖", value: 76, tone: "pass" }
];

export const reportSections = {
  summary: {
    title: "登录失败提示优化",
    text: "当用户登录失败时，系统提供更清晰、可操作且符合安全要求的错误提示，帮助用户理解原因并采取下一步行动，减少重复尝试并降低客服咨询量。"
  },
  scope: {
    inScope: [
      "登录失败时的文案提示与展示逻辑",
      "常见失败原因的分类与文案规范",
      "提示的行动建议",
      "多端文案一致性"
    ],
    outOfScope: [
      "登录流程本身的改造",
      "安全策略调整",
      "第三方登录问题处理",
      "客服系统工单流程改造"
    ]
  },
  riskCards: [
    {
      title: "还需要确认什么",
      points: ["错误码与失败原因的完整映射", "账号锁定的处理方式与文案", "是否需要区分新用户与老用户的提示策略"]
    },
    {
      title: "当前主要风险",
      points: ["错误提示不当可能导致账号枚举风险", "文案不一致会增加用户困惑与客服压力", "关键错误场景缺失导致验收不完整"]
    },
    {
      title: "为什么暂不能 handoff",
      points: ["关键映射关系未确认", "验收标准未完全定义", "缺少部分边界条件的明确约定"]
    },
    {
      title: "下一步建议动作",
      points: ["与产品、研发、QA 对齐上述待确认项", "完善错误码映射与文案规范", "人工确认后再决定后续阶段"]
    }
  ]
};
