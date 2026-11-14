// env() requires DATABASE_URL. Unit tests replace the DB with tests/helpers/fake-db.ts, so any
// value works. Integration tests (tests/integration) point the app at TEST_DATABASE_URL.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
