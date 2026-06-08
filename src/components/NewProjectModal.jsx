import { X } from "lucide-react";
import { useId, useState } from "react";

export default function NewProjectModal({ onCancel, onCreate }) {
  const nameId = useId();
  const pathId = useId();
  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    onCreate({
      name: name.trim() || "未命名项目",
      localPath: localPath.trim()
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="new-project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <h2 id="new-project-title">新建项目</h2>
          <button className="modal-close" type="button" aria-label="关闭" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <label className="form-field" htmlFor={nameId}>
          <span>项目名称</span>
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：Research Workspace"
          />
        </label>
        <label className="form-field" htmlFor={pathId}>
          <span>本地路径</span>
          <input
            id={pathId}
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
            placeholder="F:\\Projects\\Research Workspace"
          />
        </label>
        <div className="modal-actions">
          <button className="ghost-action" type="button" onClick={onCancel}>取消</button>
          <button className="primary-action" type="submit">创建</button>
        </div>
      </form>
    </div>
  );
}
