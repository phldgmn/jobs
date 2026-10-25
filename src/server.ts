import index from "./web/index.html";
import favicon from "./web/favicon.png" with { type: "file" };
import { api } from "./api";
import { resumePending } from "./jobs";

const server = Bun.serve({
  hostname: "127.0.0.1", // personal tool: localhost only, no auth
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/api/*": req => api.fetch(req),
    // Safari requests /favicon.ico by default; without this the SPA fallback returns HTML.
    "/favicon.ico": () => new Response(Bun.file(favicon), { headers: { "Content-Type": "image/png" } }),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

resumePending();
console.log(`Jobs UI: ${server.url}`);
