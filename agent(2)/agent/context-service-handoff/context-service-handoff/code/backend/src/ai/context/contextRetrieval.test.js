const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRepositoryIndex } = require("./repositoryIndexer");
const { retrieveContext } = require("./retriever");

function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("AI context retrieval", () => {
  test("indexes Conduit source files and retrieves a focused context slice", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-rag-"));
    writeFixture(
      repoRoot,
      "frontend/src/routes/Article/Article.jsx",
      "function Article(){ return body && <Markdown>{body}</Markdown>; }",
    );
    writeFixture(repoRoot, "backend/models/Article.js", "Article.init({ body: DataTypes.TEXT })");
    writeFixture(repoRoot, "node_modules/noise/index.js", "Article body word stats noise");
    writeFixture(repoRoot, ".git/config", "Article body word stats noise");

    const index = buildRepositoryIndex(repoRoot);
    const results = retrieveContext({
      query: "文章详情页新增字数统计",
      index,
      contextHints: ["frontend/src/routes/Article/Article.jsx", "Article.body"],
      limit: 2,
    });

    expect(index.map((entry) => entry.relativePath)).toContain(
      "frontend/src/routes/Article/Article.jsx",
    );
    expect(index.map((entry) => entry.relativePath)).not.toContain("node_modules/noise/index.js");
    expect(results[0].relativePath).toBe("frontend/src/routes/Article/Article.jsx");
    expect(results[0].snippet).toContain("Markdown");
  });
});
