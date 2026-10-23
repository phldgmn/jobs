import index from "./web/index.html";
import { api } from "./api";
import { resumePending } from "./jobs";

const server = Bun.serve({
  hostname: "127.0.0.1", // personal tool: localhost only, no auth
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/api/*": req => api.fetch(req),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

resumePending();
console.log(`Jobs UI: ${server.url}`);
