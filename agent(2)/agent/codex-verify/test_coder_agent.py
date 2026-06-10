import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.coder_agent import generate_patch_plan
from agents.executor_agent import execute_patch_plan
from agents.locator_agent import locate_files
from agents.reviewer_agent import review_patch_plan
from agents.validator_agent import validate_patch
from interfaces.repo_adapter import RealRepoAdapter
from skills.registry import match_skill


class FakeLLMAdapter:
    def __init__(self, text, ok=True):
        self.text = text
        self.ok = ok

    def generate(self, prompt: str, system_prompt=None, temperature: float = 0.2):
        return {
            "ok": self.ok,
            "provider": "fake",
            "model": "fake-model",
            "text": self.text,
            "error": None if self.ok else "fake failure",
        }


class FakeRepoAdapter:
    def __init__(self, files):
        self.files = dict(files)

    def read_file(self, path):
        return {"ok": True, "path": path, "content": self.files.get(path, "")}


class CoderAgentTest(unittest.TestCase):
    def _cover_image_fullstack_files(self):
        return {
            "backend/models/Article.js": "const ArticleSchema = new Schema({\n  body: String,\n});\n",
            "frontend/src/services/setArticle.js": (
                "async function setArticle({ body, description, headers, slug, tagList, title }) {\n"
                "  return client.post('/articles', { article: { title, description, body, tagList } });\n"
                "}\n"
            ),
            "frontend/src/services/getArticle.js": "export const getArticle = ({ slug }) => client.get(`/articles/${slug}`);\n",
            "frontend/src/routes/Article/Article.jsx": (
                "export default function Article({ article }) {\n"
                "  const { title, body } = article;\n"
                "  return <article><h1>{title}</h1><p>{body}</p></article>;\n"
                "}\n"
            ),
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx": (
                "const initialState = {\n"
                "  title: \"\",\n"
                "  description: \"\",\n"
                "  body: \"\",\n"
                "  tagList: [],\n"
                "};\n\n"
                "export default function ArticleEditorForm({ article, headers, slug }) {\n"
                "  const [form, setForm] = useState({ ...initialState, ...article });\n"
                "  const { title, description, body, tagList } = form;\n"
                "  const handleSubmit = () => setArticle({ title, description, body, tagList, headers, slug });\n"
                "  return (\n"
                "    <form onSubmit={handleSubmit}>\n"
                "      <textarea name=\"body\" value={body} />\n"
                "      <button type=\"submit\">Publish</button>\n"
                "    </form>\n"
                "  );\n"
                "}\n"
            ),
        }

    def test_generate_patch_plan_for_article_word_stats(self):
        patch_plan = generate_patch_plan("文章详情页新增字数统计", {"name": "article-word-stats"}, None, None)

        self.assertIn("frontend/src/pages/Article.jsx", [item["file"] for item in patch_plan["patches"]])
        self.assertTrue(any("word count" in change.lower() for change in patch_plan["patches"][0]["changes"]))
        self.assertTrue(any("reading time" in change.lower() for change in patch_plan["patches"][0]["changes"]))

    def test_generate_patch_plan_prefers_located_file(self):
        patch_plan = generate_patch_plan(
            "add reading time",
            {"name": "article-word-stats"},
            None,
            {
                "located": True,
                "files": [
                    {
                        "relative_path": "src/article_view.jsx",
                        "score": 8,
                    }
                ],
            },
        )

        self.assertEqual(patch_plan["patches"][0]["file"], "src/article_view.jsx")

    def test_generate_patch_plan_for_about_me_tab(self):
        patch_plan = generate_patch_plan("个人主页新增About Me Tab", {"name": "about-me-tab"}, None, None)

        self.assertIn("Profile.jsx", patch_plan["patches"][0]["file"])

    def test_generate_patch_plan_for_cover_image(self):
        patch_plan = generate_patch_plan("给文章增加封面图", {"name": "cover-image"}, None, None)

        self.assertEqual(patch_plan["patches"], [])
        self.assertEqual(patch_plan["metadata"]["error"], "missing_located_files")

    def test_l2_cover_image_does_not_generate_todo_and_uses_located_files(self):
        files = {
            "backend/models/article.js": "const ArticleSchema = new Schema({\n  body: String,\n});\n",
            "backend/controllers/articles.js": "const createArticle = (req) => {\n  const { title, body } = req.body;\n  return { title, body };\n};\n",
            "frontend/src/services/setArticle.js": "export const setArticle = ({ title, body }) => client.post('/articles', { title, body });\n",
            "frontend/src/services/getArticle.js": "export const getArticle = ({ slug }) => client.get(`/articles/${slug}`);\n",
            "frontend/src/routes/Article/Article.jsx": (
                "export default function Article({ article }) {\n"
                "  const { title, body } = article;\n"
                "  return <article><h1>{title}</h1><p>{body}</p></article>;\n"
                "}\n"
            ),
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx": (
                "export default function ArticleEditorForm({ article }) {\n"
                "  const [body, setBody] = useState(article?.body || \"\");\n"
                "  return <form><textarea value={body} onChange={(event) => setBody(event.target.value)} /></form>;\n"
                "}\n"
            ),
            "frontend/src/components/LoginForm.jsx": "export default function LoginForm() { return <form />; }\n",
            "frontend/src/components/SignUpForm.jsx": "export default function SignUpForm() { return <form />; }\n",
            "frontend/src/components/SettingsForm.jsx": "export default function SettingsForm() { return <form />; }\n",
            "frontend/src/components/CommentEditor.jsx": "export default function CommentEditor() { return <form />; }\n",
        }
        located = {"located": True, "files": [{"relative_path": path} for path in files]}
        skill = match_skill("add article cover image")["skill"]

        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            located,
            repo_adapter=FakeRepoAdapter(files),
        )

        patch_files = [patch["file"] for patch in patch_plan["patches"]]
        self.assertTrue(patch_plan["patches"])
        self.assertLessEqual(len(patch_plan["patches"]), 6)
        self.assertTrue(set(patch_files).issubset(set(files)))
        self.assertNotIn("frontend/src/components/LoginForm.jsx", patch_files)
        self.assertNotIn("frontend/src/components/SignUpForm.jsx", patch_files)
        self.assertNotIn("frontend/src/components/SettingsForm.jsx", patch_files)
        self.assertNotIn("frontend/src/components/CommentEditor.jsx", patch_files)
        self.assertFalse(any("TODO" in patch.get("after_snippet", "") for patch in patch_plan["patches"]))
        self.assertTrue(any("coverImage" in patch.get("after_snippet", "") for patch in patch_plan["patches"]))
        roles = [patch["role"] for patch in patch_plan["patches"]]
        self.assertEqual(len(roles), len(set(roles)))

    def test_l2_cover_image_missing_role_enters_missing_roles(self):
        files = {
            "backend/models/article.js": "const ArticleSchema = new Schema({\n  body: String,\n});\n",
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx": (
                "export default function ArticleEditorForm({ article }) {\n"
                "  const [body, setBody] = useState(article?.body || \"\");\n"
                "  return <form><textarea value={body} onChange={(event) => setBody(event.target.value)} /></form>;\n"
                "}\n"
            ),
        }
        skill = match_skill("add article cover image")["skill"]

        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )

        self.assertIn("api_write", patch_plan["missing_roles"])
        self.assertIn("article_detail", patch_plan["missing_roles"])
        self.assertNotIn("api_read", patch_plan["missing_roles"])
        self.assertFalse(any("TODO" in patch.get("after_snippet", "") for patch in patch_plan["patches"]))

    def test_cover_image_selects_article_editor_form_as_editor_form(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]

        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )

        self.assertEqual(
            patch_plan["role_assignments"]["editor_form"],
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
        )

    def test_cover_image_missing_roles_empty_when_article_editor_form_exists(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]

        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )

        self.assertEqual(patch_plan["missing_roles"], [])
        self.assertIn("editor_form", patch_plan["role_assignments"])
        self.assertNotIn("api_read", patch_plan["role_assignments"])

    def test_cover_image_does_not_patch_unused_get_article_helper(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]

        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )

        patch_files = [patch.get("file") for patch in patch_plan["patches"]]
        self.assertNotIn("frontend/src/services/getArticle.js", patch_files)
        self.assertFalse(any("withCoverImage" in patch.get("after_snippet", "") for patch in patch_plan["patches"]))
        self.assertEqual(len(patch_plan["patches"]), 4)

    def test_editor_form_patch_adds_input_and_payload_field(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]

        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )

        editor_patch = next(patch for patch in patch_plan["patches"] if patch.get("role") == "editor_form")
        after = editor_patch["after_snippet"]
        self.assertIn("coverImage", after)
        self.assertIn("name=\"coverImage\"", after)
        self.assertIn("setForm((form) => ({ ...form, coverImage: event.target.value }))", after)
        self.assertNotIn("const [coverImage", after)
        self.assertIn("setArticle({ title, description, body, tagList, headers, slug, coverImage })", after)

    def test_editor_form_cover_image_patch_syntax_valid(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]
        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )

        validation = validate_patch(patch_plan)

        self.assertTrue(validation["approved"], validation["errors"])

    def test_empty_form_cover_image_inside_object(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]
        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )
        editor_patch = next(patch for patch in patch_plan["patches"] if patch.get("role") == "editor_form")
        after = editor_patch["after_snippet"]

        self.assertRegex(after, r"body:\s*\"\",\n\s*coverImage:\s*\"\",")
        self.assertNotRegex(after, r"\};\ncoverImage:")

    def test_no_const_cover_image_inside_use_state_arguments(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]
        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )
        editor_patch = next(patch for patch in patch_plan["patches"] if patch.get("role") == "editor_form")
        after = editor_patch["after_snippet"]

        self.assertNotRegex(after, r"useState\s*\([^)]*\bconst\b")

    def test_model_uses_data_types_string(self):
        files = self._cover_image_fullstack_files()
        files["backend/models/Article.js"] = (
            "module.exports = (sequelize, DataTypes) => {\n"
            "  Article.init(\n"
            "    {\n"
            "      description: DataTypes.TEXT,\n"
            "      body: DataTypes.TEXT,\n"
            "    },\n"
            "    { sequelize },\n"
            "  );\n"
            "};\n"
        )
        skill = match_skill("add article cover image")["skill"]
        patch_plan = generate_patch_plan(
            "add article cover image",
            skill,
            {"scope": "conduit_fullstack"},
            {"located": True, "files": [{"relative_path": path} for path in files]},
            repo_adapter=FakeRepoAdapter(files),
        )
        model_patch = next(patch for patch in patch_plan["patches"] if patch.get("role") == "model")

        self.assertIn("coverImage: DataTypes.STRING,", model_patch["after_snippet"])
        self.assertNotIn("coverImage: { type: String }", model_patch["after_snippet"])

    def test_cover_image_real_located_files_select_editor_form(self):
        files = self._cover_image_fullstack_files()
        skill = match_skill("add article cover image")["skill"]
        with tempfile.TemporaryDirectory() as repo_root:
            for path, content in files.items():
                target = Path(repo_root) / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            repo = RealRepoAdapter(repo_root)
            located = locate_files(
                {
                    "target_files_hint": [],
                    "target_file_patterns": skill["conduit_backend_patterns"] + skill["conduit_frontend_patterns"],
                    "metadata": {"conduit_scope": "fullstack"},
                },
                skill,
                repo_adapter=repo,
                user_input="add cover image",
                repo_profile={"repo_type": "conduit"},
            )

            patch_plan = generate_patch_plan(
                "add article cover image",
                skill,
                {"scope": "conduit_fullstack"},
                located,
                repo_adapter=repo,
            )

        self.assertEqual(
            patch_plan["role_assignments"].get("editor_form"),
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
        )
        self.assertEqual(patch_plan["missing_roles"], [])
        self.assertTrue(
            any(
                patch.get("role") == "editor_form"
                and patch.get("file") == "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx"
                for patch in patch_plan.get("code_patches", [])
            )
        )

    def test_generate_structured_create_file_patch(self):
        patch_plan = generate_patch_plan("创建 note.txt 文件，内容为 100", None, None, None)

        patch_item = patch_plan["patches"][0]
        self.assertEqual(patch_item["operation"], "create_file")
        self.assertEqual(patch_item["path"], "note.txt")
        self.assertEqual(patch_item["content"], "100")

    def test_generate_structured_create_file_patch_from_lossy_powershell_pipe(self):
        patch_plan = generate_patch_plan("?? note.txt ?????? 100", None, None, None)

        patch_item = patch_plan["patches"][0]
        self.assertEqual(patch_item["operation"], "create_file")
        self.assertEqual(patch_item["path"], "note.txt")
        self.assertEqual(patch_item["content"], "100")

    def test_generate_patch_plan_uses_llm_when_enabled_and_json_valid(self):
        llm = FakeLLMAdapter('{"patches":[{"operation":"create_file","path":"note.txt","content":"100"}]}')

        with patch.dict("os.environ", {"AGENT_USE_LLM_CODER": "1"}, clear=True):
            patch_plan = generate_patch_plan("create note", None, None, None, llm_adapter=llm)

        patch_item = patch_plan["patches"][0]
        self.assertEqual(patch_item["operation"], "create_file")
        self.assertEqual(patch_item["path"], "note.txt")
        self.assertEqual(patch_item["content"], "100")
        self.assertEqual(patch_plan["metadata"]["coder"], "llm")

    def test_generate_patch_plan_rejects_llm_path_outside_located_files(self):
        llm = FakeLLMAdapter('{"patches":[{"operation":"create_file","path":"note.txt","content":"100"}]}')
        located_files = {
            "located": True,
            "files": [{"relative_path": "frontend/src/components/LoginForm/index.js"}],
        }

        with patch.dict("os.environ", {"AGENT_USE_LLM_CODER": "1"}, clear=True):
            patch_plan = generate_patch_plan("add remember password checkbox", None, None, located_files, llm_adapter=llm)

        self.assertEqual(patch_plan["metadata"]["llm_coder_fallback_reason"], "path_not_in_located_files")
        self.assertEqual(patch_plan["patches"][0]["file"], "frontend/src/components/LoginForm/index.js")

    def test_login_auth_skill_generates_remember_credentials_code_patch(self):
        skill = match_skill(
            "add remember account and password checkbox to login page",
            requirement_dsl={"requirement_type": "conduit_l1_frontend", "target_modules": ["frontend/src"]},
        )["skill"]
        repo = FakeRepoAdapter(
            {
                "frontend/src/components/LoginForm/LoginForm.jsx": (
                    "import { useState } from \"react\";\n"
                    "import { useNavigate } from \"react-router-dom\";\n"
                    "import { useAuth } from \"../../context/AuthContext\";\n"
                    "import userLogin from \"../../services/userLogin\";\n"
                    "import FormFieldset from \"../FormFieldset\";\n\n"
                    "function LoginForm({ onError }) {\n"
                    "  const [{ email, password }, setForm] = useState({ email: \"\", password: \"\" });\n"
                    "  const { setAuthState } = useAuth();\n"
                    "  const navigate = useNavigate();\n\n"
                    "  const handleSubmit = (e) => {\n"
                    "    e.preventDefault();\n\n"
                    "    userLogin({ email, password })\n"
                    "      .then(setAuthState)\n"
                    "      .then(() => navigate(\"/\"))\n"
                    "      .catch(onError);\n"
                    "  };\n\n"
                    "  return (\n"
                    "    <form onSubmit={handleSubmit}>\n"
                    "      <button className=\"btn btn-lg btn-primary pull-xs-right\">Login</button>\n"
                    "    </form>\n"
                    "  );\n"
                    "}\n\n"
                    "export default LoginForm;\n"
                )
            }
        )

        patch_plan = generate_patch_plan(
            "add remember account and password checkbox to login page",
            skill,
            None,
            {"located": True, "files": [{"relative_path": "frontend/src/components/LoginForm/LoginForm.jsx"}]},
            repo_adapter=repo,
        )

        patch = patch_plan["patches"][0]
        self.assertEqual(skill["id"], "conduit-login-auth")
        self.assertEqual(patch["file"], "frontend/src/components/LoginForm/LoginForm.jsx")
        self.assertIn("REMEMBER_LOGIN_KEY", patch["after_snippet"])
        self.assertIn("remember-login-checkbox", patch["after_snippet"])
        self.assertIn("window.localStorage.setItem", patch["after_snippet"])

    def test_generate_patch_plan_falls_back_when_llm_json_invalid(self):
        llm = FakeLLMAdapter("not json")

        with patch.dict("os.environ", {"AGENT_USE_LLM_CODER": "1"}, clear=True):
            patch_plan = generate_patch_plan("unknown task", None, None, None, llm_adapter=llm)

        self.assertIn("llm_coder_fallback_reason", patch_plan["metadata"])
        self.assertIn("changes", patch_plan["patches"][0])

    def test_generate_patch_plan_rejects_dangerous_llm_operation(self):
        llm = FakeLLMAdapter('{"patches":[{"operation":"delete_file","path":"note.txt","content":"100"}]}')

        with patch.dict("os.environ", {"AGENT_USE_LLM_CODER": "1"}, clear=True):
            patch_plan = generate_patch_plan("delete note", None, None, None, llm_adapter=llm)

        self.assertEqual(patch_plan["metadata"]["llm_coder_fallback_reason"], "unsupported_operation")
        self.assertNotIn("operation", patch_plan["patches"][0])

    def test_matched_skill_fields_enter_patch_plan(self):
        skill = match_skill("please add reading time to article page")["skill"]

        patch_plan = generate_patch_plan("please add reading time to article page", skill, None, None)

        self.assertEqual(patch_plan["metadata"]["coder"], "skill_registry")
        self.assertEqual(patch_plan["metadata"]["skill_id"], "article-word-stats")
        self.assertIn("Article detail page shows word count", patch_plan["acceptance_template"])
        self.assertTrue(any("reading time" in item.lower() for item in patch_plan["patches"][0]["changes"]))

    def test_code_patch_generation(self):
        skill = match_skill("please add word count and reading time to article page")["skill"]
        repo = FakeRepoAdapter(
            {
                "frontend/src/pages/Article.jsx": (
                    "export default function Article({ article }) {\n"
                    "  return <div>{article.body}</div>;\n"
                    "}\n"
                )
            }
        )

        patch_plan = generate_patch_plan(
            "please add word count and reading time to article page",
            skill,
            None,
            {"located": True, "files": [{"relative_path": "frontend/src/pages/Article.jsx"}]},
            repo_adapter=repo,
        )

        patch_item = patch_plan["patches"][0]
        self.assertEqual(patch_item["operation"], "replace")
        self.assertIn("before_snippet", patch_item)
        self.assertIn("after_snippet", patch_item)
        self.assertIn("diff", patch_item)
        self.assertIn("wordCount", patch_item["after_snippet"])
        self.assertIn("+  const wordCount", patch_item["diff"])

    def test_article_word_stats_code_patch_validates_reviews_and_dry_runs(self):
        source = (
            "import { useEffect, useState } from \"react\";\n"
            "import ReactMarkdown from \"react-markdown\";\n"
            "import ArticleTags from \"../../components/ArticleTags\";\n\n"
            "export default function Article() {\n"
            "  const [article, setArticle] = useState(null);\n\n"
            "  useEffect(() => {\n"
            "    setArticle({ body: \"hello world\", tagList: [\"demo\"] });\n"
            "  }, []);\n\n"
            "  if (!article) return null;\n\n"
            "  const { body, tagList } = article;\n\n"
            "  return (\n"
            "    <article>\n"
            "      <ReactMarkdown>{body}</ReactMarkdown>\n"
            "      <ArticleTags tagList={tagList} />\n"
            "    </article>\n"
            "  );\n"
            "}\n"
        )
        skill = match_skill("please add word count and reading time to article page")["skill"]
        repo = FakeRepoAdapter({"frontend/src/pages/Article.jsx": source})

        patch_plan = generate_patch_plan(
            "please add word count and reading time to article page",
            skill,
            {"acceptance_criteria": ["shows word count", "shows reading time"]},
            {"located": True, "files": [{"relative_path": "frontend/src/pages/Article.jsx"}]},
            repo_adapter=repo,
        )
        patch_item = patch_plan["patches"][0]
        after = patch_item["after_snippet"]

        validation = validate_patch(patch_plan)
        review = review_patch_plan(
            {"acceptance_criteria": ["shows word count", "shows reading time"]},
            {"located": True, "files": [{"relative_path": "frontend/src/pages/Article.jsx"}]},
            patch_plan,
            matched_skill=skill,
            validation_result=validation,
        )

        self.assertTrue(validation["approved"], validation["errors"])
        self.assertNotIn("jsx_outside_return", [error["code"] for error in validation["errors"]])
        self.assertNotIn("react_hook_outside_function", [error["code"] for error in validation["errors"]])
        self.assertTrue(review["approved"], review["issues"])
        self.assertLess(after.index("const articleBodyText"), after.index("return ("))
        self.assertLess(after.index("useEffect"), after.index("const articleBodyText"))
        self.assertLess(after.index("const wordCount"), after.index("return ("))
        self.assertLess(after.index("<ReactMarkdown>{body}</ReactMarkdown>"), after.index("<p className=\"article-stats\">"))
        self.assertLess(after.index("<p className=\"article-stats\">"), after.index("<ArticleTags"))
        function_body_before_return = after[: after.index("return (")]
        self.assertNotIn("<p className=\"article-stats\">", function_body_before_return)

        with tempfile.TemporaryDirectory() as repo_root:
            target = Path(repo_root) / "frontend" / "src" / "pages" / "Article.jsx"
            target.parent.mkdir(parents=True)
            target.write_text(source, encoding="utf-8")
            execution = execute_patch_plan(
                patch_plan,
                review,
                repo_adapter=RealRepoAdapter(repo_root),
            )

        self.assertTrue(execution["executed"])
        self.assertEqual(execution["files"][0]["status"], "dry_run")
        self.assertIn("dry_run_diff", execution["files"][0])
        self.assertIn("article-stats", execution["files"][0]["dry_run_diff"])


if __name__ == "__main__":
    unittest.main()
