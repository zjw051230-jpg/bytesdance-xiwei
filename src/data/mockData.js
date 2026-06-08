export const projects = [
  {
    name: "conduit-realworld-example-app",
    phase: "PM→DSL / Code Grounding / Verification Ready",
    status: "current",
    selected: true
  },
  { name: "payment-gateway", status: "warn", selected: false },
  { name: "user-service", status: "pass", selected: false },
  { name: "inventory-service", status: "pass", selected: false },
  { name: "ai-assistant", status: "fail", selected: false },
  { name: "analytics-platform", status: "info", selected: false }
];

export const runs = [
  { id: "RUN-20250524-0A7F", status: "pass", time: "刚刚完成" },
  { id: "RUN-20250524-08C3", status: "pass", time: "12 分钟前" },
  { id: "RUN-20250524-0741", status: "warn", time: "35 分钟前" },
  { id: "RUN-20250524-062D", status: "pass", time: "1 小时前" },
  { id: "RUN-20250524-0512", status: "fail", time: "2 小时前" }
];

export const pendingReports = [
  {
    title: "PM→DSL 质量报告",
    project: "conduit-realworld-example-app",
    time: "刚刚生成",
    status: "待审批",
    tone: "warn"
  },
  {
    title: "Runner 韧性报告",
    project: "conduit-realworld-example-app",
    time: "12 分钟前",
    status: "需复核",
    tone: "warn"
  },
  {
    title: "DB/API 验收报告",
    project: "payment-gateway",
    time: "35 分钟前",
    status: "待审批",
    tone: "warn"
  },
  {
    title: "Conduit 训练报告",
    project: "user-service",
    time: "1 小时前",
    status: "已退回",
    tone: "muted"
  }
];

export const currentProject = {
  name: "conduit-realworld-example-app",
  description: "Conduit RealWorld 示例应用的全栈实现",
  branch: "main",
  owner: "Horizon",
  updatedAt: "2025-05-24 14:32",
  status: "PASS"
};

export const metrics = [
  {
    label: "PM→DSL 质量",
    summary: "DSL 一致性",
    score: 96,
    status: "PASS",
    runId: "RUN-0A7F",
    points: [
      ["覆盖", "98%"],
      ["规范", "95%"]
    ]
  },
  {
    label: "Runner 韧性",
    summary: "恢复稳定性",
    score: 97,
    status: "PASS",
    runId: "RUN-08C3",
    points: [
      ["稳定", "97%"],
      ["恢复", "96%"]
    ]
  },
  {
    label: "Conduit 训练",
    summary: "数据泛化",
    score: 93,
    status: "PASS",
    runId: "RUN-0741",
    points: [
      ["数据", "92%"],
      ["成效", "94%"]
    ]
  },
  {
    label: "DB/API 验收",
    summary: "契约基线",
    score: 95,
    status: "PASS",
    runId: "RUN-062D",
    points: [
      ["覆盖", "96%"],
      ["契约", "95%"]
    ]
  }
];

export const checkpoints = [
  { label: "PM 需求解析", time: "05-24 13:45" },
  { label: "DSL 生成", time: "05-24 13:47" },
  { label: "DSL 评审", time: "05-24 13:50" },
  { label: "代码落地(骨架)", time: "05-24 13:58" },
  { label: "静态检查", time: "05-24 14:05" },
  { label: "单测生成", time: "05-24 14:12" },
  { label: "验证就绪", time: "05-24 14:28" }
];

export const timeline = [
  {
    id: "RUN-20250524-0A7F",
    task: "PM→DSL 质量检查",
    score: "96/100",
    status: "PASS",
    time: "14:32:18",
    duration: "2 分 31 秒",
    meta: "Horizon · main · 9c1e3b2"
  },
  {
    id: "RUN-20250524-08C3",
    task: "Runner 韧性评估",
    score: "97/100",
    status: "PASS",
    time: "14:19:42",
    duration: "3 分 18 秒",
    meta: "Webhook · main · 9c1e3b2"
  },
  {
    id: "RUN-20250524-0741",
    task: "Conduit 训练(MVP)",
    score: "93/100",
    status: "WARN",
    time: "13:44:07",
    duration: "18 分 42 秒",
    meta: "Horizon · main · 9c1e3b2"
  },
  {
    id: "RUN-20250524-062D",
    task: "DB/API 验收",
    score: "95/100",
    status: "PASS",
    time: "13:15:33",
    duration: "6 分 57 秒",
    meta: "Horizon · main · 9c1e3b2"
  },
  {
    id: "RUN-20250524-0512",
    task: "端到端验证",
    score: "68/100",
    status: "FAIL",
    time: "12:08:11",
    duration: "9 分 03 秒",
    meta: "API · main · 9c1e3b2"
  }
];

export const selectedTask = {
  runId: "RUN-20250524-0A7F",
  type: "PM→DSL 质量检查",
  owner: "Horizon",
  liveStatus: "进行中",
  status: "PASS",
  score: 96,
  duration: "2 分 31 秒",
  checkpoint: "DSL 生成(已完成)",
  report: {
    title: "PM→DSL 质量报告",
    status: "待审批",
    generatedAt: "2025-05-24 14:32:18",
    author: "Horizon"
  },
  artifacts: [
    { name: "12_final_dsl.json", size: "512 KB" },
    { name: "10_evpi_note.json", size: "214 KB" },
    { name: "13_case_summary.md", size: "128 KB" },
    { name: "error.json", size: "32 KB" }
  ],
  risks: [
    "训练数据缺失告警(低风险)",
    "部分实体样本覆盖率低于阈值(<85%)"
  ]
};
