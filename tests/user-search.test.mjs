import assert from "node:assert/strict";
import { test } from "node:test";
import { filterUsersBySearch } from "../src/lib/user-search.ts";

const users = Object.freeze([
  Object.freeze({ id: 1, full_name: "Júlio Pessoa", email: "julio.pessoa@example.com" }),
  Object.freeze({ id: 2, full_name: "Márcio Lima da Silva Bandeira", email: "marcio@example.com" }),
  Object.freeze({ id: 3, full_name: null, email: null }),
]);

test("matches names regardless of accents, case or extra spaces", () => {
  assert.deepEqual(filterUsersBySearch(users, " JULIO  ").map((u) => u.id), [1]);
});
test("matches separated name parts in any order", () => {
  assert.deepEqual(filterUsersBySearch(users, "BANDEIRA marcio").map((u) => u.id), [2]);
});
test("matches an email or combined name and email terms", () => {
  assert.deepEqual(filterUsersBySearch(users, "julio.pessoa@").map((u) => u.id), [1]);
  assert.deepEqual(filterUsersBySearch(users, "pessoa example.com").map((u) => u.id), [1]);
});
test("clearing search restores the authorized list in its original order", () => {
  assert.deepEqual(filterUsersBySearch(users, "  "), users);
});
test("unknown search and empty data return no matches", () => {
  assert.deepEqual(filterUsersBySearch(users, "inexistente"), []);
  assert.deepEqual(filterUsersBySearch([], "julio"), []);
});
test("does not mutate the input or introduce users absent from it", () => {
  const restricted = [users[1]];
  assert.deepEqual(filterUsersBySearch(restricted, "julio"), []);
  assert.equal(users.length, 3);
});
