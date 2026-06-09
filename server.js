import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 60_000_000;
const DATA_DIR = process.env.STORAGE_DIR || join(ROOT, "data");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": CONTENT_TYPES[".json"] });
  response.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const leftValue = Buffer.from(left);
  const rightValue = Buffer.from(right);
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function readBasicAuth(request) {
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return null;

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isAuthorized(request) {
  const expectedPassword = process.env.SITE_PASSWORD || "";
  if (!expectedPassword) return true;

  const credentials = readBasicAuth(request);
  if (!credentials || !safeEqual(credentials.password, expectedPassword)) return false;

  const expectedUsername = process.env.SITE_USERNAME || "";
  return !expectedUsername || safeEqual(credentials.username, expectedUsername);
}

function requestLogin(response) {
  response.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Wrap Wizard", charset="UTF-8"',
  });
  response.end("Login required.");
}

async function readProjects() {
  try {
    return JSON.parse(await readFile(PROJECTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function writeProjects(projects) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function buildImagePrompt(idea, size = "1024x1024") {
  const shape = size === "1536x1024" ? "wide 1536x1024" : size === "1024x1536" ? "tall 1024x1536" : "1024x1024 square";
  return [
    `Create a ${shape}, edge-to-edge illustrated vehicle-wrap texture.`,
    `Design idea: ${idea.trim()}`,
    "Make it playful, colorful, bold, and easy for a child to enjoy.",
    "Use large readable shapes and continuous visual interest across every edge.",
    "Do not show a car, vehicle mockup, panel outlines, border, watermark, or text.",
  ].join(" ");
}

async function generateImage(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(response, 503, {
      error: "Image magic is not connected yet. Add OPENAI_API_KEY and restart.",
    });
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return sendJson(response, 400, { error: "That request could not be read." });
  }

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (idea.length < 3 || idea.length > 1000) {
    return sendJson(response, 400, {
      error: "Describe your design using between 3 and 1000 characters.",
    });
  }

  const size = ALLOWED_SIZES.has(body.size) ? body.size : "1024x1024";
  const quality = ALLOWED_QUALITIES.has(body.quality) ? body.quality : "medium";
  const references = Array.isArray(body.references)
    ? body.references.filter((value) => typeof value === "string" && value.startsWith("data:image/")).slice(0, 16)
    : [];
  const isEdit = references.length > 0;
  const endpoint = isEdit ? "edits" : "generations";
  const requestBody = isEdit
    ? {
        model: "gpt-image-1.5",
        prompt: buildImagePrompt(idea, size),
        images: references.map((image_url) => ({ image_url })),
        input_fidelity: "high",
        size,
        quality,
        output_format: "png",
      }
    : {
        model: "gpt-image-1.5",
        prompt: buildImagePrompt(idea, size),
        size,
        quality,
        output_format: "png",
      };

  const apiResponse = await fetch(`https://api.openai.com/v1/images/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const result = await apiResponse.json();
  if (!apiResponse.ok) {
    const message = result?.error?.message || "Image generation did not work.";
    return sendJson(response, apiResponse.status, { error: message });
  }

  const image = result?.data?.[0]?.b64_json;
  if (!image) {
    return sendJson(response, 502, { error: "No image came back. Please try again." });
  }
  return sendJson(response, 200, { image: `data:image/png;base64,${image}` });
}

async function handleProjects(request, response) {
  const url = new URL(request.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const projects = await readProjects();

  if (request.method === "GET" && parts.length === 2) {
    return sendJson(response, 200, {
      projects: projects
        .map(({ id, name, createdAt, updatedAt, preview }) => ({ id, name, createdAt, updatedAt, preview }))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    });
  }

  if (request.method === "GET" && parts.length === 3) {
    const project = projects.find((item) => item.id === parts[2]);
    return project ? sendJson(response, 200, { project }) : sendJson(response, 404, { error: "Project not found." });
  }

  if (request.method === "POST" && parts.length === 2) {
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return sendJson(response, 400, { error: "Project could not be read." });
    }
    const now = new Date().toISOString();
    const project = {
      id: body.id || randomUUID(),
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Untitled wrap",
      createdAt: body.createdAt || now,
      updatedAt: now,
      preview: typeof body.preview === "string" ? body.preview : "",
      design: body.design || {},
    };
    const index = projects.findIndex((item) => item.id === project.id);
    if (index >= 0) projects[index] = project;
    else projects.push(project);
    await writeProjects(projects);
    return sendJson(response, 200, { project });
  }

  if (request.method === "DELETE" && parts.length === 3) {
    const remaining = projects.filter((item) => item.id !== parts[2]);
    await writeProjects(remaining);
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 405, { error: "Method not allowed." });
}

function safeFilePath(urlPath) {
  const requested = urlPath === "/" ? "public/index.html" : urlPath === "/projects" ? "public/projects.html" : urlPath.replace(/^\/+/, "");
  const normalized = normalize(requested);
  if (
    normalized.includes("..") ||
    (!normalized.startsWith("public/") && !normalized.startsWith("assets/"))
  ) {
    return null;
  }
  return join(ROOT, normalized);
}

async function serveFile(request, response) {
  const path = safeFilePath(new URL(request.url, "http://localhost").pathname);
  if (!path) return sendJson(response, 404, { error: "Not found." });

  try {
    const details = await stat(path);
    if (!details.isFile()) throw new Error("Not a file");
    const content = await readFile(path);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": CONTENT_TYPES[extname(path)] || "application/octet-stream",
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        return sendJson(response, 200, { ok: true });
      }
      if (!isAuthorized(request)) {
        requestLogin(response);
        return;
      }
      if (request.method === "POST" && request.url === "/api/generate") {
        await generateImage(request, response);
        return;
      }
      if (request.url.startsWith("/api/projects")) {
        await handleProjects(request, response);
        return;
      }
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      await serveFile(request, response);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: "Something went sideways. Please try again." });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`Wrap Wizard is ready at http://${HOST}:${PORT}`);
  });
}
