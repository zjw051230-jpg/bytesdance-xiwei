export const planningData = {
  requirementTitle: "登录失败提示优化",
  status: "进行中",
  goal: "补齐失败场景、用户提示、验收标准，提升错误可见性与可操作性",
  currentStage: "方案设计",
  owner: "PM（产品经理）",
  roles: ["Codex", "前端", "后端", "测试"]
};

export const milestones = [
  {
    name: "需求确认",
    description: "明确问题与目标，收集相关约束与参考",
    date: "2024-05-20",
    status: "completed"
  },
  {
    name: "方案设计",
    description: "完成方案设计与评审，确认技术路径",
    date: "2024-05-23",
    status: "active"
  },
  {
    name: "开发中",
    description: "核心功能开发与单元测试",
    date: "2024-05-24",
    status: "pending"
  },
  {
    name: "联调",
    description: "与依赖系统联调，问题修复",
    date: "2024-05-28",
    status: "pending"
  },
  {
    name: "待验收",
    description: "验证验收标准，确认上线条件",
    date: "2024-05-30",
    status: "pending"
  }
];

export const taskBreakdown = [
  { task: "明确登录失败场景与错误码映射", owner: "PM", status: "completed", due: "05-20" },
  { task: "设计错误提示文案与展示规则", owner: "设计师", status: "active", due: "05-24" },
  { task: "前端提示组件开发", owner: "前端工程师", status: "pending", due: "05-26" },
  { task: "后端错误码规范落地", owner: "后端工程师", status: "blocked", due: "05-26" },
  { task: "单元测试与异常用例补充", owner: "测试工程师", status: "pending", due: "05-28" },
  { task: "联调验证与问题修复", owner: "联调工程师", status: "pending", due: "05-29" },
  { task: "验收与上线准备", owner: "PM", status: "pending", due: "05-30" }
];

export const executionFeedback = [
  {
    time: "今天 10:22",
    stage: "方案设计",
    text: "已完成错误提示文案初稿评审，等待设计稿输出",
    tone: "active"
  },
  {
    time: "昨天 17:18",
    stage: "开发中",
    text: "后端错误码规范与现有接口存在冲突，需确认处理方案",
    tone: "blocked",
    badge: "阻塞中"
  },
  {
    time: "05-20 16:45",
    stage: "需求确认",
    text: "已确认登录失败相关 8 种场景及优先级",
    tone: "completed",
    link: "查看详情"
  }
];

export const planningSummary = {
  completion: 45,
  stats: [
    { label: "已完成", count: 3, percent: 30, status: "completed" },
    { label: "进行中", count: 2, percent: 20, status: "active" },
    { label: "未开始", count: 4, percent: 40, status: "pending" },
    { label: "阻塞", count: 1, percent: 10, status: "blocked" }
  ],
  currentStage: {
    name: "方案设计",
    description: "正在完善方案细节与评审材料，预计 1 天内完成",
    due: "05-23"
  }
};

export const risks = {
  blockers: [
    "后端错误码规范与现有接口存在冲突，需确认处理方案"
  ],
  watched: [
    "提示文案与多语言规范未最终确认",
    "联调环境依赖的第三方接口不稳定"
  ]
};

export const nextActions = [
  { text: "完成提示文案与设计稿输出", priority: "高优先级", status: "completed" },
  { text: "确认错误码规范与接口兼容方案", priority: "高优先级", status: "completed" },
  { text: "启动前端组件开发", priority: "中优先级", status: "pending" }
];

export const planningStatusLabels = {
  completed: "已完成",
  active: "进行中",
  pending: "未开始",
  blocked: "阻塞",
  review: "待审阅"
};
