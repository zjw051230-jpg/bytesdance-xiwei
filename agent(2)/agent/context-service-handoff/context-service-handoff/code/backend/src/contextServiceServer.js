const express = require("express");
const cors = require("cors");
const path = require("node:path");
const { createAgentRunRouter } = require("./routes/agentRunRoutes");
const { createContextHttpRouter } = require("./routes/contextHttpRoutes");

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(createAgentRunRouter());
app.use(createContextHttpRouter());
app.use(express.static(path.join(__dirname, "..", "public")));

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Context Service running on http://127.0.0.1:${port}`);
  });
}

module.exports = { app };
