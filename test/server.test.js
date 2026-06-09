import assert from "node:assert/strict";
import test from "node:test";

import { buildImagePrompt, createAppServer } from "../server.js";

test("image prompt includes the child's idea and wrap constraints", () => {
  const prompt = buildImagePrompt("rainbow jungle");
  assert.match(prompt, /rainbow jungle/);
  assert.match(prompt, /1024x1024/);
  assert.match(prompt, /Do not show a car/);
});

test("server serves the editor and protects generation without a key", async () => {
  const server = createAppServer().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Wrap Wizard/);

  const privateSource = await fetch(`http://127.0.0.1:${port}/server.js`);
  assert.equal(privateSource.status, 404);

  const generation = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea: "a colorful forest" }),
  });
  assert.equal(generation.status, 503);

  const saved = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test wrap",
      preview: "data:image/png;base64,test",
      design: { layers: [] },
    }),
  });
  assert.equal(saved.status, 200);
  const { project } = await saved.json();
  const listed = await fetch(`http://127.0.0.1:${port}/api/projects`);
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).projects.some((item) => item.id === project.id));
  const deleted = await fetch(`http://127.0.0.1:${port}/api/projects/${project.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);

  server.close();
});
