import { cleanText, read, safeId, timestamp } from "./utils.js";

export function createProjectRepository(database) {
  return {
    create(input = {}) {
      const now = timestamp();
      const id = safeId(read(input, "id", "id", null), "project");
      database.prepare(`
        INSERT INTO projects (id, name, description, status, icon, rail_subtitle, local_path, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        cleanText(read(input, "name", "name", "Untitled Project")),
        cleanText(read(input, "description", "description", "")),
        cleanText(read(input, "status", "status", "current")),
        cleanText(read(input, "icon", "icon", "folder")),
        cleanText(read(input, "rail_subtitle", "railSubtitle", read(input, "local_path", "localPath", ""))),
        cleanText(read(input, "local_path", "localPath", "")),
        now,
        now,
        read(input, "last_opened_at", "lastOpenedAt", now)
      );
      return this.getById(id);
    },

    getById(id) {
      return mapProject(database.prepare("SELECT * FROM projects WHERE id = ?").get(id));
    },

    list() {
      return database
        .prepare("SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at) DESC, created_at DESC")
        .all()
        .map(mapProject);
    },

    update(id, input = {}) {
      const existing = this.getById(id);
      if (!existing) return null;
      const now = timestamp();
      database.prepare(`
        UPDATE projects
        SET name = ?, description = ?, status = ?, icon = ?, rail_subtitle = ?, local_path = ?, updated_at = ?, last_opened_at = ?
        WHERE id = ?
      `).run(
        cleanText(read(input, "name", "name", existing.name)),
        cleanText(read(input, "description", "description", existing.description)),
        cleanText(read(input, "status", "status", existing.status)),
        cleanText(read(input, "icon", "icon", existing.icon)),
        cleanText(read(input, "rail_subtitle", "railSubtitle", existing.rail_subtitle)),
        cleanText(read(input, "local_path", "localPath", existing.local_path)),
        now,
        read(input, "last_opened_at", "lastOpenedAt", existing.last_opened_at),
        id
      );
      return this.getById(id);
    }
  };
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    icon: row.icon,
    rail_subtitle: row.rail_subtitle,
    railSubtitle: row.rail_subtitle,
    local_path: row.local_path || "",
    localPath: row.local_path || "",
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
    last_opened_at: row.last_opened_at,
    lastOpenedAt: row.last_opened_at
  };
}
