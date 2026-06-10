import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.coder_agent import generate_patch_plan
from agents.reviewer_agent import review_patch_plan
from agents.validator_agent import validate_patch
from patches.code_patch import build_code_patch
from skills.registry import match_skill


class FakeRepoAdapter:
    def __init__(self, files):
        self.files = dict(files)

    def read_file(self, path):
        return {"ok": True, "path": path, "content": self.files.get(path, "")}


class PatchValidationTest(unittest.TestCase):
    def test_patch_validation_success(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return <main />;\n}\n",
            "export default function Article() {\n  const title = 'Ready';\n  return <main>{title}</main>;\n}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Valid JSX patch"})

        self.assertTrue(result["approved"])
        self.assertTrue(result["syntax_valid"])
        self.assertEqual(result["errors"], [])

    def test_patch_validation_fail_jsx(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return <main />;\n}\n",
            "export default function Article() {\n  const title = 'Broken';\n  <section>{title}</section>\n  return <main />;\n}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid JSX patch"})

        self.assertFalse(result["approved"])
        self.assertFalse(result["syntax_valid"])
        self.assertTrue(any(error["code"] == "jsx_outside_return" for error in result["errors"]))

    def test_multiline_return_jsx_passes(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "export default function Article() {\n"
            "  return (\n"
            "    <div className=\"article-page\">\n"
            "      <h1>{title}</h1>\n"
            "    </div>\n"
            "  );\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Valid multiline return JSX"})

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "jsx_outside_return" for error in result["errors"]))

    def test_conditional_jsx_inside_return_passes(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "export default function Article({ coverImage }) {\n"
            "  return (\n"
            "    <div>\n"
            "      {coverImage ? (\n"
            "        <img src={coverImage} alt=\"cover\" />\n"
            "      ) : null}\n"
            "    </div>\n"
            "  );\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Valid conditional JSX"})

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "jsx_outside_return" for error in result["errors"]))

    def test_self_closing_img_inside_return_passes(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "export default function Article({ coverImage, title }) {\n"
            "  return (\n"
            "    <article>\n"
            "      <img className=\"article-cover-image\" src={coverImage} alt={title || \"Article cover\"} />\n"
            "    </article>\n"
            "  );\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Valid self-closing JSX"})

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "jsx_outside_return" for error in result["errors"]))

    def test_jsx_after_return_block_fails(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "export default function Article() {\n"
            "  return (\n"
            "    <div />\n"
            "  );\n"
            "  <p>bad</p>\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid JSX after return"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "jsx_outside_return" for error in result["errors"]))

    def test_article_cover_image_article_detail_patch_validates(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "function Article({ article }) {\n"
            "  const { title, coverImage, author, createdAt, body } = article || {};\n"
            "  return (\n"
            "    <div className=\"article-page\">\n"
            "      <BannerContainer>\n"
            "        <h1>{title}</h1>\n"
            "        {coverImage ? (\n"
            "          <img className=\"article-cover-image\" src={coverImage} alt={title || \"Article cover\"} />\n"
            "        ) : null}\n"
            "        <ArticleMeta author={author} createdAt={createdAt}>\n"
            "          <span>demo</span>\n"
            "        </ArticleMeta>\n"
            "      </BannerContainer>\n"
            "      <ReactMarkdown>{body}</ReactMarkdown>\n"
            "    </div>\n"
            "  );\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Valid article cover image JSX"})

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "jsx_outside_return" for error in result["errors"]))

    def test_invalid_editor_form_diff_validation_false(self):
        patch = build_code_patch(
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
            "export default function ArticleEditorForm() {\n  return null;\n}\n",
            "const emptyForm = { title: \"\", description: \"\", body: \"\", tagList: \"\" };\n"
            "coverImage: \"\",\n\n"
            "export default function ArticleEditorForm({ state }) {\n"
            "  const [{ title, description, body, tagList }, setForm] = useState(\n"
            "    const [coverImage, setCoverImage] = useState(article?.coverImage || \"\");\n"
            "    state || emptyForm,\n"
            "  );\n"
            "  return null;\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid editor form cover image patch"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "js_naked_object_property" for error in result["errors"]))
        self.assertTrue(any(error["code"] == "js_const_inside_call_args" for error in result["errors"]))

    def test_legal_use_state_destructure_with_cover_image_passes(self):
        patch = build_code_patch(
            "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
            "export default function ArticleEditorForm() {\n  return null;\n}\n",
            "const emptyForm = { title: \"\", description: \"\", body: \"\", tagList: \"\", coverImage: \"\" };\n\n"
            "export default function ArticleEditorForm({ state }) {\n"
            "  const [{ coverImage }, setForm] = useState(state || emptyForm);\n"
            "  return null;\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Valid useState destructure"})

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "js_const_inside_call_args" for error in result["errors"]))

    def test_invalid_sequelize_string_type_validation_false(self):
        patch = build_code_patch(
            "backend/models/Article.js",
            "module.exports = (sequelize, DataTypes) => ({ body: DataTypes.TEXT });\n",
            "module.exports = (sequelize, DataTypes) => ({\n"
            "  description: DataTypes.TEXT,\n"
            "  coverImage: { type: String },\n"
            "  body: DataTypes.TEXT,\n"
            "});\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid Sequelize cover image field"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "sequelize_invalid_string_type" for error in result["errors"]))

    def test_patch_validation_fail_python(self):
        patch = build_code_patch(
            "agent_core/example.py",
            "def run():\n    return 1\n",
            "def run(:\n    return 1\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid Python patch"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "python_syntax_error" for error in result["errors"]))

    def test_todo_code_patch_validation_fails(self):
        patch = build_code_patch(
            "backend/models/article.js",
            "const Article = {};\n",
            "const Article = {};\n// TODO: Add cover image field\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid TODO patch"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "todo_code_patch" for error in result["errors"]))

    def test_validator_only_validates_code_patches_not_located_candidates(self):
        good_patch = build_code_patch(
            "frontend/src/routes/Article/Article.jsx",
            "export default function Article() {\n  return <article />;\n}\n",
            "export default function Article() {\n  return <article><img src={coverImage} /></article>;\n}\n",
        )
        bad_candidate = build_code_patch(
            "frontend/src/components/LoginForm.jsx",
            "export default function LoginForm() {\n  return <form />;\n}\n",
            "export default function LoginForm() {\n  <div />\n  return <form />;\n}\n",
        )

        result = validate_patch(
            {
                "patches": [good_patch, bad_candidate],
                "code_patches": [good_patch],
                "summary": "Only code_patches should be validated",
            }
        )

        self.assertTrue(result["approved"], result["errors"])

    def test_react_hooks_inside_function_component_pass(self):
        before = "export default function Article() {\n  return null;\n}\n"
        after = (
            "export default function Article() {\n"
            "  const { state } = useLocation();\n"
            "  const [article, setArticle] = useState(state || {});\n"
            "  const { title, body, tagList, createdAt, author } = article || {};\n"
            "  const { headers, isAuth } = useAuth();\n"
            "  const navigate = useNavigate();\n"
            "  const { slug } = useParams();\n\n"
            "  useEffect(() => {\n"
            "    if (!isAuth) {\n"
            "      navigate('/login');\n"
            "    }\n"
            "  }, [isAuth, slug, headers, state, navigate]);\n\n"
            "  const articleBodyText = String(body || \"\");\n"
            "  const wordCount = articleBodyText.trim()\n"
            "    ? articleBodyText.trim().split(/\\s+/).length\n"
            "    : 0;\n"
            "  const readingTime = Math.max(1, Math.ceil(wordCount / 200));\n\n"
            "  return (\n"
            "    <article>\n"
            "      <ReactMarkdown>{body}</ReactMarkdown>\n"
            "      <p className=\"article-stats\">\n"
            "        {wordCount} words &middot; {readingTime} min read\n"
            "      </p>\n"
            "      <ArticleTags tagList={tagList} />\n"
            "    </article>\n"
            "  );\n"
            "}\n"
        )
        patch = build_code_patch("frontend/src/pages/Article.jsx", before, after)

        result = validate_patch({"patches": [patch], "summary": "Valid component hooks"})

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "react_hook_outside_function" for error in result["errors"]))

    def test_react_hook_module_top_level_fails(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "const [article, setArticle] = useState({});\n\nexport default function Article() {\n  return null;\n}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid top-level hook"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "react_hook_outside_function" for error in result["errors"]))

    def test_react_hook_inside_if_fails(self):
        patch = build_code_patch(
            "frontend/src/pages/Article.jsx",
            "export default function Article() {\n  return null;\n}\n",
            "export default function Article() {\n"
            "  if (ready) {\n"
            "    const [article, setArticle] = useState({});\n"
            "  }\n"
            "  return null;\n"
            "}\n",
        )

        result = validate_patch({"patches": [patch], "summary": "Invalid conditional hook"})

        self.assertFalse(result["approved"])
        self.assertTrue(any(error["code"] == "react_hook_in_control_flow" for error in result["errors"]))

    def test_article_word_stats_patch_validation_passes(self):
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
        patch_plan = generate_patch_plan(
            "please add word count and reading time to article page",
            skill,
            {"acceptance_criteria": ["shows word count", "shows reading time"]},
            {"located": True, "files": [{"relative_path": "frontend/src/pages/Article.jsx"}]},
            repo_adapter=FakeRepoAdapter({"frontend/src/pages/Article.jsx": source}),
        )

        result = validate_patch(patch_plan)

        self.assertTrue(result["approved"], result["errors"])
        self.assertFalse(any(error["code"] == "jsx_outside_return" for error in result["errors"]))
        self.assertFalse(any(error["code"] == "react_hook_outside_function" for error in result["errors"]))

    def test_review_blocked_when_validation_failed(self):
        validation_result = {
            "approved": False,
            "syntax_valid": False,
            "errors": [{"file": "frontend/src/pages/Article.jsx", "code": "jsx_outside_return", "message": "JSX appears outside return"}],
            "warnings": [],
        }

        review = review_patch_plan(
            None,
            None,
            {"summary": "Patch", "patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Add JSX"]}]},
            validation_result=validation_result,
        )

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertIn("Patch validation failed", review["issues"])


if __name__ == "__main__":
    unittest.main()
