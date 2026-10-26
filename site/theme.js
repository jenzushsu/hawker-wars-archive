const toggle = document.getElementById("theme-toggle");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function darkModeActive() {
  const preference = document.documentElement.dataset.theme;
  return preference === "dark" || (preference !== "light" && systemTheme.matches);
}

function updateToggle() {
  const active = darkModeActive();
  toggle.setAttribute("aria-pressed", String(active));
  toggle.title = active ? "Switch to light mode" : "Switch to dark mode";
}

toggle.addEventListener("click", () => {
  const next = darkModeActive() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("hawker-wars-theme", next);
  } catch {}
  updateToggle();
});

systemTheme.addEventListener("change", updateToggle);
updateToggle();
