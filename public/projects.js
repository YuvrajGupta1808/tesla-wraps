const grid = document.querySelector("#projects-grid");

function card(project) {
  const item = document.createElement("article");
  item.className = "project-card";
  const image = document.createElement("img");
  image.src = project.preview;
  image.alt = project.name;
  const content = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = project.name;
  const meta = document.createElement("p");
  meta.textContent = `Saved ${new Date(project.updatedAt).toLocaleString()}`;
  const open = document.createElement("a");
  open.href = `/?project=${project.id}`;
  open.textContent = "Open design";
  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    await loadProjects();
  });
  content.append(title, meta, open, remove);
  item.append(image, content);
  return item;
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const { projects } = await response.json();
  grid.innerHTML = "";
  if (!projects.length) {
    grid.innerHTML = '<p class="layer-empty">No saved designs yet. Go make one in the Studio.</p>';
    return;
  }
  projects.forEach((project) => grid.append(card(project)));
}

loadProjects();
