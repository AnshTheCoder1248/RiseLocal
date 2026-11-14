-- Full-text search for the board (BR-3): keep "Job".search_vector in sync via trigger.
-- Weighted: title (A) > tags (B) > description (C).

CREATE OR REPLACE FUNCTION job_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, description, tags ON "Job"
  FOR EACH ROW EXECUTE FUNCTION job_search_vector_update();

-- Backfill any existing rows.
UPDATE "Job" SET title = title;
