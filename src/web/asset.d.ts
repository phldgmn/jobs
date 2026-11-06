// Bun resolves image imports (`with { type: "file" }`) to a path string; TypeScript needs the module declared.
declare module "*.png" {
  const path: string;
  export default path;
}
