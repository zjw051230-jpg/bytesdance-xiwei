import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.reviewer_agent import review_patch_plan
from skills.registry import match_skill


class ReviewerAgentTest(unittest.TestCase):
    def test_review_patch_plan_accepts_article_word_stats(self):
        review = review_patch_plan(
            {"acceptance_criteria": ["shows word count", "shows reading time"]},
            None,
            {
                "summary": "Prepare article word count and reading time display",
                "patches": [
                    {"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count calculation", "Add reading time calculation"], "risk_level": "low"}
                ],
            },
        )

        self.assertTrue(review["approved"])
        self.assertEqual(review["risk_level"], "low")

    def test_review_patch_plan_rejects_dangerous_file(self):
        review = review_patch_plan(
            None,
            None,
            {"patches": [{"file": "frontend/src/pages/Article.test.js", "changes": ["unsafe"], "risk_level": "high"}]},
        )

        self.assertFalse(review["approved"])
        self.assertIn("Dangerous file in patch plan: frontend/src/pages/Article.test.js", review["issues"])

    def test_review_patch_plan_checks_located_file_match(self):
        review = review_patch_plan(
            None,
            {
                "located": True,
                "files": [
                    {
                        "relative_path": "src/article_view.jsx",
                    }
                ],
            },
            {
                "patches": [
                    {
                        "file": "src/article_view.jsx",
                        "changes": ["Add reading time"],
                        "risk_level": "low",
                    }
                ]
            },
        )

        self.assertTrue(review["checks"]["matches_located_files"])

    def test_missing_located_file_review_false(self):
        review = review_patch_plan(
            None,
            {"located": True, "files": [{"relative_path": "frontend/src/routes/Article/Article.jsx"}]},
            {
                "patches": [
                    {
                        "file": "frontend/src/pages/Editor.jsx",
                        "changes": ["Add cover image input"],
                        "risk_level": "medium",
                    }
                ]
            },
        )

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertFalse(review["checks"]["matches_located_files"])

    def test_todo_code_patch_review_false(self):
        review = review_patch_plan(
            None,
            {"located": True, "files": [{"relative_path": "backend/models/article.js"}]},
            {
                "patches": [
                    {
                        "file": "backend/models/article.js",
                        "operation": "replace",
                        "before_snippet": "const Article = {};\n",
                        "after_snippet": "const Article = {};\n// TODO: Add cover image field\n",
                        "diff": "+// TODO: Add cover image field\n",
                        "risk_level": "medium",
                    }
                ]
            },
        )

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertTrue(any("TODO" in issue for issue in review["issues"]))

    def test_cover_image_rejects_when_article_editor_form_exists_but_not_selected(self):
        skill = match_skill("add article cover image")["skill"]
        review = review_patch_plan(
            None,
            {
                "located": True,
                "files": [
                    {"relative_path": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx"},
                    {"relative_path": "frontend/src/routes/Article/Article.jsx"},
                ],
            },
            {
                "patches": [
                    {
                        "file": "frontend/src/routes/Article/Article.jsx",
                        "changes": ["Add cover image support"],
                        "risk_level": "medium",
                    }
                ],
                "role_assignments": {
                    "article_detail": "frontend/src/routes/Article/Article.jsx",
                },
            },
            matched_skill=skill,
        )

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertTrue(any("ArticleEditorForm" in issue and "editor_form" in issue for issue in review["issues"]))

    def test_cover_image_review_rejects_invalid_editor_form_patch(self):
        skill = match_skill("add article cover image")["skill"]
        review = review_patch_plan(
            None,
            {"located": True, "files": [{"relative_path": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx"}]},
            {
                "patches": [
                    {
                        "file": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                        "operation": "replace",
                        "before_snippet": "export default function ArticleEditorForm() { return null; }\n",
                        "after_snippet": (
                            "const emptyForm = { title: \"\", description: \"\", body: \"\", tagList: \"\" };\n"
                            "coverImage: \"\",\n"
                            "export default function ArticleEditorForm({ state }) {\n"
                            "  const [{ title, description, body, tagList }, setForm] = useState(\n"
                            "    const [coverImage, setCoverImage] = useState(article?.coverImage || \"\");\n"
                            "    state || emptyForm,\n"
                            "  );\n"
                            "  return null;\n"
                            "}\n"
                        ),
                        "diff": "+coverImage: \"\",\n+    const [coverImage, setCoverImage] = useState(article?.coverImage || \"\");\n",
                        "risk_level": "medium",
                        "role": "editor_form",
                    }
                ],
                "role_assignments": {
                    "editor_form": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                },
            },
            matched_skill=skill,
        )

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertTrue(any("Invalid editor_form patch" in issue for issue in review["issues"]))

    def test_cover_image_review_allows_legal_use_state_destructure(self):
        skill = match_skill("add article cover image")["skill"]
        after = (
            "const emptyForm = { title: \"\", description: \"\", body: \"\", tagList: \"\", coverImage: \"\" };\n\n"
            "function ArticleEditorForm() {\n"
            "  const { state } = useLocation();\n"
            "  const [{ title, description, body, tagList, coverImage }, setForm] = useState(\n"
            "    state || emptyForm,\n"
            "  );\n"
            "  return null;\n"
            "}\n"
        )
        review = review_patch_plan(
            None,
            {"located": True, "files": [{"relative_path": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx"}]},
            {
                "patches": [
                    {
                        "file": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                        "operation": "replace",
                        "before_snippet": "function ArticleEditorForm() { return null; }\n",
                        "after_snippet": after,
                        "diff": (
                            "+const emptyForm = { title: \"\", description: \"\", body: \"\", tagList: \"\", coverImage: \"\" };\n"
                            "+  const [{ title, description, body, tagList, coverImage }, setForm] = useState(\n"
                        ),
                        "risk_level": "medium",
                        "role": "editor_form",
                    }
                ],
                "role_assignments": {
                    "editor_form": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                },
            },
            matched_skill=skill,
        )

        self.assertTrue(review["approved"], review["issues"])
        self.assertFalse(any("useState arguments" in issue for issue in review["issues"]))

    def test_cover_image_review_rejects_const_inside_use_state_arguments(self):
        skill = match_skill("add article cover image")["skill"]
        review = review_patch_plan(
            None,
            {"located": True, "files": [{"relative_path": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx"}]},
            {
                "patches": [
                    {
                        "file": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                        "operation": "replace",
                        "before_snippet": "function ArticleEditorForm() { return null; }\n",
                        "after_snippet": (
                            "function ArticleEditorForm() {\n"
                            "  const [{ coverImage }, setForm] = useState(\n"
                            "    const [coverImage, setCoverImage] = useState(article?.coverImage || \"\");\n"
                            "    emptyForm,\n"
                            "  );\n"
                            "  return null;\n"
                            "}\n"
                        ),
                        "diff": "+    const [coverImage, setCoverImage] = useState(article?.coverImage || \"\");\n",
                        "risk_level": "medium",
                        "role": "editor_form",
                    }
                ],
                "role_assignments": {
                    "editor_form": "frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx",
                },
            },
            matched_skill=skill,
        )

        self.assertFalse(review["approved"])
        self.assertTrue(any("useState arguments" in issue for issue in review["issues"]))

    def test_cover_image_review_rejects_invalid_sequelize_string_type(self):
        skill = match_skill("add article cover image")["skill"]
        review = review_patch_plan(
            None,
            {"located": True, "files": [{"relative_path": "backend/models/Article.js"}]},
            {
                "patches": [
                    {
                        "file": "backend/models/Article.js",
                        "operation": "replace",
                        "before_snippet": "module.exports = (sequelize, DataTypes) => ({ body: DataTypes.TEXT });\n",
                        "after_snippet": "module.exports = (sequelize, DataTypes) => ({ coverImage: { type: String }, body: DataTypes.TEXT });\n",
                        "diff": "+  coverImage: { type: String },\n",
                        "risk_level": "medium",
                        "role": "model",
                    }
                ],
                "role_assignments": {
                    "model": "backend/models/Article.js",
                },
            },
            matched_skill=skill,
        )

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertTrue(any("DataTypes.STRING" in issue for issue in review["issues"]))

    def test_review_rejects_patch_count_over_eight(self):
        patches = [
            {
                "file": f"frontend/src/routes/Article/Extra{i}.jsx",
                "changes": ["Add cover image support"],
                "risk_level": "low",
            }
            for i in range(9)
        ]

        review = review_patch_plan(None, None, {"patches": patches})

        self.assertFalse(review["approved"])
        self.assertEqual(review["risk_level"], "high")
        self.assertIn("Patch plan touches too many files", review["issues"])

    def test_matched_skill_fields_enter_review(self):
        skill = match_skill("please add reading time to article page")["skill"]
        review = review_patch_plan(
            {"acceptance_criteria": ["Article detail page shows word count"]},
            None,
            {
                "summary": "Prepare article word count and reading time display",
                "patches": [
                    {
                        "file": "frontend/src/pages/Article.jsx",
                        "changes": ["Add word count calculation", "Add reading time calculation"],
                        "risk_level": "low",
                    }
                ],
            },
            matched_skill=skill,
        )

        self.assertTrue(review["approved"])
        self.assertEqual(review["skill_id"], "article-word-stats")
        self.assertIn("Article detail page shows word count", review["acceptance_template"])
        self.assertEqual(review["risk_rules"]["default"], "low")

    def test_review_code_patch(self):
        review = review_patch_plan(
            {"acceptance_criteria": ["shows word count"]},
            {"located": True, "files": [{"relative_path": "frontend/src/pages/Article.jsx"}]},
            {
                "summary": "Prepare code patch",
                "patches": [
                    {
                        "file": "frontend/src/pages/Article.jsx",
                        "operation": "replace",
                        "before_snippet": "export const body = article.body;\n",
                        "after_snippet": "const wordCount = 1;\nexport const body = article.body;\n",
                        "diff": "--- a/frontend/src/pages/Article.jsx\n+++ b/frontend/src/pages/Article.jsx\n+const wordCount = 1;\n",
                        "confidence": 0.82,
                    }
                ],
            },
        )

        self.assertTrue(review["approved"])
        self.assertTrue(review["checks"]["has_code_patch"])
        self.assertTrue(review["checks"]["matches_located_files"])


if __name__ == "__main__":
    unittest.main()
