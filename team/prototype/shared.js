// Light/dark switch, remembered per browser
const root = document.documentElement;
if (!root.classList.contains("embed")) {
  try { const t = localStorage.getItem("margin-team-theme"); if (t) root.dataset.theme = t; } catch {}
}
document.getElementById("themeBtn")?.addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("margin-team-theme", root.dataset.theme); } catch {}
});
