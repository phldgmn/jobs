const input = document.getElementById("endpoint");
const status = document.getElementById("status");

browser.storage.local.get("endpoint").then(({ endpoint }) => {
  input.value = endpoint ?? "http://127.0.0.1:48173";
});

document.getElementById("save").addEventListener("click", async () => {
  const value = input.value.trim().replace(/\/+$/, "");
  await browser.storage.local.set({ endpoint: value });
  status.textContent = "Saved.";
});
