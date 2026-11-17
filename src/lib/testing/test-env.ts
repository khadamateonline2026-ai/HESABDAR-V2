/**
 * Test-only: import FIRST in DB tests. Points `@/lib/db` at a dummy Neon URL so
 * importing server modules never boots the on-disk PGLite preview database.
 * Tests pass their own in-memory PGLite `Sql` to the functions under test; the
 * dummy pool is never connected.
 */
process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:9/never-connected";
export {};
