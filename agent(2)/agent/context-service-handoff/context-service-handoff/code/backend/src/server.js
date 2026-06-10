const express = require("express");
const cors = require("cors");
const path = require("node:path");
const { getConfig } = require("./config");
const { TaskStore } = require("./runtime/taskStore");
const { createAiRouter } = require("./routes/aiRoutes");
const { createContextHttpRouter } = require("./routes/contextHttpRoutes");

const config = getConfig();
const app = express();
const taskStore = new TaskStore(config.projectRoot);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "ai-super-individual" });
});

app.use("/api/ai", createAiRouter({ config, taskStore }));
app.use(createContextHttpRouter());

const distDirectory = path.join(config.projectRoot, "frontend/dist");
app.use(express.static(distDirectory));
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(distDirectory, "index.html"), (error) => {
    if (error) res.status(404).json({ error: "Not found" });
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.statusCode || 500).json({ error: error.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`AI orchestration API running on http://localhost:${config.port}`);
    console.log(`Target Conduit repo: ${config.conduitRepoPath}`);
  });
}

module.exports = { app };
