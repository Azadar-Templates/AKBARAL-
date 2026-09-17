-- Keep the FTS mirror aligned when knowledge_items are removed.
--
-- knowledge_fts is a standalone FTS5 virtual table (content_rowid='rowid').
-- Without a trigger, deleting a knowledge_item (directly or via foreign-key
-- cascade when its user/project/file is removed) leaves an orphan row in the
-- FTS table. SQLite can later reuse the same rowid for a new knowledge_item,
-- and the FTS insert would then fail with 'constraint failed'.

CREATE OR REPLACE FUNCTION trg_knowledge_items_after_delete_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_items_after_delete ON knowledge_items;
CREATE TRIGGER trg_knowledge_items_after_delete AFTER DELETE ON knowledge_items
FOR EACH ROW EXECUTE FUNCTION trg_knowledge_items_after_delete_fn();

-- Remove orphan FTS entries accumulated before this migration was applied.
DELETE FROM knowledge_fts WHERE rowid NOT IN (SELECT rowid FROM knowledge_items);
